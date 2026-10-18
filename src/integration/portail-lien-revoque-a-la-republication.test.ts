/**
 * GF-002 — « Lien invalide ou expiré » sur un lien portail qui vient d'être créé.
 *
 * ─── Ce que le test précédent ne pouvait pas voir ───────────────────────────
 * `src/app/api/sync/__tests__/portal-snapshot.test.ts` affirme :
 *
 *     it('republier la même intervention reste exploitable (nouveau jeton)')
 *       → attend 200 sur l'ANCIEN jeton comme sur le nouveau
 *
 * et il passe. Mais son simulacre de base déclare
 * `portalSnapshot.deleteMany: async () => ({ count: 0 })` : un NO-OP. Or la
 * route, elle, supprime réellement tous les instantanés de l'intervention sauf
 * le nouveau, dans la même transaction que l'écriture. Le test valide donc une
 * base qui ne se comporte pas comme la vraie — il est vert contre une fiction.
 *
 * Ici la base est RÉELLE (SQLite au schéma du projet) et `deleteMany` s'exécute
 * pour de bon. Seule la vérification de SIGNATURE de la licence est simulée :
 * signer un jeton GF2 demande la clé privée de l'exploitant, qui n'est pas dans
 * le dépôt. Tout le reste — Prisma, transactions, signature et vérification JWT
 * par `jose`, les deux handlers — est le code de production.
 *
 * ─── Le défaut de produit ───────────────────────────────────────────────────
 * Publier à nouveau une intervention TUE le lien déjà remis au client. Deux
 * chemins y mènent, tous deux ordinaires :
 *
 *  1. `PortalLinkSection` (JobModalFooter) monte `<JobQRCode>` ET appelle
 *     `usePortalUrl` : DEUX POST /api/portal/generate concurrents à chaque
 *     ouverture de la fiche. Le second révoque le premier — le QR code affiché
 *     et le lien « copier » ne peuvent donc pas être valides tous les deux.
 *     C'est le « lien invalide IMMÉDIATEMENT » constaté.
 *  2. Rouvrir la fiche d'intervention une semaine plus tard republie, et le lien
 *     que le client a reçu cesse de fonctionner sans que personne n'agisse.
 *
 * L'intention d'origine — pouvoir se rétracter après une publication de trop —
 * reste satisfaite par la correction : l'instantané VIVANT de l'intervention est
 * RÉUTILISÉ et son contenu remplacé. Une photo retirée disparaît donc aussi de
 * l'ancien lien, qui sert le même instantané. Ce qui disparaît, c'est la
 * révocation ACCIDENTELLE d'une URL déjà distribuée.
 */
type OriginalModule1 = typeof import('@/lib/license/verify')

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computeRecordMac } from '@/lib/license/record-mac'

const DB_PATH = path.resolve(__dirname, '../../.tmp-portail-republication.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PORTAL_SECRET = 'secret-portail-de-test-suffisamment-long-0123456789'
process.env.NEXTAUTH_SECRET = 'secret-portail-de-test-suffisamment-long-0123456789'

const LID = 'lid-garage-recette'

// Seule la SIGNATURE de la licence est simulée (clé privée absente du dépôt) :
// la ligne LicenseKey, elle, est vraie et tous les contrôles d'état (révoquée,
// expirée, rattachement) s'exécutent réellement.
vi.mock('@/lib/license/verify', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return {
    ...reel,
    verifyLicenseToken: (token: string) =>
      token === 'GF2.licence-garage-de-recette'
        ? {
            valid: true,
            isMechanic: false,
            isAdmin: false,
            payload: {
              lid: LID, cid: 'c', typ: 'premium', iss: 0,
              exp: Math.floor(Date.now() / 1000) + 86_400,
              seats: 1, wm: '', ver: '2',
            },
          }
        : { valid: false, reason: 'inconnu' },
  }
})

let prisma: any
let PUBLIER: (req: Request) => Promise<Response>
let LIRE: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
const ids = { garage: '', job: '' }

const CONTENU = {
  customerName: 'Jean Client', vehicleModel: 'Clio', licensePlate: 'AA-123-BB',
  status: 'in_progress', date: '2026-08-14', startTime: '09:00', repairType: 'oil_change',
  notes: null, mechanic: null, photos: [], quote: null,
  garage: { name: 'Garage Recette', slug: 'garage-recette', phone: null, email: null, logoBase64: null, logoPath: null },
}

function requetePublication(contenu: Record<string, unknown> = CONTENU) {
  return new Request('http://x/api/sync/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      garageLicense: 'GF2.licence-garage-de-recette',
      garageId: ids.garage,
      jobId: ids.job,
      payload: contenu,
    }),
  })
}

