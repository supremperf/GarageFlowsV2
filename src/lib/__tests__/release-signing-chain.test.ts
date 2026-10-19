/**
 * GF-FINAL-021 — la chaîne « signer une release → l'installer » doit exister.
 *
 * `electron/update-verify.js` embarque une clé publique en dur : `signingConfigured()`
 * rend donc TOUJOURS vrai, et `app:install-update` refuse toute installation
 * sans manifeste signé Ed25519 valide. Or aucun outil du dépôt n'en produisait :
 * `npm run release:manifest` écrit un fichier de PROVENANCE DE BUILD (git,
 * toolchain, comptes de tests), sans `manifest` ni `signature`. L'écran de
 * publication et le message d'erreur de l'API désignaient pourtant ce script.
 *
 * Résultat : aucune mise à jour n'était installable sur le parc, quelle que soit
 * la source. Ces tests exercent le VRAI script de signature contre le VRAI
 * vérificateur — pas une reproduction de leur logique.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const SIGNEUR = path.join(RACINE, 'scripts/sign-release-manifest.mjs')

// `require` et non `import` : c'est le module CommonJS réellement chargé par le
// processus principal Electron qui est éprouvé ici, pas une transposition.
const updateVerify = require('../../../electron/update-verify')

let dossier: string
let installeur: string
let clePriveePem: string
let clePubliquePem: string

/** Paire de test — la clé publique est injectée dans le vérificateur réel. */
const KEY_ID = 'gf-test-signing'

/**
 * Version du DÉPÔT — et non un « 9.9.9 » arbitraire.
 *
 * Le signeur refuse désormais de produire un manifeste dont la version, le nom
 * du fichier et l'URL ne concordent pas (GF-013) : signer l'installeur d'une
 * version avec le numéro d'une autre mettait tout le parc en boucle de mise à
 * jour perpétuelle. Ce test suit donc la même règle qu'une vraie release.
 */
const VERSION = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version as string

beforeAll(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-release-'))
  installeur = path.join(dossier, `GarageFlows-Setup-${VERSION}.exe`)
  // Un contenu quelconque mais STABLE : c'est son empreinte qui est signée.
  fs.writeFileSync(installeur, Buffer.from('installeur-de-test-garageflows'))

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  clePriveePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  clePubliquePem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  // Le vérificateur n'accepte que les keyId qu'il connaît : on ajoute la clé de
  // test SANS toucher à la clé de production.
  updateVerify.PUBLIC_KEYS[KEY_ID] = clePubliquePem
})

afterAll(() => {
  delete updateVerify.PUBLIC_KEYS[KEY_ID]
  fs.rmSync(dossier, { recursive: true, force: true })
})

function signer(extra: string[] = [], env: Record<string, string> = {}) {
  const sortie = path.join(dossier, 'manifeste.json')
  execFileSync(process.execPath, [
    SIGNEUR,
    '--file', installeur,
    '--version', VERSION,
    '--download-url', `https://api.garageflows.fr/downloads/GarageFlows-Setup-${VERSION}.exe`,
    '--key-id', KEY_ID,
    '--out', sortie,
    ...extra,
  ], {
    encoding: 'utf8',
    env: { ...process.env, GF_UPDATE_SIGNING_KEY: clePriveePem, ...env },
  })
  return JSON.parse(fs.readFileSync(sortie, 'utf8'))
}

/** Poste plus ANCIEN que la version signée — sinon la mise à jour est refusée. */
const optionsClient = { currentVersion: '0.0.1', channel: 'stable', platform: 'win32', arch: 'x64' }

