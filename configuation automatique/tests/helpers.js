'use strict'
/**
 * Outils communs aux tests.
 *
 * Deux principes :
 *   · aucun test ne touche au dépôt réel en écriture — chacun travaille dans un
 *     dossier temporaire supprimé à la fin ;
 *   · aucun test ne mute une ressource distante. Les scénarios Vercel utilisent
 *     des instantanés construits à la main, de la même forme que ceux que le
 *     fournisseur produit réellement, ce qui permet de vérifier les décisions
 *     sans écrire une ligne chez le fournisseur.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RACINE_PROJET = path.resolve(__dirname, '..', '..')

/** Dossier temporaire isolé, supprimé par `nettoyer()`. */
function dossierTemporaire(prefixe = 'gf-config-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe))
}

function nettoyer(dossier) {
  try {
    fs.rmSync(dossier, { recursive: true, force: true })
  } catch { /* le système reprendra la main */ }
}

/**
 * Crée un dépôt factice contenant le strict nécessaire pour charger le
 * manifeste et les validations du projet. Les fichiers sont COPIÉS depuis le
 * dépôt réel : un test qui s'appuierait sur un manifeste réécrit à la main
 * cesserait de refléter le contrat réel.
 */
function depotFactice() {
  const racine = dossierTemporaire('gf-depot-')
  const copier = (relatif) => {
    const source = path.join(RACINE_PROJET, relatif)
    const cible = path.join(racine, relatif)
    fs.mkdirSync(path.dirname(cible), { recursive: true })
    fs.copyFileSync(source, cible)
  }
  for (const fichier of [
    '.env.example',
    'scripts/config-core.cjs',
    'scripts/config-policy.cjs',
    'scripts/config-rebuild.cjs',
    'scripts/config-services.cjs',
    'scripts/garageflow-env-manifest.json',
    'scripts/compromised-secrets.json',
    'scripts/lib/config-credentials.cjs',
    'scripts/lib/config-vercel-api.cjs',
    'scripts/lib/config-vercel-env.cjs',
    'scripts/lib/config-cloud.cjs',
    'src/lib/license/public-key.ts',
  ]) copier(fichier)

  fs.writeFileSync(path.join(racine, 'package.json'), JSON.stringify({ name: 'depot-factice', private: true }, null, 2) + '\n')
  // Ancrage Electron minimal : seule la forme du tableau `_PK` compte pour
  // l'inspection de l'autorité.
  const clePublique = fs.readFileSync(path.join(RACINE_PROJET, 'src/lib/license/public-key.ts'), 'utf8')
  const lignes = [...clePublique.matchAll(/'([^']*)'/g)].map((correspondance) => correspondance[1])
  fs.mkdirSync(path.join(racine, 'electron'), { recursive: true })
  fs.writeFileSync(path.join(racine, 'electron/main.js'),
    'const _PK = [\n' + lignes.map((ligne) => "  '" + ligne + "',").join('\n') + '\n]\n')
  return racine
}

/** Écrit un fichier dans un dépôt de test. */
function ecrire(racine, relatif, contenu) {
  const complet = path.join(racine, relatif)
  fs.mkdirSync(path.dirname(complet), { recursive: true })
  fs.writeFileSync(complet, contenu)
  return complet
}

function lire(racine, relatif) {
  try {
    return fs.readFileSync(path.join(racine, relatif), 'utf8')
  } catch {
    return null
  }
}

/**
 * Instantané Vercel de la même forme que celui produit par `providers/vercel.js`.
 *
 * @param {object} description
 *   - cible : 'development' | 'preview' | 'production'
 *   - lisibles : { NOM: valeur } variables dont la valeur est relisible
 *   - cachees : [NOM] présentes mais protégées en lecture (Sensitive)
 *   - protegees : [NOM] détenues par une intégration Marketplace
 */
function instantaneVercel(description) {
  const lisibles = description.lisibles || {}
  const cachees = description.cachees || []
  const protegees = description.protegees || []
  const noms = [...new Set([...Object.keys(lisibles), ...cachees, ...protegees])]
  const enregistrements = noms.map((nom, index) => ({
    id: 'env_' + index + '_' + nom.toLowerCase(),
    key: nom,
    target: [description.cible],
    type: cachees.includes(nom) ? 'sensitive' : 'encrypted',
    gitBranch: null,
    customEnvironmentIds: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    visibility: 'secret',
    // Une variable d'intégration porte un `configurationId` : c'est ce champ
    // que `protectedRecord()` observe pour refuser toute modification.
    configurationId: protegees.includes(nom) ? 'icfg_test' : null,
    integrationId: protegees.includes(nom) ? 'oac_test' : null,
    contentHint: null,
    comment: undefined,
  }))
  return {
    cible: description.cible,
    enregistrements,
    presentes: new Set(noms),
    valeurs: { ...lisibles },
    aliasRessources: description.aliasRessources || {},
    cachees: new Set(cachees),
    protegees: new Set(protegees),
    empreintes: {},
    surchargesBranche: description.surchargesBranche || 0,
    lecture: description.lecture || 'lue',
  }
}

/**
 * Octets déterministes mais NON constants.
 *
 * Un `Buffer.alloc(32, 7)` produit 32 octets identiques : le contrôle
 * d'entropie de `security/secrets.js` le refuse à juste titre, et un test bâti
 * sur une telle valeur échouerait pour une raison qui n'a rien à voir avec ce
 * qu'il prétend vérifier.
 */
function octetsVaries(graine) {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 37 + graine * 11 + 5) & 0xff))
}

/** Valeurs d'exemple conformes aux formats attendus (jamais de vrai secret). */
const VALEURS_TEST = {
  base64_32: octetsVaries(1).toString('base64'),
  base64_32_bis: octetsVaries(2).toString('base64'),
  hex_32: octetsVaries(3).toString('hex'),
  urlPoolee: 'postgresql://utilisateur:motdepasse-de-test@ep-exemple-pooler.c-1.eu-central-1.aws.neon.tech/garageflow?sslmode=require',
  urlDirecte: 'postgresql://utilisateur:motdepasse-de-test@ep-exemple.c-1.eu-central-1.aws.neon.tech/garageflow?sslmode=require',
  redisUrl: 'https://exemple-12345.upstash.io',
  redisToken: 'A'.repeat(48),
}

module.exports = { RACINE_PROJET, dossierTemporaire, nettoyer, depotFactice, ecrire, lire, instantaneVercel, octetsVaries, VALEURS_TEST }
