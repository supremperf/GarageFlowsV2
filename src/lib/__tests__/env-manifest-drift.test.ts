/**
 * DÉRIVE DU MANIFESTE D'ENVIRONNEMENT.
 *
 * `scripts/garageflow-env-manifest.json` est la SOURCE DE VÉRITÉ unique des
 * variables de configuration : RESET-GARAGEFLOW et le configurateur PowerShell
 * en dérivent ce qu'ils créent, conservent ou valident.
 *
 * Le problème structurel : ajouter un `process.env.X` dans le code ne casse
 * rien. Le manifeste — et donc le RESET — devient obsolète en silence, et
 * l'écart n'apparaît qu'à la mise en service d'une nouvelle version chez un
 * garage. Ce test relit le code À CHAQUE EXÉCUTION et échoue sur toute variable
 * consommée mais non déclarée.
 *
 * Il verrouille aussi les règles de ROTATION : un secret dont la rotation rend
 * des données existantes illisibles ne doit JAMAIS être régénéré automatiquement.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const MANIFEST = path.join(ROOT, 'scripts', 'garageflow-env-manifest.json')

/** Racines applicatives : ce que le PRODUIT lit à l'exécution. */
const SCAN_ROOTS = ['src', 'electron', 'prisma', 'scripts']
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'generated', '__tests__', 'coverage'])
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py'])

/**
 * Variables fournies par la plateforme (Node, Electron, Vercel, CI) ou propres
 * aux harnais de test : elles ne se configurent pas et n'ont donc pas à figurer
 * au manifeste.
 */
// La liste vit désormais DANS le manifeste (`platformProvided`) : ce test et la
// garde `check:env-consistency` doivent lire la MÊME source. Deux listes
// recopiées finissent toujours par diverger, et c'est exactement ce genre de
// divergence — un même rôle décrit à deux endroits — que l'audit du 15/08/2026
// avait pour objet d'éliminer.
//
// Elle couvre : ce que fournit la plateforme (Node, Electron, Vercel, CI), les
// harnais de test jamais lus en production (dont GF_TEST_ALLOW_UPSTASH, qui
// autorise le SEUL fichier testant la sélection du backend de quotas à voir une
// configuration Upstash — sans quoi `npm test` ouvrait des compteurs sur le
// Redis de PRODUCTION, GF-041), et NEXT_PUBLIC_GF_VERSION, injectée au build
// par next.config.mjs depuis package.json.
let PLATFORM_PROVIDED: Set<string>

const PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /os\.environ\.get\(\s*['"]([^'"]+)['"]/g,
  /os\.environ\[\s*['"]([^'"]+)['"]\s*\]/g,
  /os\.getenv\(\s*['"]([^'"]+)['"]/g,
]

interface ManifestVariable {
  name: string
  classification: string
  rotationRisk?: string
  autoGenerate?: boolean
  autoManage?: boolean
  consumers?: string[]
  notes?: string
}

const usage = new Map<string, Set<string>>()
let manifest: { variables: ManifestVariable[]; platformProvided?: string[] }

function record(name: string, file: string) {
  if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return
  if (!usage.has(name)) usage.set(name, new Set())
  usage.get(name)!.add(path.relative(ROOT, file).replace(/\\/g, '/'))
}

function walk(dir: string) {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) { walk(full); continue }
    if (!SCAN_EXT.has(path.extname(entry))) continue
    // Les fichiers de test peuvent injecter des variables factices.
    if (/\.(test|spec)\.[tj]sx?$/.test(entry) || entry.startsWith('test_')) continue
    // Outils de charge/diagnostic exécutés à la main par un développeur : leurs
    // variables ne font pas partie de la configuration livrée à un garage.
    if (entry === 'loadtest.mjs') continue
    const src = readFileSync(full, 'utf8')
    for (const re of PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) record(m[1], full)
    }
  }
}

beforeAll(() => {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  PLATFORM_PROVIDED = new Set(manifest.platformProvided ?? [])
  for (const root of SCAN_ROOTS) {
    const dir = path.join(ROOT, root)
    if (existsSync(dir)) walk(dir)
  }
})