describe('le script de signature produit un manifeste que le client ACCEPTE', () => {
  it('signe et passe la validation complète du vérificateur Electron', () => {
    const signe = signer()
    expect(signe).toHaveProperty('manifest')
    expect(typeof signe.signature).toBe('string')

    const v = updateVerify.validateManifest(signe, optionsClient)
    expect(v.ok, v.reason).toBe(true)
  })

  it('l\'empreinte signée est bien celle du fichier réel', () => {
    const signe = signer()
    const attendu = crypto.createHash('sha256').update(fs.readFileSync(installeur)).digest('hex')
    expect(signe.manifest.sha256).toBe(attendu)
    expect(signe.manifest.size).toBe(fs.statSync(installeur).size)
  })

  it('porte les champs exigés par le vérificateur', () => {
    const m = signer().manifest
    expect(m.product).toBe('GarageFlow')
    expect(m.signatureAlgorithm).toBe('Ed25519')
    expect(m.keyId).toBe(KEY_ID)
    expect(m.channel).toBe('stable')
    expect(m.platform).toBe('win32')
    expect(m.architecture).toBe('x64')
    expect(m.version).toBe(VERSION)
  })
})

describe('un manifeste ALTÉRÉ est refusé', () => {
  it('empreinte modifiée → signature invalide', () => {
    const signe = signer()
    signe.manifest.sha256 = 'f'.repeat(64)
    expect(updateVerify.validateManifest(signe, optionsClient)).toMatchObject({ ok: false })
  })

  it('URL de téléchargement détournée → signature invalide', () => {
    const signe = signer()
    signe.manifest.downloadUrl = 'https://api.garageflows.fr/downloads/autre.exe'
    expect(updateVerify.validateManifest(signe, optionsClient)).toMatchObject({ ok: false })
  })

  it('version gonflée → signature invalide', () => {
    const signe = signer()
    signe.manifest.version = '99.0.0'
    expect(updateVerify.validateManifest(signe, optionsClient)).toMatchObject({ ok: false })
  })

  it('signature tronquée ou vide → refus', () => {
    for (const sig of ['', 'AAAA', 'pas-du-base64!!']) {
      const signe = signer()
      signe.signature = sig
      expect(updateVerify.validateManifest(signe, optionsClient)).toMatchObject({ ok: false })
    }
  })

  it('signé par une clé INCONNUE du client → refus', () => {
    const signe = signer()
    signe.manifest.keyId = 'clé-jamais-distribuée'
    expect(updateVerify.validateManifest(signe, optionsClient)).toMatchObject({ ok: false })
  })
})

describe('anti-régression : le manifeste de BUILD n\'est pas un manifeste signé', () => {
  it('release-manifest.json est refusé par le vérificateur', () => {
    // C'est exactement le fichier que l'écran de publication demandait.
    // Il est GÉNÉRÉ et gitignoré : sur un checkout propre il n'existe pas, et
    // le test échouait en ENOENT au lieu d'exercer le vérificateur. On le
    // génère donc avec le vrai script — puis on le retire si c'est nous qui
    // l'avons créé, pour laisser l'arbre exactement comme on l'a trouvé.
    const chemin = path.join(RACINE, 'release-manifest.json')
    const creePourLeTest = !fs.existsSync(chemin)
    if (creePourLeTest) {
      execFileSync(process.execPath, [path.join(RACINE, 'scripts/generate-release-manifest.mjs')], {
        cwd: RACINE,
        stdio: 'pipe',
      })
    }
    try {
      const provenance = JSON.parse(fs.readFileSync(chemin, 'utf8'))
      expect(provenance.manifest).toBeUndefined()
      expect(provenance.signature).toBeUndefined()
      expect(updateVerify.validateManifest(provenance, optionsClient)).toMatchObject({ ok: false })
    } finally {
      if (creePourLeTest) fs.rmSync(chemin, { force: true })
    }
  })

  it('l\'écran de publication et l\'API désignent désormais `release:sign`', () => {
    const onglet = fs.readFileSync(path.join(RACINE, 'src/components/settings/UpdatesTab.tsx'), 'utf8')
    const api = fs.readFileSync(path.join(RACINE, 'src/app/api/admin/updates/route.ts'), 'utf8')
    expect(onglet).toContain('release:sign')
    expect(api).toContain('release:sign')
  })

  it('le script de signature est exposé comme script npm', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'))
    expect(pkg.scripts['release:sign']).toBe('node scripts/config-release.cjs')
    const wrapper = fs.readFileSync(path.join(RACINE, 'scripts/config-release.cjs'), 'utf8')
    expect(wrapper).toContain('sign-release-manifest.mjs')
    expect(wrapper).toContain('await import(')
    expect(wrapper).toContain('process.argv.push(')
  })
})

