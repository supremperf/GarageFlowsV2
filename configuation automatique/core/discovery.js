'use strict'
/**
 * DÉCOUVERTE DES VALEURS EXISTANTES — « chercher avant de générer ».
 *
 * Avant de produire quoi que ce soit, le configurateur fait l'inventaire de ce
 * qui existe déjà sur ce poste et dans le projet. Chaque valeur trouvée est
 * accompagnée de son ORIGINE et de son NIVEAU DE PREUVE, car les deux décident
 * de ce qu'on peut en faire :
 *
 *   `prouvee`   — une connexion réelle ou une dérivation vérifiable l'a
 *                 confirmée. Utilisable sans réserve.
 *   `declaree`  — elle vient d'un fichier de ce poste, écrit par un outil ou
 *                 par l'opérateur. Crédible, mais non vérifiée.
 *   `brouillon` — elle vient d'un état de configuration INTERROMPU
 *                 (`GarageFlow-configuration/manager-state.json`). Une telle
 *                 valeur n'a jamais été confirmée côté fournisseur : on ne
 *                 l'écrit nulle part sans l'avoir prouvée d'abord.
 *
 * Aucune valeur découverte n'est journalisée ni rapportée : seuls le nom,
 * l'origine, le niveau de preuve et une empreinte tronquée circulent.
 */

const fs = require('node:fs')
const path = require('node:path')

const fichierEnv = require('../utils/env-file.js')
const redact = require('../security/redact.js')
const destinations = require('../config/destinations.js')

/** Fichiers d'environnement lus, du plus général au plus spécifique. */
const SOURCES_FICHIERS = [
  { fichier: '.env', cible: 'desktop', libelle: 'profil desktop' },
  { fichier: '.env.local', cible: 'development', libelle: 'surcharge locale Next.js' },
  { fichier: '.env.development.local', cible: 'development', libelle: 'development local' },
  { fichier: '.env.preview.local', cible: 'preview', libelle: 'miroir preview' },
  { fichier: '.env.production.local', cible: 'production', libelle: 'miroir production' },
  { fichier: '.env.server.local', cible: 'production', libelle: 'profil serveur (production)' },
]

/**
 * Jetons dont la durée de vie est courte et qui ne doivent JAMAIS être traités
 * comme un secret permanent à propager. `VERCEL_OIDC_TOKEN` est régénéré par
 * `vercel env pull` et expire en quelques heures : le synchroniser créerait une
 * variable morte, et le journaliser exposerait un jeton valide.
 */
const JETONS_TEMPORAIRES = new Set(['VERCEL_OIDC_TOKEN'])

function lireJson(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return null
  }
}

/** Une valeur utilisable : chaîne non vide après nettoyage. */
function utilisable(valeur) {
  return typeof valeur === 'string' && valeur.trim() !== ''
}

/**
 * Valeur de remplacement reconnaissable : un fichier d'exemple ne fournit pas
 * un identifiant. L'accepter ferait croire la configuration terminée.
 */
const MOTIFS_PLACEHOLDER = /^(?:x{3,}|<[^>]*>|\.\.\.|a?changer|change.?me|placeholder|example|votre[-_]|your[-_]|remplacer|to[-_]?be[-_]?set|todo)/i

/**
 * Marqueur de REDACTION, pas valeur de remplacement.
 *
 * `vercel env pull` ne restitue PAS les variables marquées Sensitive : il écrit
 * le littéral `[SENSITIVE]` à leur place. Confondu avec un identifiant réel, ce
 * marqueur partait dans les sondes : la connexion PostgreSQL Preview était
 * tentée avec « [SENSITIVE] » comme URL, et le rapport annonçait
 * « connexion refusée » — un échec d'infrastructure imaginaire, là où la seule
 * information vraie est « valeur non relisible depuis ce poste ».
 *
 * Même forme pour les marqueurs voisins (`[REDACTED]`, `[HIDDEN]`, `[ENCRYPTED]`) :
 * aucun secret réel ne commence par un crochet suivi d'un mot en capitales.
 */
const MOTIFS_REDACTION = /^\[(?:SENSITIVE|REDACTED|HIDDEN|ENCRYPTED|SECRET|MASKED)\]$/i

function estRedaction(valeur) {
  return MOTIFS_REDACTION.test(String(valeur).trim())
}

