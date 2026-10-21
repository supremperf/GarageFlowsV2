'use strict'
/**
 * JOURNAL ET RAPPORT.
 *
 * Le rapport est la seule trace durable de l'exécution. Deux exigences le
 * gouvernent :
 *
 *   · AUCUNE VALEUR. Pas de secret, pas d'URL avec identifiants, pas de sortie
 *     brute de fournisseur. Seulement des noms, des statuts, des empreintes
 *     tronquées et des explications. Chaque chaîne écrite passe par
 *     `security/redact.js`, et un test de la suite relit le rapport produit
 *     pour vérifier qu'aucune valeur surveillée n'y figure.
 *
 *   · AUCUN FAUX SUCCÈS. `SUCCESS` est réservé à une vérification réellement
 *     effectuée. Un contrôle de format qui n'a pas pu être doublé d'un test de
 *     connexion vaut `WARNING`, et une opération non tentée vaut `SKIPPED` —
 *     jamais `SUCCESS`.
 */

const fs = require('node:fs')
const path = require('node:path')

const redact = require('../security/redact.js')
const ui = require('../utils/ui.js')
const fsx = require('../utils/fsx.js')

const STATUTS = Object.keys(ui.STATUTS)

/**
 * Localise les chaînes d'un objet qui contiennent encore une valeur sensible.
 *
 * Rend des CHEMINS, jamais des valeurs : « vercel.environnements.preview » est
 * exploitable pour corriger le code fautif, alors qu'un refus sans indication
 * obligerait à relire tout le pipeline à la main.
 */
function localiser(valeur, chemin = '', trouves = []) {
  if (typeof valeur === 'string') {
    if (redact.contientSecret(valeur)) trouves.push(chemin || '(racine)')
    return trouves
  }
  if (Array.isArray(valeur)) {
    valeur.forEach((element, index) => localiser(element, chemin + '[' + index + ']', trouves))
    return trouves
  }
  if (valeur && typeof valeur === 'object') {
    for (const [cle, sousValeur] of Object.entries(valeur)) {
      // La clé elle-même peut porter une valeur (dictionnaire indexé par valeur).
      if (redact.contientSecret(cle)) trouves.push((chemin ? chemin + '.' : '') + '<clé>')
      localiser(sousValeur, (chemin ? chemin + '.' : '') + cle, trouves)
    }
  }
  return trouves
}

/** Nombre de rapports horodatés conservés ; les plus anciens sont supprimés. */
const RAPPORTS_CONSERVES = 20

/**
 * Borne l'historique des rapports.
 *
 * Un configurateur relancé régulièrement — ce qui est son usage normal, puisqu'il
 * est idempotent — remplirait sinon son dossier indéfiniment. Les rapports ne
 * contiennent aucune valeur secrète, mais un dossier de plusieurs centaines de
 * fichiers rend introuvable celui qu'on cherche. `dernier-rapport.json` n'est
 * jamais supprimé.
 *
 * @returns {string[]} noms des fichiers supprimés
 */
function purger(dossier, conserves = RAPPORTS_CONSERVES) {
  let fichiers = []
  try {
    fichiers = fs.readdirSync(dossier)
      .filter((nom) => /^configuration-report-.*\.json$/.test(nom))
      .sort()
  } catch {
    return []
  }
  if (fichiers.length <= conserves) return []
  const aSupprimer = fichiers.slice(0, fichiers.length - conserves)
  const supprimes = []
  for (const nom of aSupprimer) {
    try {
      fs.rmSync(path.join(dossier, nom), { force: true })
      supprimes.push(nom)
    } catch { /* un fichier verrouillé sera purgé à la prochaine exécution */ }
  }
  return supprimes
}

