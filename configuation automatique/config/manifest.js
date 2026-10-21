'use strict'
/**
 * MANIFESTE UNIFIÉ DES VARIABLES.
 *
 * Trois sources décrivent la configuration de GarageFlows, et elles ne sont pas
 * interchangeables :
 *
 *   1. `scripts/garageflow-env-manifest.json` — le contrat déclaré : rôle,
 *      portée, format, criticité, consommateurs attendus ;
 *   2. `scripts/config-policy.cjs` — la disposition : ce que l'outillage a le
 *      droit de provisionner, et où ;
 *   3. le CODE lui-même — ce qui est réellement lu à l'exécution.
 *
 * Le cahier des charges demande explicitement de ne pas se limiter aux fichiers
 * d'exemple et de découvrir les variables réellement consommées. On croise donc
 * les trois sources et on SIGNALE les divergences : une variable lue par le code
 * mais absente du contrat est un trou de configuration, et une variable déclarée
 * que plus personne ne lit est une fausse obligation. Aucune des deux n'est
 * corrigée en silence — le manifeste du dépôt reste la référence versionnée.
 */

const fs = require('node:fs')
const path = require('node:path')

const DOSSIERS_IGNORES = new Set([
  '.git', 'node_modules', '.next', 'dist', 'dist-artifact', 'out', 'build', 'coverage',
  '__pycache__', '.venv', '.vercel', 'playwright-report', 'test-results', 'artifacts',
  'src/generated', 'GarageFlow-configuration', '.gf-anchor-backups', 'vendor', 'release',
  // Les campagnes d'audit archivées contiennent des outils jetables qui lisent
  // leurs propres variables (LABEL, MODE, WEB_STATE…). Les compter comme des
  // consommateurs du logiciel ferait apparaître une quinzaine de fausses
  // variables manquantes à chaque exécution.
  'docs',
])

const EXTENSIONS_CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|ps1|prisma|yml|yaml|cmd|sh)$/

/**
 * Nature d'un emplacement de lecture.
 *
 * La distinction compte : `src/lib/env.ts` prouve qu'une variable est consommée
 * par le logiciel ; `src/lib/__tests__/env-contract.test.ts` prouve seulement
 * qu'un test en parle — et certains tests citent volontairement des noms
 * fautifs (`DATABSE_URL`) ou des alias interdits pour vérifier qu'ils sont
 * rejetés. Confondre les deux inventerait des variables à provisionner.
 */