describe('garde-fous du signeur', () => {
  it('refuse un domaine hors liste blanche des postes AU MOMENT de signer', () => {
    // Sinon le refus n'apparaît que sur chaque poste du parc, sans recours
    // autre qu'une nouvelle signature.
    expect(() => signer(['--download-url', 'https://cdn.exemple.test/x.exe'])).toThrow()
  })

  it('refuse une URL non HTTPS', () => {
    expect(() => signer(['--download-url', 'http://api.garageflows.fr/x.exe'])).toThrow()
  })

  it('refuse une version non SemVer', () => {
    expect(() => signer(['--version', 'derniere'])).toThrow()
  })

  it('refuse de signer sans clé privée', () => {
    expect(() => signer([], { GF_UPDATE_SIGNING_KEY: '' })).toThrow()
  })
})

/**
 * GF-FINAL-022 — la publication par la Zone Administrateur était morte.
 *
 * `fetchLatestUpdate()` construit `http://127.0.0.1:<port><downloadPath>` pour
 * l'installeur téléversé par l'administrateur. Mais `app:install-update`
 * remplaçait INCONDITIONNELLEMENT l'URL par celle du manifeste signé, laquelle
 * doit viser un domaine de la liste blanche — où la boucle locale ne figure pas.
 * Un garage sans accès Internet téléversait donc un installeur jamais lu : le
 * téléchargement partait vers api.garageflows.fr et échouait.
 *
 * `electron/main.js` n'est pas importable (il charge `electron`) : on verrouille
 * la source, comme le font déjà les tests electron-* voisins.
 */
describe('publication locale — l\'installeur téléversé est réellement utilisé', () => {
  const mainSrc = fs.readFileSync(path.join(RACINE, 'electron/main.js'), 'utf8')

  it('l\'URL du manifeste n\'écrase plus une URL de boucle locale', () => {
    expect(mainSrc).toMatch(/if \(!urlLocale\) url = v\.manifest\.downloadUrl/)
  })

  it('l\'empreinte et la taille SIGNÉES restent l\'autorité dans tous les cas', () => {
    // C'est ce qui rend l'exception sûre : des octets servis en local qui ne
    // correspondent pas à ce que l'éditeur a signé sont refusés comme les autres.
    const bloc = mainSrc.slice(mainSrc.indexOf('const v = updateVerify.validateManifest'))
    expect(bloc).toMatch(/expectedSha\s*=\s*String\(v\.manifest\.sha256/)
    expect(bloc).toMatch(/expectedSize\s*=\s*v\.manifest\.size/)
  })

  it('la boucle locale reste admise par le contrôle appliqué à chaque saut', () => {
    const verif = fs.readFileSync(path.join(RACINE, 'electron/update-verify.js'), 'utf8')
    const bloc = verif.slice(verif.indexOf('function checkDownloadUrl'))
    expect(bloc).toContain("host === '127.0.0.1'")
  })

  it('la publication locale compare les versions en SEMVER, pas en chaînes', () => {
    // `latestVersion !== currentVersion` proposait une version ANTÉRIEURE
    // republiée par erreur comme une mise à jour.
    const bloc = mainSrc.slice(mainSrc.indexOf('gf_update.json'))
    expect(bloc).toMatch(/semver\.isNewer\(localUpdate\.latestVersion, currentVersion\)/)
    expect(bloc.slice(0, 600)).not.toMatch(/localUpdate\.latestVersion !== currentVersion/)
  })
})

describe('sérialisation canonique — signeur et vérificateur doivent s\'accorder', () => {
  it('l\'ordre des clés du manifeste ne change pas le verdict', () => {
    // Une divergence de canonicalisation produirait une signature rejetée sans
    // explication : la panne la plus coûteuse à diagnostiquer de cette chaîne.
    const signe = signer()
    const melange = Object.keys(signe.manifest).reverse().reduce((acc: Record<string, unknown>, k) => {
      acc[k] = signe.manifest[k]
      return acc
    }, {})
    expect(updateVerify.validateManifest({ manifest: melange, signature: signe.signature }, optionsClient))
      .toMatchObject({ ok: true })
  })
})