function journal(racine, { executionId, simulation = false, demarre = new Date() } = {}) {
  const etapes = []
  const donnees = {
    version: 1,
    executionId,
    simulation,
    demarre: demarre.toISOString(),
    termine: null,
    plateforme: {
      systeme: process.platform,
      versionNode: process.versions.node,
      architecture: process.arch,
    },
    etapes: [],
    variables: [],
    fichiers: { crees: [], modifies: [], inchanges: [], sauvegardes: [] },
    secrets: { generes: [], reutilises: [], recuperes: [], bloques: [] },
    fournisseurs: {},
    vercel: { environnements: {}, synchronisations: [], refusees: [] },
    connexions: [],
    erreurs: [],
    nonEffectue: [],
    autorisationsManquantes: [],
    actionsNonAutomatisables: [],
    resume: {},
  }

  let etapeCourante = null

  /** Ouvre une étape nommée ; toute ligne ajoutée ensuite s'y rattache. */
  function etape(numero, titre) {
    etapeCourante = {
      numero,
      titre,
      debut: new Date().toISOString(),
      fin: null,
      statut: null,
      lignes: [],
    }
    etapes.push(etapeCourante)
    donnees.etapes.push(etapeCourante)
    ui.titre(numero + '. ' + titre)
    return etapeCourante
  }

  /** Clôt l'étape courante avec son statut le plus grave. */
  function cloturer(statutForce) {
    if (!etapeCourante) return
    etapeCourante.fin = new Date().toISOString()
    if (statutForce) {
      etapeCourante.statut = statutForce
    } else {
      const presents = new Set(etapeCourante.lignes.map((ligne) => ligne.statut))
      etapeCourante.statut = ui.ORDRE_GRAVITE.find((statut) => presents.has(statut)) || 'SUCCESS'
    }
    etapeCourante = null
  }

  /**
   * Enregistre un constat.
   * @param {string} statut l'un de STATUTS
   * @param {string} sujet ce dont on parle (nom de variable, de ressource…)
   * @param {string} detail explication, nettoyée avant écriture
   */
  function ligne(statut, sujet, detail, complement) {
    if (!STATUTS.includes(statut)) throw new Error('Statut de rapport inconnu : ' + statut)
    const entree = {
      statut,
      sujet: redact.nettoyer(sujet),
      detail: detail ? redact.nettoyer(detail) : null,
      ...(complement || {}),
    }
    if (etapeCourante) etapeCourante.lignes.push(entree)
    else donnees.etapes.push({ numero: null, titre: '(hors étape)', lignes: [entree] })
    ui.ligne(statut, entree.sujet, entree.detail)
    return entree
  }

  /** Message d'information, sans statut. */
  function info(texte) {
    ui.info(redact.nettoyer(texte))
  }

  /** Enregistre la décision prise pour une variable (sans sa valeur). */
  function variable(prise) {
    const entree = {
      nom: prise.nom,
      cible: prise.cible,
      categorie: prise.categorie,
      action: prise.action,
      statut: prise.statut,
      requise: prise.requise,
      origine: prise.origine,
      confiance: prise.confiance,
      empreinte: prise.empreinte,
      raison: redact.nettoyer(prise.raison),
      avertissements: (prise.avertissements || []).map((texte) => redact.nettoyer(texte)),
      anomalies: (prise.anomalies || []).map((texte) => redact.nettoyer(texte)),
    }
    donnees.variables.push(entree)
    const reference = prise.nom + '@' + prise.cible
    if (prise.action === 'generer') donnees.secrets.generes.push(reference)
    // `conserver` compte comme réutilisation : c'est le cas d'une variable
    // présente chez Vercel et protégée en lecture. L'omettre donnerait un
    // décompte de « réutilisés » bien inférieur au nombre réel de REUSED.
    if (prise.action === 'reutiliser' || prise.action === 'conserver') donnees.secrets.reutilises.push(reference)
    if (prise.action === 'recuperer' || prise.action === 'deriver') donnees.secrets.recuperes.push(reference)
    if (prise.action === 'bloquer') donnees.secrets.bloques.push(reference)
    return entree
  }

  function erreur(contexte, messageOuErreur) {
    const texte = redact.nettoyer(messageOuErreur instanceof Error ? messageOuErreur.message : messageOuErreur)
    donnees.erreurs.push({ contexte, message: texte, horodatage: new Date().toISOString() })
    return texte
  }

  function nonEffectue(operation, raison) {
    donnees.nonEffectue.push({ operation, raison: redact.nettoyer(raison) })
  }

  function autorisationManquante(fournisseur, besoin, commande) {
    donnees.autorisationsManquantes.push({ fournisseur, besoin: redact.nettoyer(besoin), commande: commande || null })
  }

  function nonAutomatisable(sujet, raison) {
    donnees.actionsNonAutomatisables.push({ sujet, raison: redact.nettoyer(raison) })
  }

  /** Statistiques finales et écriture du fichier de rapport. */
  function finaliser(racineRapports) {
    donnees.termine = new Date().toISOString()
    const parStatut = {}
    for (const etapeEnregistree of donnees.etapes) {
      for (const entree of etapeEnregistree.lignes || []) {
        parStatut[entree.statut] = (parStatut[entree.statut] || 0) + 1
      }
    }
    donnees.resume = {
      parStatut,
      etapes: donnees.etapes.filter((element) => element.numero !== null).length,
      variablesExaminees: donnees.variables.length,
      secretsGeneres: donnees.secrets.generes.length,
      secretsReutilises: donnees.secrets.reutilises.length,
      valeursRecuperees: donnees.secrets.recuperes.length,
      bloquees: donnees.secrets.bloques.length,
      fichiersCrees: donnees.fichiers.crees.length,
      fichiersModifies: donnees.fichiers.modifies.length,
      sauvegardes: donnees.fichiers.sauvegardes.length,
      synchronisations: donnees.vercel.synchronisations.length,
      erreurs: donnees.erreurs.length,
      // Verdict global : la plus grave des gravités rencontrées.
      verdict: ui.ORDRE_GRAVITE.find((statut) => parStatut[statut]) || 'SKIPPED',
    }

    const dossier = racineRapports || path.join(__dirname, '..', 'reports')
    fs.mkdirSync(dossier, { recursive: true })
    const jour = donnees.demarre.slice(0, 10)
    const fichier = path.join(dossier, 'configuration-report-' + jour + '-' + executionId + '.json')
    const texte = JSON.stringify(donnees, null, 2) + '\n'
    // Dernier contrôle avant écriture : le rapport ne doit contenir aucune
    // valeur surveillée. Si c'est le cas, on refuse de l'écrire plutôt que de
    // produire un fichier qui fuit — et on dit OÙ, sinon le refus est
    // incorrigible.
    if (redact.contientSecret(texte)) {
      const emplacements = localiser(donnees).slice(0, 10)
      throw new Error('Rapport refusé : une valeur sensible a été détectée dans son contenu. Aucun fichier écrit. '
        + 'Emplacement(s) : ' + (emplacements.length ? emplacements.join(', ') : 'non localisé') + '.')
    }
    fsx.ecrireAtomique(fichier, texte, { mode: 0o600 })
    // Copie « dernier rapport », pratique pour un contrôle rapide.
    fsx.ecrireAtomique(path.join(dossier, 'dernier-rapport.json'), texte, { mode: 0o600 })
    donnees.fichierRapport = fichier
    donnees.rapportsPurges = purger(dossier)
    return { fichier, donnees }
  }

  return {
    donnees, etape, cloturer, ligne, info, variable, erreur,
    nonEffectue, autorisationManquante, nonAutomatisable, finaliser,
  }
}