function estPlaceholder(valeur) {
  const propre = String(valeur).trim()
  if (!propre) return true
  if (estRedaction(propre)) return true
  if (MOTIFS_PLACEHOLDER.test(propre)) return true
  // Un secret fait de caractères répétés ou d'une suite évidente n'est pas une
  // vraie valeur, même s'il a la bonne longueur.
  if (/^(.)\1{7,}$/.test(propre)) return true
  return false
}

/**
 * Collecte toutes les valeurs connues localement.
 *
 * @param {string} racine racine du dépôt
 * @param {{ environnement?: object, secretsCompromis?: object[] }} options
 * @returns {{ parNom: Map<string, object[]>, fichiers: object[], brouillons: object,
 *             recus: object, rejetees: object[], jetonsTemporaires: string[] }}
 */
function collecter(racine, options = {}) {
  const environnement = options.environnement || process.env
  const credentials = require(path.join(racine, 'scripts/lib/config-credentials.cjs'))
  const compromis = options.secretsCompromis
    || (lireJson(path.join(racine, 'scripts/compromised-secrets.json')) || { entries: [] }).entries

  const parNom = new Map()
  const rejetees = []
  const jetonsTemporaires = []

  const ajouter = (nom, valeur, descripteur) => {
    if (!utilisable(valeur)) return
    if (JETONS_TEMPORAIRES.has(nom)) {
      if (!jetonsTemporaires.includes(nom)) jetonsTemporaires.push(nom)
      return
    }
    if (estPlaceholder(valeur)) {
      rejetees.push({ nom, origine: descripteur.origine, motif: 'valeur de remplacement (placeholder), jamais traitée comme un identifiant' })
      return
    }
    if (credentials.compromised(valeur, compromis)) {
      rejetees.push({ nom, origine: descripteur.origine, motif: 'identifiant connu exposé : renouvellement auprès du fournisseur obligatoire' })
      return
    }
    // Masquage selectif : « file:./dev.db » ou « sandbox » ne sont pas des
    // secrets, et les surveiller ferait masquer ces mots dans tout le rapport.
    if (redact.estSensible(nom, valeur)) redact.enregistrer(valeur)
    if (!parNom.has(nom)) parNom.set(nom, [])
    parNom.get(nom).push({
      nom,
      valeur,
      empreinte: redact.empreinteCourte(valeur),
      ...descripteur,
    })
  }

  // 1. Fichiers d'environnement du poste.
  const fichiers = []
  for (const source of SOURCES_FICHIERS) {
    const complet = path.join(racine, source.fichier)
    let texte = null
    try {
      texte = fs.readFileSync(complet, 'utf8')
    } catch (erreur) {
      if (erreur.code !== 'ENOENT') {
        fichiers.push({ ...source, present: true, lisible: false, variables: 0, doublons: [], malformees: [] })
        continue
      }
    }
    if (texte === null) {
      fichiers.push({ ...source, present: false, lisible: false, variables: 0, doublons: [], malformees: [] })
      continue
    }
    const analyse = fichierEnv.analyser(texte)
    const valeurs = fichierEnv.valeurs(texte)
    const renseignees = Object.keys(valeurs).filter((nom) => utilisable(valeurs[nom]))
    fichiers.push({
      ...source,
      present: true,
      lisible: true,
      variables: Object.keys(valeurs).length,
      renseignees: renseignees.length,
      doublons: analyse.doublons,
      malformees: [...new Set(analyse.malformees)],
    })
    for (const nom of renseignees) {
      ajouter(nom, valeurs[nom], {
        origine: 'fichier:' + source.fichier,
        cible: source.cible,
        confiance: 'declaree',
        preuve: 'présente dans ' + source.fichier,
      })
    }
  }

  // 2. Environnement du processus (variables Windows, session PowerShell, CI).
  //    On n'importe que des noms connus du contrat : récupérer tout
  //    `process.env` ferait entrer des variables système dans la configuration.
  const nomsContrat = options.nomsContrat || null
  for (const [nom, valeur] of Object.entries(environnement)) {
    if (nomsContrat && !nomsContrat.has(nom)) continue
    ajouter(nom, valeur, {
      origine: 'environnement-poste',
      cible: null,
      confiance: 'declaree',
      preuve: 'définie dans l environnement du processus',
    })
  }

  // 3. Brouillons laissés par une configuration interrompue. Source utile — mais
  //    jamais confirmée : `confiance: brouillon`.
  const etat = lireJson(path.join(racine, 'GarageFlow-configuration/manager-state.json'))
  const brouillons = {}
  if (etat && etat.drafts && typeof etat.drafts === 'object') {
    for (const [cible, valeurs] of Object.entries(etat.drafts)) {
      if (!valeurs || typeof valeurs !== 'object') continue
      brouillons[cible] = Object.keys(valeurs).filter((nom) => utilisable(valeurs[nom]))
      for (const nom of brouillons[cible]) {
        ajouter(nom, valeurs[nom], {
          origine: 'brouillon:' + cible,
          cible,
          confiance: 'brouillon',
          preuve: 'brouillon d une configuration interrompue, non confirmé côté fournisseur',
        })
      }
    }
  }

  // 4. Reçus d'empreintes : ils ne portent aucune valeur, mais permettent de
  //    reconnaître une valeur locale déjà synchronisée — donc de distinguer
  //    « identique à la production » de « dérive à signaler ».
  const recus = lireJson(path.join(racine, 'GarageFlow-configuration/secrets-receipt.json')) || null

  return { parNom, fichiers, brouillons, recus, rejetees, jetonsTemporaires, projetEtat: etat ? etat.project || null : null }
}

