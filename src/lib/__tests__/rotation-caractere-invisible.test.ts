/**
 * NON-RÉGRESSION — INCIDENT DE ROTATION DU 2026-08-16
 *
 * CE QUI S'EST PASSÉ
 * `scripts/reset-garageflow.ps1` pousse les secrets vers Vercel en les écrivant
 * sur l'entrée standard de la CLI (`$valeur | & vercel env add …`). Le lanceur
 * `RESET-GARAGEFLOW.cmd` exécute d'abord « chcp 65001 » : `[Console]::InputEncoding`
 * devient alors un UTF8Encoding dont `GetPreamble()` vaut EF BB BF, et Windows
 * PowerShell 5.1 écrit ce préambule AVANT la valeur. Vercel a donc enregistré
 * « <U+FEFF>postgresql://… » pour les treize variables poussées ce jour-là.
 *
 * Le caractère est INVISIBLE : identique à l'œil dans le tableau de bord, et
 * `vercel env pull` rend « [SENSITIVE] » pour un secret — il est donc impossible
 * de le voir en relisant la valeur. Le seul symptôme fut un HTTP 500 sur TOUTES
 * les routes, avec la page HTML générique de Next.js : `assertEnv()` levait dans
 * le hook d'instrumentation et le serveur n'était jamais préparé.
 *
 * POURQUOI RIEN NE L'A ATTRAPÉ
 *   1. la sonde de vérification du script appelait `clean()` — qui retire
 *      justement U+FEFF — AVANT de tester le schéma : elle validait une valeur
 *      que le runtime ne voit jamais ;
 *   2. cette sonde n'était de toute façon jamais appelée (fonction morte) ;
 *   3. `String.prototype.trim()` retire U+FEFF en JavaScript, si bien que TOUTES
 *      les vérifications écrites avec `.trim()` passent — c'est précisément le
 *      contrôle DATABASE_URL, écrit sans `trim()`, qui a fini par le révéler.
 *
 * CES TESTS VERROUILLENT :
 *   · un préfixe invisible sur DATABASE_URL reste un échec de démarrage ;
 *   · le message NOMME le point de code, et n'expose jamais l'URL ;
 *   · le piège du `.trim()` est documenté par un test, pour qu'un futur
 *     « nettoyage » de la validation ne rouvre pas la brèche en silence.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { validateEnv, assertEnv } from '@/lib/env'

const OLD = { ...process.env }
afterEach(() => {
  process.env = { ...OLD }
  vi.unstubAllEnvs()
})

/** Configuration PWA production par ailleurs valide — seul l'URL varie. */
function productionPwaValide(databaseUrl: string): void {
  vi.stubEnv('NODE_ENV', 'production')
  delete process.env.ELECTRON
  process.env.DATABASE_URL = databaseUrl
  process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
  process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
  process.env.TRUST_PROXY_HEADERS = '1'
}

const URL_NEON = 'postgresql://user:motdepasse@ep-exemple.eu-central-1.aws.neon.tech/neondb?sslmode=require'

describe('rotation — caractère invisible en tête d’une variable (incident 2026-08-16)', () => {
  it('DATABASE_URL préfixée d’un U+FEFF refuse le démarrage', () => {
    productionPwaValide(`\uFEFF${URL_NEON}`)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.map((i) => i.name)).toContain('DATABASE_URL')
  })

  it('le message NOMME le point de code et n’expose JAMAIS l’URL', () => {
    productionPwaValide(`\uFEFF${URL_NEON}`)
    const probleme = validateEnv().issues.find((i) => i.name === 'DATABASE_URL')?.problem ?? ''

    // Nommer le coupable : « ? » aurait désigné aussi bien une espace insécable
    // qu'un guillemet — trois heures de recherche pour un caractère de trois octets.
    expect(probleme).toContain('U+FEFF')

    // Le message part dans les journaux d'exécution : il ne doit porter ni hôte,
    // ni identifiants, ni base.
    expect(probleme).not.toContain('motdepasse')
    expect(probleme).not.toContain('neon.tech')
    expect(probleme).not.toContain('neondb')
  })

  it('assertEnv lève, et la levée reste exempte de secret', () => {
    productionPwaValide(`\uFEFF${URL_NEON}`)
    expect(() => assertEnv()).toThrow(/U\+FEFF/)
    expect(() => assertEnv()).not.toThrow(/motdepasse/)
  })

  it.each([
    ['U+FEFF (marque d’ordre d’octets)', '\uFEFF'],
    ['U+200B (espace de largeur nulle)', '\u200B'],
    ['U+00A0 (espace insécable)', '\u00A0'],
    ['espace ordinaire', ' '],
  ])('un préfixe « %s » est refusé, jamais avalé en silence', (_nom, prefixe) => {
    productionPwaValide(`${prefixe}${URL_NEON}`)
    expect(validateEnv().ok).toBe(false)
  })

  it('la même URL SANS préfixe est acceptée — le test discrimine bien le caractère', () => {
    productionPwaValide(URL_NEON)
    expect(validateEnv().ok).toBe(true)
  })

  /**
   * PIÈGE STRUCTUREL. En JavaScript, U+FEFF fait partie de la production
   * WhiteSpace : `trim()` le retire. Toute validation écrite « proprement » avec
   * `.trim()` accepte donc une valeur corrompue — et c'est exactement pourquoi
   * onze des douze variables atteintes sont passées inaperçues. Ce test fige la
   * connaissance : si quelqu'un ajoute `.trim()` au contrôle DATABASE_URL pour
   * « robustifier », le test précédent tombera et renverra ici.
   */
  it('documente que trim() masque U+FEFF — d’où la validation sans trim', () => {
    expect(`\uFEFF${URL_NEON}`.trim()).toBe(URL_NEON)
    expect(/^postgres(ql)?:\/\//i.test(`\uFEFF${URL_NEON}`)).toBe(false)
    expect(/^postgres(ql)?:\/\//i.test(`\uFEFF${URL_NEON}`.trim())).toBe(true)
  })

  /**
   * Le préambule UTF-8 est EF BB BF : trois octets pour un seul caractère. Un
   * contrôle de longueur en OCTETS ne verrait donc pas la même chose qu'un
   * contrôle en caractères — la sonde de diagnostic rapporte les deux.
   */
  it('un U+FEFF pèse 3 octets pour 1 caractère — les deux mesures diffèrent', () => {
    const corrompu = `\uFEFF${URL_NEON}`
    expect(corrompu.length).toBe(URL_NEON.length + 1)
    expect(Buffer.byteLength(corrompu, 'utf8')).toBe(Buffer.byteLength(URL_NEON, 'utf8') + 3)
    expect(Buffer.from(corrompu, 'utf8').subarray(0, 3).toString('hex')).toBe('efbbbf')
  })
})
