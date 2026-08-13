/**
 * GF31-AUD-019 — le portail doit dire au serveur DE QUEL GARAGE il s'agit.
 *
 * `resolveGarageId(slug)` (lib/portal/auth-helpers.ts) ne devine le garage que
 * s'il n'y en a **qu'un seul** en base ; sinon il renvoie `null` et la route
 * répond « Garage introuvable ou ambigu (garageSlug requis) ». Or les pages
 * `/portal/login` et `/portal/register` n'envoyaient jamais `garageSlug` : sur
 * le déploiement PWA — multi-tenant par construction, chaque attribution de clé
 * mécanicien y créant un garage miroir — connexion et inscription échouaient
 * systématiquement, sans recours côté client.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const memoire = new Map<string, string>()

// jsdom n'est pas requis : on simule le strict nécessaire de `window`.
const windowSimule = {
  location: { search: '' },
  sessionStorage: {
    getItem: (k: string) => memoire.get(k) ?? null,
    setItem: (k: string, v: string) => { memoire.set(k, v) },
  },
}
vi.stubGlobal('window', windowSimule)

// Import différé : la cible TypeScript du dépôt interdit le `await` de premier
// niveau, et le module doit de toute façon être chargé APRÈS `stubGlobal`.
let garageSlugCourant: typeof import('@/lib/portal/garage-slug').garageSlugCourant
let avecGarageSlug: typeof import('@/lib/portal/garage-slug').avecGarageSlug
let lienPortail: typeof import('@/lib/portal/garage-slug').lienPortail

beforeAll(async () => {
  ;({ garageSlugCourant, avecGarageSlug, lienPortail } = await import('@/lib/portal/garage-slug'))
})

beforeEach(() => {
  memoire.clear()
  windowSimule.location.search = ''
})
afterAll(() => { vi.unstubAllGlobals() })

describe('garageSlugCourant', () => {
  it('lit le slug depuis ?garage=', () => {
    windowSimule.location.search = '?garage=gf-abc123'
    expect(garageSlugCourant()).toBe('gf-abc123')
  })

  it('accepte l’alias court ?g=', () => {
    windowSimule.location.search = '?g=garage-du-centre'
    expect(garageSlugCourant()).toBe('garage-du-centre')
  })

  it('MÉMORISE le slug pour la navigation suivante (étape 2FA, aller-retour)', () => {
    windowSimule.location.search = '?garage=gf-abc123'
    garageSlugCourant()
    windowSimule.location.search = '' // page suivante, sans query string
    expect(garageSlugCourant()).toBe('gf-abc123')
  })

  it('renvoie null sans slug — l’installation mono-garage reste servie par le serveur', () => {
    expect(garageSlugCourant()).toBeNull()
  })

  it('rejette une valeur qui n’est pas un slug plausible', () => {
    for (const hostile of ['../admin', 'AVEC MAJUSCULES', 'a'.repeat(80), 'slug/avec/slash', '<script>']) {
      windowSimule.location.search = `?garage=${encodeURIComponent(hostile)}`
      expect(garageSlugCourant()).toBeNull()
    }
  })

  it('normalise la casse', () => {
    windowSimule.location.search = '?garage=GF-ABC'
    expect(garageSlugCourant()).toBe('gf-abc')
  })
})

describe('avecGarageSlug', () => {
  it('ajoute garageSlug quand il est connu', () => {
    windowSimule.location.search = '?garage=gf-abc'
    expect(avecGarageSlug({ email: 'a@b.c' })).toEqual({ email: 'a@b.c', garageSlug: 'gf-abc' })
  })

  it('n’INVENTE rien quand il est inconnu', () => {
    const corps = avecGarageSlug({ email: 'a@b.c' })
    expect(corps).toEqual({ email: 'a@b.c' })
    expect('garageSlug' in corps).toBe(false)
  })
})

describe('lienPortail', () => {
  it('propage le garage dans un lien interne', () => {
    windowSimule.location.search = '?garage=gf-abc'
    expect(lienPortail('/portal/login')).toBe('/portal/login?garage=gf-abc')
  })

  it('utilise « & » quand le chemin porte déjà une query string', () => {
    windowSimule.location.search = '?garage=gf-abc'
    expect(lienPortail('/portal/account?tab=devis')).toBe('/portal/account?tab=devis&garage=gf-abc')
  })

  it('laisse le lien intact sans garage connu', () => {
    expect(lienPortail('/portal/login')).toBe('/portal/login')
  })
})

describe('GF31-AUD-019 — les pages transmettent réellement le slug', () => {
  it.each([
    ['connexion', 'src/app/portal/login/page.tsx'],
    ['inscription', 'src/app/portal/register/page.tsx'],
  ])('%s : le corps de la requête passe par avecGarageSlug()', async (_l, rel) => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../../../..', rel), 'utf8')
    expect(src).toContain('avecGarageSlug(')
    // Et plus aucun corps d'authentification construit à la main.
    expect(src).not.toMatch(/body: JSON\.stringify\(\{\s*(name|email)/)
  })
})

/**
 * GF31-AUD-032 — la convention n'était PRODUITE nulle part.
 *
 * Les pages savaient lire `?garage=<slug>` et le mémoriser, mais aucun lien de
 * GarageFlows ne portait ce paramètre : sur un déploiement multi-garage, le
 * client n'avait aucun moyen d'arriver sur la bonne page — la moitié aval de la
 * correction manquait. Un client n'aura jamais à taper un slug à la main : le
 * lien doit lui parvenir déjà formé.
 *
 * Ces contrôles portent sur les DEUX seuls endroits où GarageFlows fabrique un
 * lien de portail à destination d'un client.
 */
describe('GF31-AUD-032 — le slug est réellement émis par le produit', () => {
  const lire = async (rel: string) => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    return readFileSync(path.resolve(__dirname, '../../../..', rel), 'utf8')
  }

  it('l’API du suivi par jeton expose le slug du garage', async () => {
    const src = await lire('src/app/api/portal/[token]/route.ts')
    expect(src).toMatch(/garage:\s*\{\s*select:\s*\{[^}]*slug:\s*true/)
  })

  it('la page de suivi propose connexion ET inscription avec le slug', async () => {
    const src = await lire('src/app/portal/[token]/page.tsx')
    expect(src).toContain('/portal/login?garage=')
    expect(src).toContain('/portal/register?garage=')
    expect(src).toContain('encodeURIComponent(data.garage.slug)')
  })

  it('la vérification d’e-mail renvoie vers la connexion en portant le slug', async () => {
    const src = await lire('src/app/api/portal/auth/verify-email/route.ts')
    expect(src).toContain('/portal/login?garage=')
    // …et non plus un JSON brut affiché dans le navigateur du client.
    expect(src).toContain('NextResponse.redirect')
  })
})