/**
 * Choisit la meilleure valeur connue pour une variable et une cible donnée.
 *
 * L'ordre n'est pas arbitraire :
 *   1. la valeur déjà en place DANS la cible (c'est la vérité de cet
 *      environnement — la remplacer serait une rotation) ;
 *   2. le fichier local correspondant à la cible ;
 *   3. une valeur d'une AUTRE cible, uniquement si la variable est copiable ;
 *   4. l'environnement du poste ;
 *   5. un brouillon, seulement s'il a pu être prouvé.
 *
 * @returns {object|null} candidat retenu, ou null si rien n'est exploitable
 */
function choisir(candidats, nom, cible, options = {}) {
  if (!candidats || !candidats.length) return null
  const copiable = destinations.copiableEntreEnvironnements(nom)
  const brouillonsProuves = options.brouillonsProuves || new Set()

  const memeCible = (candidat) => candidat.cible === cible
  const horsCible = (candidat) => candidat.cible && candidat.cible !== cible
  const utilisableIci = (candidat) => {
    if (candidat.confiance === 'brouillon' && !brouillonsProuves.has(nom + '@' + candidat.cible)) return false
    if (horsCible(candidat) && !copiable) return false
    return true
  }

  const ordre = [
    (candidat) => candidat.origine === 'vercel:' + cible,
    (candidat) => candidat.origine.startsWith('fichier:') && memeCible(candidat),
    (candidat) => candidat.origine.startsWith('derive'),
    (candidat) => candidat.origine.startsWith('keys/'),
    (candidat) => candidat.origine.startsWith('fichier:') && !candidat.cible,
    (candidat) => candidat.origine === 'environnement-poste',
    (candidat) => candidat.origine.startsWith('vercel:'),
    (candidat) => candidat.origine.startsWith('fichier:'),
    (candidat) => candidat.origine.startsWith('brouillon:') && memeCible(candidat),
    (candidat) => candidat.origine.startsWith('brouillon:'),
  ]

  const eligibles = candidats.filter(utilisableIci)
  for (const critere of ordre) {
    const trouve = eligibles.find(critere)
    if (trouve) return trouve
  }
  return null
}

/** Valeurs distinctes connues pour une variable : révèle une incohérence. */
function divergences(candidats) {
  const empreintes = new Map()
  for (const candidat of candidats || []) {
    if (!empreintes.has(candidat.empreinte)) empreintes.set(candidat.empreinte, [])
    empreintes.get(candidat.empreinte).push(candidat.origine)
  }
  if (empreintes.size < 2) return null
  return [...empreintes.entries()].map((entree) => ({ empreinte: entree[0], origines: entree[1] }))
}

module.exports = {
  SOURCES_FICHIERS, JETONS_TEMPORAIRES, collecter, choisir, divergences,
  utilisable, estPlaceholder, MOTIFS_PLACEHOLDER,
  estRedaction, MOTIFS_REDACTION,
}
