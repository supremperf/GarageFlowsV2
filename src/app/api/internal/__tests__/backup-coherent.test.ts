/**
 * POST /api/internal/backup — la sauvegarde du poste doit être RESTAURABLE.
 *
 * Elle était faite par `fs.copyFileSync` depuis le processus Electron, toutes
 * les heures, pendant que le serveur Next écrivait dans la même base. Le mode de
 * journalisation d'un poste est `delete` : pendant un commit, les pages
 * modifiées vont dans le fichier PRINCIPAL, l'état antérieur dans
 * `…-journal`. Copier le principal seul, à cet instant, donne une base déchirée
 * — une sauvegarde qui paraît réussie et ne se restaure pas.
 *
 * Ces tests exercent la correction : `VACUUM INTO`, exécuté par le processus qui
 * détient la connexion. On ne vérifie pas seulement qu'un fichier apparaît — on
 * l'OUVRE et on relit les données.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

// Hors du dépôt : ces fichiers .db transitoires étaient balayés par la garde
// « aucun secret distribué » quand elle tournait en parallèle.
const RACINE_TMP = path.join(os.tmpdir(), 'gf-backup-interne')
const DB_PATH = path.join(RACINE_TMP, 'garageflow.db')
const PHOTOS = path.join(RACINE_TMP, 'photos')
const SAUVEGARDES = path.join(RACINE_TMP, 'backups')

process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PHOTOS_DIR = PHOTOS
process.env.GF_INTERNAL_EXPORT_KEY = 'cle-interne-de-test-suffisamment-longue'

let POST: (req: Request) => Promise<Response>
let prisma: any
let garageId = ''

// `null` et non `undefined` : une valeur par défaut de paramètre s'applique
// AUSSI à `undefined`, si bien qu'un test « sans clé » envoyait la bonne clé.
const appeler = (body: unknown, cle: string | null = process.env.GF_INTERNAL_EXPORT_KEY ?? null) =>
  POST(new Request('http://127.0.0.1/api/internal/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cle ? { 'x-internal-key': cle } : {}) },
    body: JSON.stringify(body),
  }))

beforeAll(async () => {
  fs.rmSync(RACINE_TMP, { recursive: true, force: true })
  fs.mkdirSync(PHOTOS, { recursive: true })
  const { prepareTestDb } = await import('../../../../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/internal/backup/route')) as any)
  garageId = (await prisma.garage.create({ data: { name: 'Sauvegarde', slug: 'sauvegarde' } })).id
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  fs.rmSync(RACINE_TMP, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(SAUVEGARDES, { recursive: true, force: true })
})

/** Relit une sauvegarde avec un moteur SQLite INDÉPENDANT de Prisma. */
function relire(fichier: string): { integrite: string; garages: number; factures: number } {
  const db = new DatabaseSync(fichier, { readOnly: true })
  try {
    const integrite = String((db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check)
    const garages = Number((db.prepare('SELECT COUNT(*) AS n FROM Garage').get() as { n: number }).n)
    const factures = Number((db.prepare('SELECT COUNT(*) AS n FROM Invoice').get() as { n: number }).n)
    return { integrite, garages, factures }
  } finally {
    db.close()
  }
}

describe('la sauvegarde produite est réellement restaurable', () => {
  it('le fichier écrit passe le contrôle d’intégrité et contient les données', async () => {
    await prisma.invoice.create({
      data: { number: 'F-BK-1', garageId, clientName: 'C', status: 'sent', issueDate: '2026-08-15', taxRate: 20 },
    })
    const cible = path.join(SAUVEGARDES, 'instantane.db')
    const r = await appeler({ destination: cible })
    expect(r.status).toBe(200)

    const lu = relire(cible)
    expect(lu.integrite, 'une sauvegarde qui ne passe pas integrity_check ne vaut rien').toBe('ok')
    expect(lu.garages).toBe(1)
    expect(lu.factures).toBe(1)
  })

  it('reste cohérente quand des écritures ont lieu PENDANT la sauvegarde', async () => {
    // C'est le cas qui cassait la copie d'octets : écrire et copier en même temps.
    const cible = path.join(SAUVEGARDES, 'sous-charge.db')
    const ecritures = (async () => {
      for (let i = 0; i < 40; i++) {
        await prisma.invoice.create({
          data: { number: `F-CH-${i}`, garageId, clientName: 'C', status: 'draft', issueDate: '2026-08-15', taxRate: 20 },
        })
      }
    })()
    const [reponse] = await Promise.all([appeler({ destination: cible }), ecritures])
    expect(reponse.status).toBe(200)

    const lu = relire(cible)
    expect(lu.integrite, 'l’instantané ne doit jamais être déchiré').toBe('ok')
    // Le nombre exact dépend de l'instant de l'instantané ; ce qui doit être vrai,
    // c'est que la base est COMPLÈTE et lisible, jamais tronquée.
    expect(lu.garages).toBe(1)
  })
})

describe('la destination ne peut pas désigner autre chose que le dossier de sauvegarde', () => {
  it.each([
    ['une remontée de dossier', path.join(SAUVEGARDES, '..', '..', 'evade.db')],
    ['un chemin absolu ailleurs', path.join(RACINE_TMP, 'photos', 'ailleurs.db')],
  ])('refuse %s', async (_cas, destination) => {
    const r = await appeler({ destination })
    expect(r.status).toBe(400)
    expect(fs.existsSync(path.resolve(destination)), 'aucun fichier ne doit être créé').toBe(false)
  })

  it('refuse une extension inattendue', async () => {
    const r = await appeler({ destination: path.join(SAUVEGARDES, 'charge.exe') })
    expect(r.status).toBe(400)
  })

  it('n’écrase jamais une sauvegarde existante', async () => {
    const cible = path.join(SAUVEGARDES, 'unique.db')
    expect((await appeler({ destination: cible })).status).toBe(200)
    const empreinte = fs.statSync(cible).mtimeMs
    const r = await appeler({ destination: cible })
    expect((await r.json()).skipped).toBe('DEJA_PRESENTE')
    expect(fs.statSync(cible).mtimeMs, 'écraser priverait le garage de son antériorité').toBe(empreinte)
  })
})

describe('la route reste réservée au processus local', () => {
  it('sans clé interne : 401, et rien n’est écrit', async () => {
    const cible = path.join(SAUVEGARDES, 'sans-cle.db')
    const r = await appeler({ destination: cible }, null)
    expect(r.status).toBe(401)
    expect(fs.existsSync(cible)).toBe(false)
  })

  it('avec une mauvaise clé : 401', async () => {
    const r = await appeler({ destination: path.join(SAUVEGARDES, 'x.db') }, 'mauvaise-cle-mais-assez-longue')
    expect(r.status).toBe(401)
  })

  it('une requête relayée par un proxy est refusée', async () => {
    const r = await POST(new Request('http://127.0.0.1/api/internal/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.GF_INTERNAL_EXPORT_KEY as string,
        'x-forwarded-for': '203.0.113.7',
      },
      body: JSON.stringify({ destination: path.join(SAUVEGARDES, 'proxy.db') }),
    }))
    expect(r.status, 'exposée sur le web, cette route deviendrait une fuite de base').toBe(401)
  })
})
