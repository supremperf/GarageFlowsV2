'use strict'
/**
 * TROIS SÉLECTIONS, PUIS PLUS RIEN À DÉCIDER.
 *
 * L'opérateur choisit son PROJET, sa BRANCHE et son ENVIRONNEMENT ; tout le
 * reste est découvert et vérifié par le configurateur. Ce module ne fait que
 * ces trois choses :
 *
 *   1. DÉCOUVRIR — les projets Vercel accessibles avec la session en place, les
 *      branches Git locales et distantes, et les trois environnements ;
 *   2. DEMANDER — un menu par choix, avec le dernier choix mémorisé en tête ;
 *   3. BORNER — traduire l'environnement choisi en liste de cibles où l'on a le
 *      droit d'ÉCRIRE.
 *
 * ÉCRITURE ET LECTURE NE SONT PAS BORNÉES PAREIL. Choisir « production » limite
 * les ÉCRITURES à la production, mais n'interdit pas de LIRE les autres
 * environnements : prouver que Preview ne pointe pas sur la base de production
 * exige précisément de regarder les deux. Le configurateur continue donc
 * d'analyser toutes les cibles existantes, et ne mute que la cible choisie.
 *
 * AUCUN SECRET DANS LES PRÉFÉRENCES. Le fichier mémorisé ne contient que trois
 * identifiants non sensibles (nom de projet, nom de branche, nom
 * d'environnement) et une date. Jamais une valeur, jamais un jeton, jamais une
 * URL de connexion.
 *
 * JAMAIS DE BLOCAGE EN AUTOMATISATION. Sans terminal interactif (CI, tâche
 * planifiée, sortie redirigée), aucune question n'est posée : les options
 * `--projet`, `--branche` et `--environnement` fournissent les réponses, et à
 * défaut le configurateur conserve son comportement historique — analyser et
 * configurer toutes les cibles existantes — en le DISANT dans le rapport.
 */

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { execFileSync } = require('node:child_process')

const DOSSIER_PREFERENCES = 'GarageFlow-configuration'
const FICHIER_PREFERENCES = 'configurateur-preferences.json'

/** Les trois environnements, dans l'ordre du moins risqué au plus risqué. */
const ENVIRONNEMENTS = Object.freeze([
  {
    cle: 'development',
    libelle: 'DEVELOPMENT',
    detail: 'poste local — profil Electron/SQLite (.env) et miroir Vercel Development',
  },
  {
    cle: 'preview',
    libelle: 'PREVIEW',
    detail: 'déploiements de branche — ressources Preview uniquement',
  },
  {
    cle: 'production',
    libelle: 'PRODUCTION',
    detail: 'service réel des clients — protections supplémentaires, aucune opération destructive',
  },
])

/**
 * Cibles où l'ÉCRITURE est autorisée pour chaque environnement choisi.
 *
 * `desktop` est le fichier `.env` du poste (profil Electron/SQLite) : il
 * appartient à DEVELOPMENT. Choisir Preview ou Production ne doit pas réécrire
 * le profil local de l'opérateur — c'est la confusion qui fait pointer un poste
 * de développement vers la base des clients.
 */
const CIBLES_ECRITURE = Object.freeze({
  development: Object.freeze(['desktop', 'development']),
  preview: Object.freeze(['preview']),
  production: Object.freeze(['production']),
})

function cheminPreferences(racine) {
  return path.join(racine, DOSSIER_PREFERENCES, FICHIER_PREFERENCES)
}

/** Dernier choix mémorisé, ou `null`. Un fichier illisible n'est jamais fatal. */
function lirePreferences(racine) {
  try {
    const brut = JSON.parse(fs.readFileSync(cheminPreferences(racine), 'utf8'))
    if (!brut || typeof brut !== 'object') return null
    const propre = {
      projet: typeof brut.projet === 'string' ? brut.projet : null,
      branche: typeof brut.branche === 'string' ? brut.branche : null,
      environnement: ENVIRONNEMENTS.some((element) => element.cle === brut.environnement)
        ? brut.environnement
        : null,
    }
    return propre.projet || propre.branche || propre.environnement ? propre : null
  } catch {
    return null
  }
}

/**
 * Mémorise les trois choix. N'écrit QUE des identifiants non sensibles : toute
 * autre clé présente dans l'objet reçu est ignorée, pour qu'un appelant
 * distrait ne puisse pas y déposer un secret.
 */