describe('Manifeste ⇄ code', () => {
  it('le balayage trouve réellement des variables (le test ne peut pas devenir vide)', () => {
    expect(usage.size).toBeGreaterThan(20)
    expect(manifest.variables.length).toBeGreaterThan(50)
    // `platformProvided` vient du manifeste : si la clé disparaissait, la liste
    // deviendrait vide et le test échouerait en signalant des dizaines de
    // fausses variables non déclarées. On préfère l'échec explicite ici.
    expect(PLATFORM_PROVIDED.size).toBeGreaterThan(20)
  })

  it('toute variable lue par le produit est DÉCLARÉE au manifeste', () => {
    const declared = new Set(manifest.variables.map(v => v.name))
    const undeclared: string[] = []
    usage.forEach((files, name) => {
      if (PLATFORM_PROVIDED.has(name) || declared.has(name)) return
      undeclared.push(`${name} — lu par ${Array.from(files).slice(0, 3).join(', ')}`)
    })

    expect(
      undeclared,
      'Variables consommées mais absentes de scripts/garageflow-env-manifest.json.\n' +
      'Ajoutez-les au manifeste (RESET-GARAGEFLOW en dérive sa configuration), ' +
      'ou à PLATFORM_PROVIDED si la plateforme les fournit :\n  ' + undeclared.join('\n  '),
    ).toEqual([])
  })

  it('aucun doublon dans le manifeste', () => {
    const names = manifest.variables.map(v => v.name)
    expect(names.length).toBe(new Set(names).size)
  })

  it('chaque entrée porte les champs dont les scripts ont besoin', () => {
    for (const v of manifest.variables) {
      expect(typeof v.name, `nom manquant`).toBe('string')
      expect(typeof v.classification, `classification manquante pour ${v.name}`).toBe('string')
      expect(['low', 'medium', 'high', 'critical'], `rotationRisk invalide pour ${v.name}`)
        .toContain(v.rotationRisk)
    }
  })
})

describe('Politique de rotation des secrets', () => {
  /**
   * Secrets dont la rotation rend DÉFINITIVEMENT illisibles des données déjà
   * écrites. Les régénérer automatiquement est une perte de données, pas une
   * mesure de sécurité — précédent réel : GF_SMTP_CIPHER_KEY et GF_TOTP_ENC_KEY
   * régénérés à chaque reset avaient rendu mots de passe SMTP et secrets TOTP
   * indéchiffrables.
   */
  const NEVER_AUTO_ROTATE = [
    'GF_SMTP_CIPHER_KEY',      // chiffre les mots de passe SMTP au repos
    'GF_TOTP_ENC_KEY',         // chiffre les secrets TOTP au repos
    'GF_SMTP_CIPHER_KEY_OLD',  // clé de migration : la régénérer annule la rotation
    'GF_EINVOICE_CREDENTIALS_KEY',
    'GF_BACKUP_KEY',           // déchiffre les sauvegardes déjà produites
  ]

  it('les clés de chiffrement AU REPOS ne sont jamais régénérées automatiquement', () => {
    for (const name of NEVER_AUTO_ROTATE) {
      const v = manifest.variables.find(x => x.name === name)
      if (!v) continue // la variable n'existe pas dans cette version
      expect(v.autoGenerate, `${name} ne doit pas être auto-généré (données déjà chiffrées)`).toBe(false)
      expect(v.autoManage, `${name} ne doit pas être auto-géré`).toBe(false)
    }
  })

  it('un secret critique auto-généré expose sa conséquence dans ses notes', () => {
    // Rotation admise (NEXTAUTH_SECRET → reconnexion, DEVICE_TOKEN_PEPPER →
    // réactivation) MAIS jamais silencieuse : la conséquence doit être écrite.
    for (const v of manifest.variables) {
      if (v.rotationRisk !== 'critical' || v.autoGenerate !== true) continue
      expect(
        (v.notes ?? '').length,
        `${v.name} est régénéré automatiquement et critique : documentez la conséquence dans "notes"`,
      ).toBeGreaterThan(30)
    }
  })

  it('les secrets de licence/portail restent classés au bon niveau de risque', () => {
    // Faire tourner ces secrets invalide des jetons DÉJÀ remis à des clients.
    for (const name of ['GF_PORTAL_SECRET', 'DEVICE_TOKEN_PEPPER', 'GF_UPDATE_SIGNING_KEY']) {
      const v = manifest.variables.find(x => x.name === name)
      if (!v) continue
      expect(['high', 'critical'], `${name} sous-évalué`).toContain(v.rotationRisk)
    }
  })
})

describe('URLs de production', () => {
  it('la base publique documente que localhost est écarté', () => {
    const v = manifest.variables.find(x => x.name === 'GF_APP_URL')
    expect(v, 'GF_APP_URL doit être déclarée : elle construit les liens portail').toBeTruthy()
    expect(v!.notes ?? '').toMatch(/localhost/)
  })
})
