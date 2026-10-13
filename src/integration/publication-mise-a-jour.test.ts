/**
 * GF-027 — publier une mise à jour depuis la Zone Administrateur.
 *
 * ─── Deux défauts, tous deux silencieux côté administrateur ─────────────────
 * 1. `version` n'était que « non vide ». Une saisie comme « Version 1.2.0 » était
 *    acceptée et publiée avec un message de succès. Or la comparaison côté poste
 *    passe par `semver.parseVersion`, qui rend `null` sur une telle chaîne :
 *    `isNewer` vaut faux, et TOUT LE PARC affiche « Vous utilisez la dernière
 *    version » sur une mise à jour pourtant publiée.
 * 2. Ni la version saisie ni l'empreinte du fichier n'étaient confrontées au
 *    manifeste signé joint. Le manifeste fait pourtant AUTORITÉ côté poste :
 *    versions divergentes → la pastille suit le champ libre et l'installation
 *    suit le manifeste ; empreinte divergente → chaque poste télécharge puis
 *    refuse le fichier, et l'administrateur ne l'apprend que par ses clients.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RACINE_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-maj-'))
// `dataRoot()` = dirname(GF_PHOTOS_DIR) — posé AVANT l'import de la route.
process.env.GF_PHOTOS_DIR = path.join(RACINE_DONNEES, 'photos')

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, isAdminSession: async () => true }
})

let POST: (req: Request) => Promise<Response>
const OCTETS = Buffer.from('installeur-de-test-garageflows')
const SHA = crypto.createHash('sha256').update(OCTETS).digest('hex')

function requete(champs: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(champs)) form.append(k, v)
  return new Request('http://localhost/api/admin/updates', { method: 'POST', body: form })
}

const installeur = (octets: Buffer = OCTETS) =>
  new File([new Uint8Array(octets)], 'GarageFlows-Setup.exe', { type: 'application/octet-stream' })

const manifeste = (version: string, sha256: string) =>
  new File(
    [JSON.stringify({ manifest: { product: 'GarageFlow', version, sha256 }, signature: 'AAAA' })],
    'manifest.json',
    { type: 'application/json' },
  )

beforeAll(async () => {
  ;({ POST } = (await import('@/app/api/admin/updates/route')) as any)
})

afterAll(() => { fs.rmSync(RACINE_DONNEES, { recursive: true, force: true }) })

beforeEach(() => {
  fs.rmSync(path.join(RACINE_DONNEES, 'updates'), { recursive: true, force: true })
  fs.rmSync(path.join(RACINE_DONNEES, 'gf_update.json'), { force: true })
})

const fichiersPublies = () => {
  const d = path.join(RACINE_DONNEES, 'updates')
  return fs.existsSync(d) ? fs.readdirSync(d) : []
}

describe('publication d’une mise à jour — version (GF-027)', () => {
  it('REFUSE une version qui n’est pas du SemVer', async () => {
    const res = await POST(requete({ version: 'Version 1.2.0', file: installeur() }))
    expect(res.status, 'le parc ne verrait jamais cette mise à jour').toBe(400)
    expect((await res.json()).error).toMatch(/X\.Y\.Z/)
    expect(fichiersPublies(), 'rien ne doit être écrit').toEqual([])
  })

  it.each(['1.2', 'latest', 'v1.2.0', '1.2.0.0', ''])('REFUSE « %s »', async (version) => {
    const res = await POST(requete({ version, file: installeur() }))
    expect(res.status).toBe(400)
  })

  it('ACCEPTE une version SemVer, avec pré-version', async () => {
    const res = await POST(requete({ version: '1.2.0-beta.1', file: installeur() }))
    const corps = await res.text()
    expect(res.status, corps).toBe(200)
    expect(JSON.parse(corps).update.latestVersion).toBe('1.2.0-beta.1')
  })
})

describe('publication d’une mise à jour — cohérence avec le manifeste signé (GF-027)', () => {
  it('REFUSE un manifeste dont la version diffère de la version saisie', async () => {
    const res = await POST(requete({
      version: '1.2.0', file: installeur(), manifest: manifeste('9.9.9', SHA),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/9\.9\.9/)
    expect(fichiersPublies(), 'l’installeur écrit doit être retiré').toEqual([])
  })

  it('REFUSE un manifeste dont l’empreinte ne correspond pas au fichier', async () => {
    const res = await POST(requete({
      version: '1.2.0', file: installeur(), manifest: manifeste('1.2.0', 'f'.repeat(64)),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/SHA-256/)
    expect(fichiersPublies()).toEqual([])
  })

  it('ACCEPTE un installeur et son manifeste cohérents', async () => {
    const res = await POST(requete({
      version: '1.2.0', file: installeur(), manifest: manifeste('1.2.0', SHA),
    }))
    const texte = await res.text()
    expect(res.status, texte).toBe(200)
    const corps = JSON.parse(texte)
    expect(corps.ok).toBe(true)
    expect(corps.warning, 'un manifeste est présent : pas d’avertissement').toBeNull()
    expect(fichiersPublies()).toHaveLength(1)
  })

  it('publier SANS manifeste reste possible, mais le dit', async () => {
    const res = await POST(requete({ version: '1.2.0', file: installeur() }))
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.update.manifest).toBeNull()
    expect(corps.warning, 'les postes ne pourront pas l’installer automatiquement').toMatch(/manifeste/i)
  })
})