function ecrirePreferences(racine, choix) {
  const contenu = {
    schema: 1,
    projet: choix && typeof choix.projet === 'string' ? choix.projet : null,
    branche: choix && typeof choix.branche === 'string' ? choix.branche : null,
    environnement: choix && typeof choix.environnement === 'string' ? choix.environnement : null,
    memoriseLe: new Date().toISOString(),
    note: 'Préférences d interface du configurateur. AUCUN secret : seulement trois noms.',
  }
  try {
    fs.mkdirSync(path.dirname(cheminPreferences(racine)), { recursive: true })
    fs.writeFileSync(cheminPreferences(racine), JSON.stringify(contenu, null, 2) + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/** Exécution Git bornée, sans shell. Retourne '' en cas d'échec. */
function git(racine, args) {
  try {
    return execFileSync('git', args, {
      cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000,
    })
  } catch {
    return ''
  }
}

/**
 * Branches Git disponibles : locales et distantes, dédupliquées.
 *
 * La branche courante est marquée. Les branches distantes sont listées sous
 * leur nom court, car c'est celui que l'opérateur choisit ; `origin/HEAD` est
 * écarté (ce n'est pas une branche, c'est un pointeur).
 */
function decouvrirBranches(racine) {
  const resultat = { disponible: false, courante: null, racineDepot: null, branches: [] }
  const racineDepot = git(racine, ['rev-parse', '--show-toplevel']).trim()
  if (!racineDepot) return resultat
  resultat.disponible = true
  resultat.racineDepot = racineDepot
  resultat.courante = git(racine, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() || null

  const connues = new Map()
  const ajouter = (nom, origine) => {
    if (!nom || nom === 'HEAD') return
    const existante = connues.get(nom)
    if (existante) {
      if (!existante.origines.includes(origine)) existante.origines.push(origine)
      return
    }
    connues.set(nom, { nom, origines: [origine], courante: nom === resultat.courante })
  }

  for (const ligne of git(racine, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n')) {
    ajouter(ligne.trim(), 'locale')
  }
  for (const ligne of git(racine, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']).split('\n')) {
    const brut = ligne.trim()
    if (!brut || /\/HEAD$/.test(brut)) continue
    ajouter(brut.replace(/^[^/]+\//, ''), 'distante')
  }

  // La branche courante d'abord, puis l'ordre alphabétique : un opérateur
  // cherche presque toujours celle sur laquelle il travaille.
  resultat.branches = [...connues.values()].sort((a, b) => {
    if (a.courante !== b.courante) return a.courante ? -1 : 1
    return a.nom.localeCompare(b.nom)
  })
  return resultat
}

/**
 * Projets accessibles avec la session Vercel en place.
 *
 * Le projet lié par `vercel link` est marqué et placé en tête : c'est celui du
 * dossier courant, donc le choix attendu dans la très grande majorité des cas.
 * Aucune création, aucune liaison : la découverte ne mute rien.
 */
async function decouvrirProjets(racine, clientVercel, options = {}) {
  const resultat = { disponible: false, raison: null, lie: null, projets: [] }
  let lie = null
  try {
    lie = clientVercel.projetLie()
  } catch {
    lie = null
  }
  resultat.lie = lie ? { id: lie.projectId, nom: lie.projectName, equipe: lie.orgId } : null

  if (options.horsLigne) {
    resultat.raison = 'Mode hors ligne : aucun appel à Vercel. Seul le projet lié localement est connu.'
    if (resultat.lie) resultat.projets = [{ ...resultat.lie, fournisseur: 'vercel', lie: true, source: 'local' }]
    return resultat
  }

  try {
    const equipe = lie && lie.orgId ? lie.orgId : null
    const route = '/v9/projects?limit=100' + (equipe ? '&teamId=' + encodeURIComponent(equipe) : '')
    const reponse = await clientVercel.appel(route)
    const brut = (reponse && (reponse.projects || reponse.body && reponse.body.projects)) || []
    resultat.disponible = true
    resultat.projets = brut.map((projet) => ({
      id: projet.id,
      nom: projet.name,
      equipe: projet.accountId || equipe || null,
      cadre: projet.framework || null,
      miseAJour: projet.updatedAt || null,
      lie: !!(lie && projet.id === lie.projectId),
      source: 'api',
    })).sort((a, b) => {
      if (a.lie !== b.lie) return a.lie ? -1 : 1
      return String(a.nom).localeCompare(String(b.nom))
    })
  } catch (erreur) {
    // Une session absente ou une permission manquante n'est pas une panne du
    // configurateur : on le dit, et le projet lié localement reste utilisable.
    resultat.raison = 'Inventaire des projets Vercel indisponible (session, permission ou réseau).'
    if (resultat.lie) resultat.projets = [{ ...resultat.lie, fournisseur: 'vercel', lie: true, source: 'local' }]
  }
  return resultat
}

/** Y a-t-il un terminal pour poser une question ? */
function interactif() {
  return Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY)
}

/**
 * Pose une question à choix numéroté. Entrée vide = première proposition.
 * @returns {Promise<number>} index choisi
 */
function demanderChoix(titre, propositions, options = {}) {
  return new Promise((resoudre) => {
    const interface_ = readline.createInterface({ input: process.stdin, output: process.stdout })
    const afficher = () => {
      process.stdout.write('\n' + titre + '\n')
      propositions.forEach((proposition, index) => {
        const marque = proposition.defaut ? ' (défaut)' : ''
        process.stdout.write('  ' + String(index + 1).padStart(2, ' ') + '. '
          + proposition.libelle + marque
          + (proposition.detail ? '\n      ' + proposition.detail : '') + '\n')
      })
      process.stdout.write('\nNuméro' + (options.suffixe || '') + ' [1] : ')
    }
    const relancer = () => {
      afficher()
    }
    afficher()
    interface_.on('line', (saisie) => {
      const propre = String(saisie).trim()
      if (propre === '') {
        interface_.close()
        return resoudre(0)
      }
      const numero = Number.parseInt(propre, 10)
      if (Number.isInteger(numero) && numero >= 1 && numero <= propositions.length) {
        interface_.close()
        return resoudre(numero - 1)
      }
      process.stdout.write('Saisie non reconnue : indiquez un numéro entre 1 et '
        + propositions.length + '.\n')
      relancer()
    })
    interface_.on('close', () => resoudre(0))
  })
}

/**
 * Les trois sélections. Jamais de question quand une réponse est déjà fournie
 * par une option, ni quand il n'y a pas de terminal.
 *
 * @returns {Promise<{projet, branche, environnement, interactif, sources, ciblesEcriture, avertissements}>}
 */
async function choisir(racine, options, clientVercel) {
  const memoire = lirePreferences(racine)
  const choix = {
    projet: null,
    branche: null,
    environnement: null,
    interactif: interactif() && !options.sansSelection,
    sources: { projet: null, branche: null, environnement: null },
    avertissements: [],
    inventaire: { projets: null, branches: null },
  }

  // ── 1. PROJET ────────────────────────────────────────────────────────────
  const projets = clientVercel ? await decouvrirProjets(racine, clientVercel, options) : { projets: [], lie: null }
  choix.inventaire.projets = {
    disponible: projets.disponible,
    raison: projets.raison,
    nombre: projets.projets.length,
    noms: projets.projets.map((projet) => projet.nom).filter(Boolean),
    lie: projets.lie ? projets.lie.nom : null,
  }
  if (options.projet) {
    const trouve = projets.projets.find((projet) => projet.nom === options.projet || projet.id === options.projet)
    choix.projet = trouve || { nom: options.projet, id: null, source: 'option' }
    choix.sources.projet = 'option'
    if (!trouve && projets.disponible) {
      choix.avertissements.push('Projet « ' + options.projet
        + ' » absent de l inventaire Vercel : la sélection est conservée telle quelle, aucune ressource n est devinée.')
    }
  } else if (choix.interactif && projets.projets.length > 1) {
    const ordonnes = ordonnerSelonMemoire(projets.projets, memoire && memoire.projet, (projet) => projet.nom)
    const index = await demanderChoix('ÉTAPE 1 — PROJET  (découverte automatique)',
      ordonnes.map((projet, rang) => ({
        libelle: projet.nom + (projet.lie ? '  [lié à ce dossier]' : ''),
        detail: [projet.id ? 'id ' + projet.id : null, projet.cadre, projet.equipe ? 'équipe ' + projet.equipe : null]
          .filter(Boolean).join(' · '),
        defaut: rang === 0,
      })))
    choix.projet = ordonnes[index]
    choix.sources.projet = 'interactif'
  } else {
    choix.projet = projets.projets.find((projet) => projet.lie) || projets.projets[0] || null
    choix.sources.projet = choix.projet ? (projets.projets.length === 1 ? 'unique' : 'lie') : 'absent'
  }

  // ── 2. BRANCHE ───────────────────────────────────────────────────────────
  const branches = decouvrirBranches(racine)
  choix.inventaire.branches = {
    disponible: branches.disponible,
    racineDepot: branches.racineDepot,
    courante: branches.courante,
    nombre: branches.branches.length,
    noms: branches.branches.map((branche) => branche.nom),
  }
  if (options.branche) {
    const trouvee = branches.branches.find((branche) => branche.nom === options.branche)
    choix.branche = trouvee || { nom: options.branche, origines: ['option'], courante: false }
    choix.sources.branche = 'option'
    if (!trouvee && branches.disponible) {
      choix.avertissements.push('Branche « ' + options.branche
        + ' » inconnue du dépôt : aucune branche n est créée. Vérifiez le nom ou récupérez-la depuis le distant.')
    }
  } else if (choix.interactif && branches.branches.length > 1) {
    const ordonnees = ordonnerSelonMemoire(branches.branches, memoire && memoire.branche, (branche) => branche.nom)
    const index = await demanderChoix('ÉTAPE 2 — BRANCHE GIT  (locales et distantes)',
      ordonnees.map((branche, rang) => ({
        libelle: branche.nom + (branche.courante ? '  [courante]' : ''),
        detail: branche.origines.join(' + '),
        defaut: rang === 0,
      })))
    choix.branche = ordonnees[index]
    choix.sources.branche = 'interactif'
  } else {
    choix.branche = branches.branches.find((branche) => branche.courante) || branches.branches[0] || null
    choix.sources.branche = choix.branche ? 'courante' : 'absente'
  }

  // ── 3. ENVIRONNEMENT ─────────────────────────────────────────────────────
  if (options.environnement) {
    const trouve = ENVIRONNEMENTS.find((element) => element.cle === options.environnement)
    if (!trouve) {
      const erreur = new Error('Environnement inconnu : « ' + options.environnement
        + ' ». Attendu : development, preview ou production.')
      erreur.selection = true
      throw erreur
    }
    choix.environnement = trouve.cle
    choix.sources.environnement = 'option'
  } else if (choix.interactif) {
    const ordonnes = ordonnerSelonMemoire(ENVIRONNEMENTS, memoire && memoire.environnement, (element) => element.cle)
    const index = await demanderChoix('ÉTAPE 3 — ENVIRONNEMENT  (un seul à la fois)',
      ordonnes.map((element, rang) => ({
        libelle: element.libelle, detail: element.detail, defaut: rang === 0,
      })))
    choix.environnement = ordonnes[index].cle
    choix.sources.environnement = 'interactif'
  } else {
    // Pas de terminal et pas d'option : on NE restreint pas, et on le dit.
    // Deviner « production » serait le pire défaut possible ; deviner
    // « development » donnerait l'illusion d'une configuration appliquée.
    choix.environnement = null
    choix.sources.environnement = 'non-selectionne'
    choix.avertissements.push('Aucun environnement sélectionné (pas de terminal interactif et pas d option '
      + '--environnement) : toutes les cibles existantes sont analysées et configurées, comme avant. '
      + 'Utilisez --environnement=development|preview|production pour borner l exécution.')
  }

  choix.ciblesEcriture = choix.environnement ? [...CIBLES_ECRITURE[choix.environnement]] : null

  if (choix.sources.projet === 'interactif' || choix.sources.branche === 'interactif'
      || choix.sources.environnement === 'interactif') {
    ecrirePreferences(racine, {
      projet: choix.projet ? choix.projet.nom : null,
      branche: choix.branche ? choix.branche.nom : null,
      environnement: choix.environnement,
    })
  }
  return choix
}

/** Place en tête l'élément correspondant au dernier choix mémorisé. */
function ordonnerSelonMemoire(liste, memorise, cle) {
  if (!memorise) return [...liste]
  const index = liste.findIndex((element) => cle(element) === memorise)
  if (index <= 0) return [...liste]
  const copie = [...liste]
  const [retenu] = copie.splice(index, 1)
  return [retenu, ...copie]
}

module.exports = {
  ENVIRONNEMENTS,
  CIBLES_ECRITURE,
  cheminPreferences,
  lirePreferences,
  ecrirePreferences,
  decouvrirBranches,
  decouvrirProjets,
  demanderChoix,
  interactif,
  choisir,
  ordonnerSelonMemoire,
}
