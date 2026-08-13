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
// Chemin OFFICIEL du portail — module pur, sans accès au navigateur : il peut
// être importé statiquement, contrairement à garage-slug (chargé après le
// simulacre de `window`).
import { cheminPortail } from '@/lib/portal/routes'

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
    expect(lienPortail(cheminPortail('login'))).toBe('/clients/login?garage=gf-abc')
  })

  it('utilise « & » quand le chemin porte déjà une query string', () => {
    windowSimule.location.search = '?garage=gf-abc'
    expect(lienPortail(cheminPortail('account') + '?tab=devis')).toBe('/clients/account?tab=devis&garage=gf-abc')
  })

  it('laisse le lien intact sans garage connu', () => {
    expect(lienPortail(cheminPortail('login'))).toBe('/clients/login')
  })
})

describe('GF31-AUD-019 — les pages transmettent réellement le slug', () => {
  it.each([
    ['connexion', 'src/app/clients/login/page.tsx'],
    ['inscription', 'src/app/clients/register/page.tsx'],
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
    const src = await lire('src/app/clients/[token]/page.tsx')
    // Le préfixe n'est plus écrit en dur : il vient de `cheminPortail`, seule
    // source de vérité du chemin portail. On vérifie donc l'appel ET le
    // paramètre, plutôt qu'une URL littérale qui réintroduirait la duplication
    // que ce module a précisément supprimée.
    expect(src).toContain("cheminPortail('login')")
    expect(src).toContain("cheminPortail('register')")
    expect(src).toContain('?garage=')
    expect(src).toContain('encodeURIComponent(data.garage.slug)')
  })

  it('la vérification d’e-mail renvoie vers la connexion en portant le slug', async () => {
    const src = await lire('src/app/api/portal/auth/verify-email/route.ts')
    expect(src).toContain("cheminPortail('login')")
    expect(src).toContain('?garage=')
    // …et non plus un JSON brut affiché dans le navigateur du client.
    expect(src).toContain('NextResponse.redirect')
  })
})

/**
 * GF-FINAL-001 — l'URL OFFICIELLE du portail client est
 * `https://app.garageflows.fr/clients`.
 *
 * Les pages vivaient sous `/portal/*` et le préfixe était réécrit en dur dans
 * onze fichiers ; aucune réécriture n'existait dans `next.config.mjs`, si bien
 * qu'un lien `…/clients/login` communiqué à un client tombait sur un 404. Ces
 * contrôles empêchent le préfixe de se disperser à nouveau.
 */
/** Retire commentaires de ligne et de bloc — pour analyser le CODE, pas la prose. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('GF-FINAL-001 — le portail client vit sous /clients', () => {
  const lire = async (rel: string) => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    return readFileSync(path.resolve(__dirname, '../../../..', rel), 'utf8')
  }

  it('la base officielle est /clients', async () => {
    const { PORTAIL_BASE, cheminPortail, cheminPortailToken } = await import('@/lib/portal/routes')
    expect(PORTAIL_BASE).toBe('/clients')
    expect(cheminPortail()).toBe('/clients')
    expect(cheminPortail('login')).toBe('/clients/login')
    // Tolérant à la barre oblique de tête : les deux formes existent dans le code.
    expect(cheminPortail('/login')).toBe('/clients/login')
    expect(cheminPortailToken('abc.def')).toBe('/clients/abc.def')
  })

  it('les pages du portail sont servies sous src/app/clients', async () => {
    const { existsSync } = await import('node:fs')
    const path = await import('node:path')
    const racine = path.resolve(__dirname, '../../../..')
    for (const page of ['login', 'register', 'account']) {
      expect(existsSync(path.join(racine, 'src/app/clients', page, 'page.tsx')), page).toBe(true)
    }
    // L'ancien emplacement ne doit plus exister : deux arborescences en
    // parallèle produiraient deux portails divergents.
    expect(existsSync(path.join(racine, 'src/app/portal'))).toBe(false)
  })

  it('les liens déjà diffusés (QR codes, e-mails) restent valides par redirection', async () => {
    // Les jetons de portail circulent sur papier et dans des boîtes mail : la
    // bascule ne doit invalider aucun lien existant.
    const config = await lire('next.config.mjs')
    expect(config).toContain('async redirects()')
    expect(config).toContain("source: '/portal/:path*'")
    expect(config).toContain("destination: '/clients/:path*'")
    expect(config).toContain('permanent: true')
  })

  it('aucun producteur de lien n\'écrit le préfixe en dur', async () => {
    // Les cinq endroits qui fabriquent un lien destiné à un client.
    for (const rel of [
      'src/app/api/portal/token/route.ts',
      'src/app/api/portal/generate/route.ts',
      'src/app/api/sync/portal/route.ts',
      'src/app/api/quotes/[id]/signature-token/route.ts',
      'src/app/api/portal/auth/verify-email/route.ts',
    ]) {
      const src = await lire(rel)
      expect(src, `${rel} doit passer par @/lib/portal/routes`).toContain('@/lib/portal/routes')
      // Un chemin de PAGE écrit en dur (`/portal/<quelque chose>`) est interdit ;
      // les chemins d'API (`/api/portal/...`), eux, restent inchangés.
      const enDur = src.match(/(?<!\/api)\/portal\/\$\{/g)
      expect(enDur, `${rel} : chemin de page portail écrit en dur`).toBeNull()
    }
  })

  it('le lien tokenisé n\'est jamais construit depuis l\'en-tête Origin', async () => {
    // `Origin` est fourni par le client : un lien de portail bâti dessus part
    // vers le domaine que l'appelant choisit, jeton d'accès compris.
    //
    // Les COMMENTAIRES sont retirés avant l'analyse : la note qui documente ce
    // défaut cite forcément l'expression fautive, et la faire échouer sur sa
    // propre explication pousserait à appauvrir le commentaire pour satisfaire
    // le test.
    const src = sansCommentaires(await lire('src/app/api/portal/token/route.ts'))
    expect(src).not.toMatch(/headers\.get\(\s*['"]origin['"]\s*\)/i)
    expect(src).toContain('publicUrlFor(')
  })
})
