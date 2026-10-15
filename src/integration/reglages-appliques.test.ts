/**
 * GF-026 — des réglages enregistrés que rien n'appliquait, et une photo
 * d'inspection qu'on ne pouvait pas supprimer.
 *
 * ─── Taux de TVA et tarif horaire ───────────────────────────────────────────
 * La modale devis/facture initialisait `taxRate: prefill?.taxRate ?? 20`, et
 * AUCUN appelant ne fournit `prefill.taxRate`. Le corps envoyé portait donc
 * toujours 20, si bien que le repli serveur `body.taxRate ?? garage.taxRate` ne
 * se déclenchait jamais : un garage en franchise de TVA, en outre-mer ou à taux
 * réduit facturait 20 % à son insu, sur CHAQUE document. Même schéma pour la
 * ligne de main-d'œuvre, codée en dur à 60 €/h.
 *
 * ─── Photo d'inspection ─────────────────────────────────────────────────────
 * Retirer une photo posait `photoBase64 = null` et laissait `photoPath` intact.
 * Or la lecture donne la PRIORITÉ au fichier : la photo réapparaissait au
 * rechargement de l'inspection, et le fichier restait sur le disque. Le garage
 * la « supprimait » sans effet, indéfiniment.
 */
type OriginalModule1 = typeof import('@/lib/api-helpers')

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../..')
const DB_PATH = path.resolve(__dirname, '../../.tmp-reglages-appliques.db')
const PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-inspect-'))
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PHOTOS_DIR = PHOTOS_DIR

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})

let prisma: any
let inspectionPATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', inspection: '', item: '' }

const patchItem = (corps: Record<string, unknown>) =>
  inspectionPATCH(new Request('http://localhost/api/inspections/x', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: ids.item, ...corps }),
  }), { params: { id: ids.inspection } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PATCH: inspectionPATCH } = (await import('@/app/api/inspections/[id]/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Réglages', slug: 'garage-reglages', taxRate: 0 } })
  const inspection = await prisma.inspection.create({
    data: { garageId: garage.id, clientName: 'Jean Client' },
  })
  const item = await prisma.inspectionItem.create({
    data: { inspectionId: inspection.id, category: 'freins', label: 'Plaquettes avant', status: 'ok' },
  })
  ids.garage = garage.id; ids.inspection = inspection.id; ids.item = item.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true })
})

describe('photo d’inspection — la suppression supprime vraiment (GF-026)', () => {
  it('ajouter une photo la range dans un fichier', async () => {
    const res = await patchItem({ photoBase64: PNG })
    expect(res.status).toBe(200)
    const item = await res.json()
    expect(item.photoPath, 'la photo doit être stockée sur disque').toMatch(/^inspections\//)
    expect(item.photoBase64).toBeNull()
    expect(fs.existsSync(path.join(PHOTOS_DIR, item.photoPath))).toBe(true)
  })

  it('retirer la photo efface le CHEMIN, pas seulement le contenu inline', async () => {
    const avant = await prisma.inspectionItem.findUnique({ where: { id: ids.item } })
    expect(avant.photoPath).toBeTruthy()
    const fichier = path.join(PHOTOS_DIR, avant.photoPath)

    const res = await patchItem({ photoBase64: null })
    expect(res.status).toBe(200)
    const item = await res.json()

    expect(item.photoPath, 'sinon la photo réapparaît au rechargement').toBeNull()
    expect(item.photoBase64).toBeNull()
    expect(fs.existsSync(fichier), 'et le fichier ne doit pas rester orphelin').toBe(false)
  })

  it('remplacer une photo ne laisse pas l’ancienne sur le disque', async () => {
    const premier = await (await patchItem({ photoBase64: PNG })).json()
    const fichier1 = path.join(PHOTOS_DIR, premier.photoPath)
    expect(fs.existsSync(fichier1)).toBe(true)

    const second = await (await patchItem({ photoBase64: PNG })).json()
    expect(second.photoPath).not.toBe(premier.photoPath)
    expect(fs.existsSync(path.join(PHOTOS_DIR, second.photoPath))).toBe(true)
  })
})

describe('les réglages du garage sont réellement appliqués (GF-026)', () => {
  const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')
  /** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
  const sansCommentaires = (s: string) => s
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('la modale devis/facture reprend le taux de TVA du garage', () => {
    const src = sansCommentaires(lire('src/components/QuoteInvoiceModal.tsx'))
    expect(src, 'le champ doit être déclaré pour être lisible').toMatch(/taxRate\?:\s*number/)
    expect(src, 'et appliqué à la création d’un document neuf')
      .toMatch(/setForm\(f => \(\{ \.\.\.f, taxRate: g\.taxRate as number \}\)\)/)
    expect(src, 'sans écraser le taux d’un document existant').toMatch(/!documentId && prefill\?\.taxRate == null/)
  })

  it('la ligne de main-d’œuvre reprend le tarif horaire du garage', () => {
    const src = sansCommentaires(lire('src/components/QuoteInvoiceModal.tsx'))
    expect(src).toMatch(/garage\?\.hourlyRate/)
    expect(src, '60 € ne doit plus être le tarif, seulement le dernier repli')
      .toMatch(/isLabor \? tarifHoraire : 0/)
  })
})