/** Résumé terminal lisible, affiché en fin d'exécution. */
function afficherResume(donnees) {
  ui.titre('RÉSUMÉ')
  const resume = donnees.resume
  ui.info('Verdict global : ' + ui.colorer(resume.verdict, resume.verdict))
  ui.info('')
  for (const statut of ui.ORDRE_GRAVITE) {
    const nombre = resume.parStatut[statut]
    if (!nombre) continue
    ui.info('  ' + ui.colorer(statut, statut.padEnd(13)) + String(nombre).padStart(4) + '   ' + ui.STATUTS[statut].sens)
  }
  ui.info('')
  ui.info('Étapes exécutées        : ' + resume.etapes)
  ui.info('Variables examinées     : ' + resume.variablesExaminees)
  ui.info('Secrets générés         : ' + resume.secretsGeneres)
  ui.info('Secrets réutilisés      : ' + resume.secretsReutilises)
  ui.info('Valeurs récupérées      : ' + resume.valeursRecuperees)
  ui.info('Variables bloquées      : ' + resume.bloquees)
  ui.info('Fichiers créés/modifiés : ' + resume.fichiersCrees + ' / ' + resume.fichiersModifies)
  ui.info('Sauvegardes             : ' + resume.sauvegardes)
  ui.info('Synchronisations Vercel : ' + resume.synchronisations)
  ui.info('Erreurs                 : ' + resume.erreurs)

  if (donnees.autorisationsManquantes.length) {
    ui.titre('AUTORISATIONS MANQUANTES')
    for (const element of donnees.autorisationsManquantes) {
      ui.ligne('BLOCKED', element.fournisseur, element.besoin)
      if (element.commande) ui.info('        → ' + element.commande)
    }
  }
  if (donnees.actionsNonAutomatisables.length) {
    ui.titre('NON AUTOMATISABLE')
    for (const element of donnees.actionsNonAutomatisables) ui.ligne('WARNING', element.sujet, element.raison)
  }
  if (donnees.nonEffectue.length) {
    ui.titre('OPÉRATIONS NON EFFECTUÉES')
    for (const element of donnees.nonEffectue) ui.ligne('SKIPPED', element.operation, element.raison)
  }
  if (donnees.erreurs.length) {
    ui.titre('ERREURS')
    for (const element of donnees.erreurs) ui.ligne('FAILED', element.contexte, element.message)
  }
}

module.exports = { journal, afficherResume, localiser, purger, RAPPORTS_CONSERVES, STATUTS }