function categorieFichier(relatif) {
  if (/(?:^|\/)__tests__\//.test(relatif) || /\.test\.[cm]?[jt]sx?$/.test(relatif)) return 'tests'
  if (/^(?:tests|e2e)\//.test(relatif) || /^src\/integration\//.test(relatif)) return 'tests'
  if (/^src\/test-utils\//.test(relatif) || /^src\/__tests__\//.test(relatif)) return 'tests'
  if (/^(?:docs|artifacts)\//.test(relatif)) return 'documentation'
  if (/^scripts\//.test(relatif) || /^\.github\//.test(relatif) || relatif === 'config') return 'outillage'
  return 'application'
}

/** Emplacements qui prouvent une consommation par le logiciel ou son outillage. */
const CATEGORIES_PROBANTES = new Set(['application', 'outillage'])

/**
 * Lectures littérales d'environnement, tous langages du dépôt confondus.
 * Une lecture dynamique (`process.env[variable]`) ne peut pas être prouvée par
 * une expression régulière : c'est une limite assumée, redite dans le rapport.
 */
const MOTIFS_LECTURE = [
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /import\.meta\.env\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g,
  /\benv\(\s*"([A-Z][A-Z0-9_]{2,})"\s*\)/g,
  /\$env:([A-Z][A-Z0-9_]{2,})/g,
]

/** Comportement attendu en l'absence de la variable, dérivé du contrat. */
function comportementSiAbsente(variable) {
  if (variable.requiredProduction) {
    return 'Démarrage refusé en production (src/instrumentation.ts via src/lib/env.ts) ; avertissement en développement.'
  }
  if (variable.classification === 'dangerous' || variable.classification === 'dangerous-external') {
    return 'Fonctionnalité associée indisponible ; aucune valeur de repli silencieuse pour une clé de chiffrement.'
  }
  if (variable.classification === 'configuration' || variable.classification === 'public-build-configuration') {
    return 'Valeur par défaut du code appliquée ; comportement inchangé.'
  }
  if (variable.classification === 'external' || variable.classification === 'external-config' || variable.classification === 'external-path') {
    return 'Service externe non configuré ; la fonctionnalité correspondante reste inactive.'
  }
  if (variable.classification === 'runtime-system' || variable.classification === 'runtime-generated') {
    return 'Fournie par la plateforme ou générée à l exécution ; rien à provisionner.'
  }
  return 'Aucun effet prouvé : consommateur absent ou optionnel.'
}

/** Parcours récursif du dépôt, en évitant les dossiers générés et les secrets. */
function fichiersCode(racine) {
  const resultats = []
  const parcourir = (dossier, relatif) => {
    let entrees
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true })
    } catch {
      return
    }
    for (const entree of entrees) {
      const cheminRelatif = relatif ? relatif + '/' + entree.name : entree.name
      if (DOSSIERS_IGNORES.has(entree.name) || DOSSIERS_IGNORES.has(cheminRelatif)) continue
      // Le dossier du configurateur se décrit lui-même : l'inclure ferait
      // apparaître ses propres expressions régulières comme des consommateurs.
      if (entree.name === 'configuation automatique') continue
      const complet = path.join(dossier, entree.name)
      if (entree.isDirectory()) {
        parcourir(complet, cheminRelatif)
        continue
      }
      if (!entree.isFile() || !EXTENSIONS_CODE.test(entree.name)) continue
      // Un fichier d'environnement n'est pas du code : son contenu n'est jamais lu ici.
      if (/^\.env/.test(entree.name)) continue
      resultats.push({ relatif: cheminRelatif, complet, categorie: categorieFichier(cheminRelatif) })
    }
  }
  parcourir(racine, '')
  return resultats
}

/**
 * Inventorie les lectures d'environnement réellement présentes dans le code.
 * @returns {{ references: Map<string, Map<string,string>>, fichiersAnalyses: number,
 *             parCategorie: Record<string, number> }}
 */
function scannerCode(racine) {
  const references = new Map()
  const parCategorie = {}
  let fichiersAnalyses = 0
  for (const fichier of fichiersCode(racine)) {
    let texte
    try {
      const donnees = fs.readFileSync(fichier.complet)
      if (donnees.includes(0)) continue
      texte = donnees.toString('utf8')
    } catch {
      continue
    }
    fichiersAnalyses++
    parCategorie[fichier.categorie] = (parCategorie[fichier.categorie] || 0) + 1
    for (const motif of MOTIFS_LECTURE) {
      motif.lastIndex = 0
      let correspondance = motif.exec(texte)
      while (correspondance) {
        const nom = correspondance[1]
        if (!references.has(nom)) references.set(nom, new Map())
        references.get(nom).set(fichier.relatif, fichier.categorie)
        correspondance = motif.exec(texte)
      }
    }
  }
  return { references, fichiersAnalyses, parCategorie }
}

/** Emplacements probants (logiciel ou outillage) d'une variable, triés. */
function emplacementsProbants(references, nom) {
  const trouves = references.get(nom)
  if (!trouves) return []
  return [...trouves.entries()]
    .filter((entree) => CATEGORIES_PROBANTES.has(entree[1]))
    .map((entree) => entree[0])
    .sort()
}

/**
 * Charge le manifeste unifié.
 *
 * @param {string} racine racine du dépôt
 * @param {{ scanner?: boolean }} options
 */
function charger(racine, options = {}) {
  const avecScan = options.scanner !== false
  const politique = require(path.join(racine, 'scripts/config-policy.cjs')).loadPolicy(racine)
  const noyau = require(path.join(racine, 'scripts/config-core.cjs'))
  const destinations = require('./destinations.js')
  const secrets = require('../security/secrets.js')

  const scan = avecScan ? scannerCode(racine) : { references: new Map(), fichiersAnalyses: 0 }

  const entrees = politique.entries.map((variable) => {
    const regle = destinations.destination(variable)
    const observes = emplacementsProbants(scan.references, variable.name)
    return {
      ...variable,
      destination: regle,
      emplacementsObserves: observes,
      // Les 10 propriétés exigées par le cahier des charges, pour chaque variable.
      fiche: {
        nom: variable.name,
        emplacements: variable.consumers || [],
        emplacementsObserves: observes,
        nombreEmplacementsObserves: observes.length,
        fonction: variable.notes || regle.raison,
        environnement: variable.scope,
        obligatoire: !!variable.requiredProduction,
        format: variable.format,
        generation: secrets.generable(variable.name)
          ? secrets.specification(variable.name).encodage + ' ' + secrets.specification(variable.name).octets + ' octets (CSPRNG)'
          : 'aucune (valeur fournie par un service ou par l opérateur)',
        fournisseur: variable.classification,
        impactModification: variable.rotationRisk || 'inconnu',
        siAbsente: comportementSiAbsente(variable),
        destination: regle.categorieDestination,
        ciblesVercel: regle.cibles,
      },
    }
  })

  const parNom = new Map(entrees.map((entree) => [entree.name, entree]))
  const plateforme = new Set(politique.manifest.platformProvided)
  const aliasInterdits = politique.manifest.forbiddenAliases || {}

  return {
    racine,
    entrees,
    parNom,
    plateforme,
    aliasInterdits,
    defauts: noyau.DEFAULTS,
    generables: noyau.GENERATED,
    manifeste: politique.manifest,
    politique,
    scan,
    noyau,
  }
}

/**
 * Croise contrat et code, et rend les divergences.
 *
 * Aucune n'est corrigée automatiquement : le manifeste est un fichier versionné
 * du dépôt, et le modifier depuis un outil de configuration ferait disparaître
 * la trace d'une décision d'architecture.
 */
function verifierContrat(unifie) {
  const { entrees, parNom, plateforme, aliasInterdits, scan, generables } = unifie
  const divergences = {
    consommeesHorsContrat: [],
    // Déclarée avec un consommateur, mais aucune lecture LITTÉRALE trouvée. La
    // cause habituelle est une lecture dynamique (`process.env[nom]`, comme
    // dans `src/lib/security/rate-limit.ts`) : ce n'est donc pas une anomalie,
    // c'est la limite d'un inventaire statique. Rapporté comme information.
    sansLectureLitterale: [],
    // Celle-ci, en revanche, est une vraie anomalie : le contrat désigne un
    // fichier consommateur qui n'existe plus dans le dépôt.
    consommateursIntrouvables: [],
    marqueesAbsentesMaisUtilisees: [],
    generationDivergente: [],
    aliasPresentsDansLeCode: [],
  }

  for (const nom of scan.references.keys()) {
    if (parNom.has(nom) || plateforme.has(nom)) continue
    const probants = emplacementsProbants(scan.references, nom)
    if (!probants.length) continue
    if (aliasInterdits[nom]) {
      divergences.aliasPresentsDansLeCode.push({ nom, fichiers: probants, canonique: aliasInterdits[nom].canonical })
      continue
    }
    divergences.consommeesHorsContrat.push({ nom, fichiers: probants })
  }

  for (const entree of entrees) {
    const observe = emplacementsProbants(scan.references, entree.name)
    const declare = (entree.consumers || []).length > 0
    if (entree.status === 'absent-consumer' && observe.length) {
      divergences.marqueesAbsentesMaisUtilisees.push({ nom: entree.name, fichiers: observe })
    }
    if (!observe.length && declare && entree.status !== 'absent-consumer') {
      divergences.sansLectureLitterale.push({ nom: entree.name, consommateursDeclares: entree.consumers })
    }
    // Un consommateur déclaré doit exister — sauf pour une entrée déjà marquée
    // `absent-consumer`, où l'absence du fichier EST l'information déclarée (les
    // 39 variables GF_BRAND_* du dépôt sont dans ce cas). Les entrées en « (…) »
    // décrivent un emplacement non fichier (`vercel.json (crons)`).
    if (entree.status !== 'absent-consumer') {
      const introuvables = (entree.consumers || [])
        .filter((consommateur) => !/[()]/.test(consommateur))
        .filter((consommateur) => !fs.existsSync(path.join(unifie.racine, consommateur)))
      if (introuvables.length) divergences.consommateursIntrouvables.push({ nom: entree.name, fichiers: introuvables })
    }
    // Le manifeste déclare `autoGenerate` ; `config-core.GENERATED` décide de
    // l'encodage réellement produit. Une divergence signifie qu'un outil
    // générerait une valeur que l'autre refuse.
    const manifesteGenere = !!entree.autoGenerate
    const noyauGenere = Object.prototype.hasOwnProperty.call(generables, entree.name)
    if (manifesteGenere !== noyauGenere) {
      divergences.generationDivergente.push({
        nom: entree.name,
        manifeste: manifesteGenere,
        noyau: noyauGenere,
        encodageNoyau: generables[entree.name] || null,
      })
    }
  }

  return divergences
}

module.exports = {
  charger, scannerCode, verifierContrat, fichiersCode, comportementSiAbsente,
  categorieFichier, emplacementsProbants, DOSSIERS_IGNORES, MOTIFS_LECTURE, CATEGORIES_PROBANTES,
}