const publier = async () => (await PUBLIER(requetePublication())).json()
const lire = (token: string) => LIRE(new Request('http://x'), { params: { token } })

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: PUBLIER } = (await import('@/app/api/sync/portal/route')) as any)
  ;({ GET: LIRE } = (await import('@/app/api/portal/[token]/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Recette', slug: 'garage-recette' } })
  ids.garage = garage.id
  // AUCUN `Job` n'est créé : c'est la situation RÉELLE du cloud face à un garage
  // installé en local — l'intervention n'existe que dans le SQLite du poste, et
  // seul l'instantané publié permet de servir la page. Créer un Job ici ferait
  // répondre le chemin hérité (`job.findFirst`) et masquerait entièrement le
  // défaut : c'est ce qui est arrivé à la première version de ce test.
  ids.job = 'job-qui-n-existe-que-sur-le-poste'

  const licenseData = {
    licenseId: LID, token: 'GF2.licence-garage-de-recette', customerId: 'c',
    licenseType: 'premium', status: 'active', expiryAt: new Date(Date.now() + 86_400_000),
    garageId: garage.id, hwid: null,
  }
  // The actual sync guard requires a real MAC even when only the GF2 signature
  // is mocked. Keep this protection active, rather than bypassing it in tests.
  await prisma.licenseKey.create({ data: { ...licenseData, recordMac: computeRecordMac(licenseData) } })
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const suffixe of ['', '-journal', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${suffixe}`, { force: true })
  }
})

beforeEach(async () => {
  await prisma.portalSnapshot.deleteMany({})
})

describe('portail — republier ne doit pas tuer le lien déjà remis au client (GF-002)', () => {
  it('MAC absent → publication refusée sans créer un instantané', async () => {
    const original = await prisma.licenseKey.findUniqueOrThrow({ where: { licenseId: LID } })
    try {
      await prisma.licenseKey.update({ where: { licenseId: LID }, data: { recordMac: null } })
      const response = await PUBLIER(requetePublication())
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('LICENSE_TAMPERED')
      expect(await prisma.portalSnapshot.count()).toBe(0)
    } finally {
      await prisma.licenseKey.update({ where: { licenseId: LID }, data: { recordMac: original.recordMac } })
    }
  })

  it('publication simple : le lien est lisible', async () => {
    const a = await publier()
    expect(a.ok).toBe(true)
    const res = await lire(a.token)
    expect(res.status).toBe(200)
    expect((await res.json()).customerName).toBe('Jean Client')
  })

  it('DEUX publications concurrentes (QR + lien « copier ») : les DEUX jetons restent lisibles', async () => {
    // C'est exactement ce que fait l'ouverture d'une fiche d'intervention :
    // <JobQRCode> et usePortalUrl appellent /api/portal/generate chacun de leur
    // côté. Avant correction, le second POST supprimait l'instantané du premier
    // et le QR code affiché à l'écran pointait déjà vers un lien mort.
    const [a, b] = await Promise.all([publier(), publier()])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)

    expect((await lire(a.token)).status, 'le jeton du QR code doit rester valide').toBe(200)
    expect((await lire(b.token)).status, 'le jeton du lien copié doit rester valide').toBe(200)
  })

  it('republication séquentielle : le lien déjà distribué survit', async () => {
    const premier = await publier()
    const second = await publier()

    expect((await lire(premier.token)).status, 'lien remis au client la semaine passée').toBe(200)
    expect((await lire(second.token)).status).toBe(200)
  })

  it('une seule publication VIVANTE par intervention (pas d’accumulation sans borne)', async () => {
    await publier(); await publier(); await publier()
    const vivants = await prisma.portalSnapshot.count({ where: { garageId: ids.garage, jobId: ids.job } })
    expect(vivants, 'un instantané et un seul par intervention').toBe(1)
  })

  it('la rétractation fonctionne : le contenu retiré disparaît AUSSI de l’ancien lien', async () => {
    // L'intention défendue par la révocation d'origine — se rétracter d'une
    // publication de trop — doit rester satisfaite.
    const avec = await (await PUBLIER(requetePublication({
      ...CONTENU, notes: 'PHOTO LITIGIEUSE PUBLIÉE PAR ERREUR',
    }))).json()
    expect(JSON.stringify(await (await lire(avec.token)).json())).toContain('LITIGIEUSE')

    await PUBLIER(requetePublication({ ...CONTENU, notes: null }))

    const apres = await lire(avec.token)
    expect(apres.status, 'l’ancien lien reste lisible').toBe(200)
    expect(JSON.stringify(await apres.json()), 'mais le contenu retiré a disparu').not.toContain('LITIGIEUSE')
  })

  it('un instantané périmé reste refusé', async () => {
    const a = await publier()
    const claims = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString())
    await prisma.portalSnapshot.update({
      where: { id: claims.jti },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await lire(a.token)).status).toBe(403)
  })

  it('l’instantané d’un autre garage n’est jamais servi', async () => {
    const a = await publier()
    const claims = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString())
    await prisma.portalSnapshot.update({ where: { id: claims.jti }, data: { garageId: 'un-autre-garage' } })
    const res = await lire(a.token)
    expect([403, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('Jean Client')
  })
})
