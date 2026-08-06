/**
 * SAUVEGARDE → RESTAURATION de bout en bout sur base RÉELLE (AUD-017).
 *
 * Le seul test de sauvegarde existant se déclarait « no DB » et ne couvrait que
 * le chiffrement. Le CHEMIN QUI COMPTE EN SINISTRE — restaurer réellement des
 * données dans une base — n'était jamais exécuté. Ici on prouve le cycle complet
 * sur un vrai SQLite via les vrais createBackup/verifyBackup/restoreBackup :
 *
 *   1. sauvegarde chiffrée d'un garage peuplé, vérifiée (checksum) ;
 *   2. corruption des données vivantes (suppression + ajout parasite) ;
 *   3. restauration → les données sont EXACTEMENT rétablies ;
 *   4. la restauration est SCOPÉE au garage (le garage B n'est jamais touché) ;
 *   5. garde-fous : confirmation obligatoire, pas de restauration inter-garage,
 *      intégrité (blob altéré → refus).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const DB_PATH = path.resolve(__dirname, '../../../../.tmp-backup-restore.db')
const BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-backups-'))
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_BACKUP_DIR = BACKUP_DIR
process.env.GF_BACKUP_KEY = crypto.randomBytes(32).toString('base64') // clé forte AES-256

let prisma: any
let createBackup: any, verifyBackup: any, restoreBackup: any
const ids = { gA: '', gB: '', cA1: '', cA2: '', pA1: '', invA: '', cB: '', pB: '' }

const scaled = (n: number) => Math.round(n * 10000)

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../../../..'), env: { ...process.env }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  ;({ createBackup, verifyBackup, restoreBackup } = await import('@/lib/backup/service'))

  // Garage A — peuplé sur plusieurs tables.
  const gA = await prisma.garage.create({ data: { name: 'Garage A', slug: `a-${crypto.randomBytes(3).toString('hex')}`, invoicePrefix: 'FAC', invoiceCounter: 1 } })
  ids.gA = gA.id
  const cA1 = await prisma.client.create({ data: { name: 'Client A1', garageId: gA.id } })
  const cA2 = await prisma.client.create({ data: { name: 'Client A2', garageId: gA.id } })
  ids.cA1 = cA1.id; ids.cA2 = cA2.id
  const pA1 = await prisma.part.create({ data: { name: 'Filtre à huile', garageId: gA.id, unitPriceTenThousandths: scaled(12.5), quantity: 10 } })
  ids.pA1 = pA1.id
  await prisma.part.create({ data: { name: 'Plaquettes', garageId: gA.id, unitPriceTenThousandths: scaled(45), quantity: 4 } })
  const invA = await prisma.invoice.create({
    data: {
      number: 'FAC-A-001', garageId: gA.id, clientName: 'Client A1', issueDate: '2026-08-06', status: 'sent',
      lines: { create: [{ description: 'Vidange', quantityTenThousandths: scaled(1), unitPriceTenThousandths: scaled(80), sortOrder: 0 }] },
    },
  })
  ids.invA = invA.id

  // Garage B — témoin d'isolation.
  const gB = await prisma.garage.create({ data: { name: 'Garage B', slug: `b-${crypto.randomBytes(3).toString('hex')}` } })
  ids.gB = gB.id
  const cB = await prisma.client.create({ data: { name: 'Client B', garageId: gB.id } })
  const pB = await prisma.part.create({ data: { name: 'Pièce B', garageId: gB.id } })
  ids.cB = cB.id; ids.pB = pB.id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true })
})

describe('Sauvegarde → restauration réelle', () => {
  let backupId = ''

  it('crée une sauvegarde chiffrée vérifiable (checksum)', async () => {
    const rec = await createBackup(ids.gA, { note: 'test' })
    backupId = rec.id
    expect(rec.status).toBe('completed')
    // Le blob chiffré est réellement écrit sur disque.
    expect(fs.existsSync(path.join(BACKUP_DIR, rec.filename))).toBe(true)
    const v = await verifyBackup(ids.gA, backupId)
    expect(v.ok).toBe(true)
    expect(v.checksumMatches).toBe(true)
    expect(v.counts.clients).toBe(2)
    expect(v.counts.parts).toBe(2)
    expect(v.counts.invoices).toBe(1)
  })

  it('restaure EXACTEMENT après corruption des données vivantes', async () => {
    // Corruption : on supprime les clients de A, on change la facture, on ajoute
    // une pièce parasite.
    await prisma.invoice.update({ where: { id: ids.invA }, data: { clientName: 'CORROMPU' } })
    await prisma.client.deleteMany({ where: { garageId: ids.gA } })
    const bogus = await prisma.part.create({ data: { name: 'PIÈCE PARASITE', garageId: ids.gA } })
    expect(await prisma.client.count({ where: { garageId: ids.gA } })).toBe(0)

    const res = await restoreBackup(ids.gA, backupId, { confirm: backupId })
    expect(res.ok).toBe(true)

    // Données EXACTEMENT rétablies.
    expect(await prisma.client.count({ where: { garageId: ids.gA } })).toBe(2)
    const inv = await prisma.invoice.findUnique({ where: { id: ids.invA }, include: { lines: true } })
    expect(inv.clientName).toBe('Client A1') // valeur d'origine restaurée
    expect(inv.lines).toHaveLength(1)
    // La pièce parasite a disparu ; les 2 pièces d'origine sont là.
    const parts = await prisma.part.findMany({ where: { garageId: ids.gA }, orderBy: { name: 'asc' } })
    expect(parts.map((p: { name: string }) => p.name)).toEqual(['Filtre à huile', 'Plaquettes'])
    expect(await prisma.part.findFirst({ where: { id: bogus.id } })).toBeNull()
  })

  it('la restauration ne touche PAS le garage B (scopée)', async () => {
    expect(await prisma.client.count({ where: { garageId: ids.gB } })).toBe(1)
    const pB = await prisma.part.findUnique({ where: { id: ids.pB } })
    expect(pB?.name).toBe('Pièce B')
  })

  it('refuse une restauration sans confirmation exacte', async () => {
    const res = await restoreBackup(ids.gA, backupId, { confirm: 'mauvais' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Confirmation/i)
  })

  it('refuse de restaurer la sauvegarde de A sur le garage B (inter-garage)', async () => {
    const res = await restoreBackup(ids.gB, backupId, { confirm: backupId })
    expect(res.ok).toBe(false) // record introuvable pour garageId=B
    // Le garage B reste intact.
    expect(await prisma.client.count({ where: { garageId: ids.gB } })).toBe(1)
  })

  it('détecte une sauvegarde altérée (intégrité)', async () => {
    const rec = await prisma.backupRecord.findFirst({ where: { id: backupId } })
    const full = path.join(BACKUP_DIR, rec.filename)
    const env = JSON.parse(fs.readFileSync(full, 'utf8'))
    env.ct = Buffer.from('donnees-falsifiees').toString('base64') // corrompt le chiffré
    fs.writeFileSync(full, JSON.stringify(env))
    const v = await verifyBackup(ids.gA, backupId)
    expect(v.ok).toBe(false)
    const res = await restoreBackup(ids.gA, backupId, { confirm: backupId })
    expect(res.ok).toBe(false)
  })
})
