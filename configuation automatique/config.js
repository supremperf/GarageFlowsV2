#!/usr/bin/env node
'use strict'
/**
 * GARAGEFLOWS — CENTRE DE CONFIGURATION AUTOMATIQUE
 *
 *   node "configuation automatique/config.js"
 *   npm run config:auto
 *
 * Point d'entrée unique. Il ne contient aucune logique de configuration : son
 * rôle est d'encadrer l'exécution — analyser les options, prendre le verrou,
 * lancer le pipeline, gérer une interruption, écrire le rapport et rendre un
 * code de sortie qui dit la vérité sur ce qui s'est passé.
 *
 * Trois comportements méritent d'être connus avant la première exécution :
 *
 *   · AUCUNE ROTATION. Une valeur existante est conservée. Le configurateur
 *     complète ce qui manque, il ne remplace pas ce qui est là. Les clés de
 *     chiffrement protègent des données déjà écrites : les régénérer rendrait
 *     ces données illisibles, et aucune relance du configurateur ne les
 *     récupérerait.
 *
 *   · AUCUNE CONNEXION INTERACTIVE. Si une session fournisseur manque, le
 *     configurateur le signale avec la commande exacte à lancer, au lieu
 *     d'ouvrir une invite qui bloquerait une exécution automatique.
 *
 *   · AUCUN FAUX SUCCÈS. `SUCCESS` signale un contrôle réellement exécuté. Ce
 *     qui n'a pas pu être vérifié est rapporté comme tel.
 */

const crypto = require('node:crypto')
const path = require('node:path')
const process = require('node:process')

const RACINE = path.resolve(__dirname, '..')

const ui = require('./utils/ui.js')
const redact = require('./security/redact.js')
const verrou = require('./core/lock.js')
const rapports = require('./core/report.js')
const backup = require('./core/backup.js')
const pipeline = require('./core/pipeline.js')
const selection = require('./core/selection.js')
const fournisseurVercel = require('./providers/vercel.js')

const DRAPEAUX = {
  '--simulation': 'simulation',
  '--dry-run': 'simulation',
  '--hors-ligne': 'horsLigne',
  '--offline': 'horsLigne',
  '--fichiers-cloud': 'fichiersCloud',
  '--generer-cles-chiffrement': 'genererClesChiffrement',
  '--autoriser-remplacement-vercel': 'autoriserRemplacementVercel',
  '--cle-licence-vercel': 'cle-licence-vercel',
  '--creer-autorite-licence': 'creerAutoriteLicence',
  '--verifier-anthropic': 'verifierAnthropic',
  '--sonde-vercel': 'sondeVercel',
  '--completer-facultatives': 'completerFacultatives',
  '--forcer-verrou': 'forcerVerrou',
  '--forcer-ecriture': 'forcerEcriture',
  '--rollback': 'rollback',
  '--json': 'json',
  '--sans-selection': 'sansSelection',
  '--aide': 'aide',
  '--help': 'aide',
  '-h': 'aide',
}

/**
 * Options À VALEUR (`--nom=valeur`) : les trois sélections de l'opérateur.
 * Fournies en ligne de commande, elles remplacent la question correspondante —
 * c'est ce qui rend le configurateur utilisable en CI sans jamais bloquer sur
 * une saisie attendue.
 */
const OPTIONS_VALEUR = {
  '--projet': 'projet',
  '--project': 'projet',
  '--branche': 'branche',
  '--branch': 'branche',
  '--environnement': 'environnement',
  '--environment': 'environnement',
  '--env': 'environnement',
}

function aide() {
  console.log(`GarageFlows — centre de configuration automatique

  node "configuation automatique/config.js"          Configuration complète (par défaut)
  npm run config:auto                                 Identique
  npm run config:auto:simulation                      Plan complet sans aucune écriture

LES TROIS SEULES SÉLECTIONS

  Au lancement, le configurateur découvre les projets Vercel accessibles et les
  branches du dépôt, puis demande trois choix — et rien d'autre :

      ÉTAPE 1   PROJET          (découverte automatique, projet lié en tête)
      ÉTAPE 2   BRANCHE GIT     (locales et distantes)
      ÉTAPE 3   ENVIRONNEMENT   development | preview | production

  Le dernier choix est mémorisé dans GarageFlow-configuration/ (trois noms, et
  AUCUN secret) et proposé en tête au lancement suivant.

  L'environnement choisi borne les ÉCRITURES à cet environnement. Les autres
  restent LUS en seule lecture : c'est ce qui permet de prouver que Preview ne
  pointe pas sur la base de production, sans jamais la modifier.

  --projet=<nom|id>       Répond à l'étape 1 sans la poser.
  --branche=<nom>         Répond à l'étape 2 sans la poser.
  --environnement=<env>   Répond à l'étape 3 sans la poser
                          (development | preview | production).
  --sans-selection        Ne pose aucune question et ne borne aucune cible :
                          comportement historique, utile pour comparer deux
                          rapports. Sans terminal interactif (CI), c'est le
                          comportement par défaut et le rapport le DIT.

OPTIONS

  --simulation            Calcule tout, n'écrit rien, ne mute rien chez Vercel.
  --hors-ligne            Aucun accès réseau. Les contrôles de connexion sont
                          rapportés comme non effectués, jamais comme réussis.
  --fichiers-cloud        Écrit aussi .env.development.local et .env.preview.local
                          (par défaut : seulement .env et .env.server.local, plus
                          les fichiers cloud déjà présents).
  --completer-facultatives
                          Inscrit les variables facultatives à leur valeur par
                          défaut documentée. Par défaut on ne les écrit pas : le
                          code applique déjà ces défauts, et les dupliquer crée
                          une configuration à maintenir en double.

AUTORISATIONS EXPLICITES (toutes refusées par défaut)

  --generer-cles-chiffrement      Crée les clés de chiffrement de données
                                  ABSENTES (SMTP, sauvegardes, TOTP, facturation).
                                  Ne remplace jamais une clé existante.
  --autoriser-remplacement-vercel Autorise la mise à jour d'une variable Vercel
                                  dont la valeur diffère. Les rotations classées
                                  « critical » ou « high » restent refusées.
  --cle-licence-vercel            Autorise l'écriture de GF_PRIVATE_KEY dans le
                                  fichier serveur. Déployer l'autorité
                                  d'émission de licences est une décision
                                  d'exploitation, pas une étape de configuration.
  --creer-autorite-licence        Crée une paire ECDSA P-256 UNIQUEMENT si aucune
                                  autorité n'existe nulle part.
  --verifier-anthropic            Teste la clé Anthropic via GET /v1/models
                                  (opération de listage, non facturée).
  --sonde-vercel                  Prouve la capacité d'écriture en créant puis en
                                  retirant une variable de sonde dédiée dans
                                  l'environnement Development.

MAINTENANCE

  --rollback              Restaure les fichiers de la dernière sauvegarde.
  --forcer-verrou         Reprend un verrou laissé par un processus disparu.
  --forcer-ecriture       Écrit malgré une anomalie de sûreté du dépôt (à n'employer
                          qu'après avoir lu le motif du refus).
  --json                  N'affiche que le chemin du rapport et le verdict.

Rapports : « configuation automatique/reports/ » (aucune valeur secrète).
Sauvegardes : « GarageFlow-configuration/sauvegardes/ » (dossier privé, ignoré par Git).
Documentation : « configuation automatique/README.md ».`)
}

function analyserOptions(arguments_) {
  const options = {
    simulation: false,
    horsLigne: false,
    fichiersCloud: false,
    genererClesChiffrement: false,
    autoriserRemplacementVercel: false,
    'cle-licence-vercel': false,
    creerAutoriteLicence: false,
    verifierAnthropic: false,
    sondeVercel: false,
    completerFacultatives: false,
    forcerVerrou: false,
    forcerEcriture: false,
    rollback: false,
    json: false,
    sansSelection: false,
    aide: false,
    projet: null,
    branche: null,
    environnement: null,
  }
  const inconnus = []
  for (const argument of arguments_) {
    const cle = DRAPEAUX[argument]
    if (cle) {
      options[cle] = true
      continue
    }
    // `--nom=valeur` : la valeur est conservée telle quelle (un nom de branche
    // peut contenir des barres obliques, un nom de projet des points).
    const separateur = argument.indexOf('=')
    if (separateur > 0) {
      const nomOption = OPTIONS_VALEUR[argument.slice(0, separateur)]
      const valeur = argument.slice(separateur + 1).trim()
      if (nomOption && valeur) {
        options[nomOption] = valeur
        continue
      }
      if (nomOption && !valeur) {
        inconnus.push(argument + ' (valeur vide)')
        continue
      }
    }
    inconnus.push(argument)
  }
  return { options, inconnus }
}

async function rollback(executionId) {
  ui.titre('RETOUR ARRIÈRE')
  const disponibles = backup.sessions(RACINE)
  if (!disponibles.length) {
    ui.ligne('SKIPPED', 'Retour arrière', 'Aucune sauvegarde trouvée dans GarageFlow-configuration/sauvegardes/.')
    return 0
  }
  const etiquette = disponibles[0]
  const fs = require('node:fs')
  let index
  try {
    index = JSON.parse(fs.readFileSync(path.join(backup.dossierSauvegardes(RACINE), etiquette, 'index.json'), 'utf8'))
  } catch {
    ui.ligne('FAILED', 'Retour arrière', 'Index de la sauvegarde « ' + etiquette + ' » illisible : restauration refusée.')
    return 1
  }
  ui.info('Sauvegarde : ' + etiquette + ' (' + index.fichiers.length + ' fichier(s), créée le ' + index.cree + ')')

  const session = backup.session(RACINE, etiquette)
  // Reconstruire les entrées depuis l'index : la session ne connaît pas encore
  // les fichiers d'une exécution antérieure.
  for (const fichier of index.fichiers) {
    session.entrees.push({
      relatif: fichier.fichier,
      present: fichier.presentAvant,
      empreinte: fichier.empreinte,
      octets: fichier.octets,
      copie: fichier.copie ? path.join(session.dossier, fichier.copie) : null,
    })
  }
  const resultat = session.restaurer()
  for (const fichier of resultat.restaures) ui.ligne('SUCCESS', fichier, 'Contenu d origine restauré et vérifié.')
  for (const refus of resultat.refuses) ui.ligne('BLOCKED', refus.fichier, refus.raison)
  if (!resultat.restaures.length && !resultat.refuses.length) {
    ui.ligne('REUSED', 'Retour arrière', 'Tous les fichiers sont déjà dans leur état d origine.')
  }
  return resultat.refuses.length ? 1 : 0
}

async function principal() {
  const { options, inconnus } = analyserOptions(process.argv.slice(2))
  if (options.aide) {
    aide()
    return 0
  }
  if (inconnus.length) {
    console.error('Option inconnue : ' + inconnus.join(', ') + '\nUtiliser --aide pour la liste des options.')
    return 2
  }

  const executionId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex')

  if (options.rollback) return rollback(executionId)

  ui.titre('GARAGEFLOWS — CONFIGURATION AUTOMATIQUE')
  ui.info('Exécution : ' + executionId)
  ui.info('Mode      : ' + (options.simulation ? 'SIMULATION (aucune écriture)' : 'APPLICATION')
    + (options.horsLigne ? ' · HORS LIGNE' : '')
    + (options.fichiersCloud ? ' · fichiers cloud inclus' : ''))
  const autorisations = Object.entries(options)
    .filter((entree) => entree[1] === true && !['simulation', 'horsLigne', 'json', 'aide', 'rollback', 'fichiersCloud'].includes(entree[0]))
    .map((entree) => entree[0])
  ui.info('Autorisations explicites : ' + (autorisations.length ? autorisations.join(', ') : 'aucune (comportement le plus prudent)'))

  const prise = verrou.prendre(RACINE, { force: options.forcerVerrou })
  if (!prise.pris) {
    ui.ligne('BLOCKED', 'Verrou de configuration', prise.raison)
    return 3
  }
  if (prise.detenteur.repriseOrpheline) {
    ui.ligne('WARNING', 'Verrou de configuration', 'Verrou orphelin repris (processus précédent absent ou trop ancien).')
  }

  const journal = rapports.journal(RACINE, { executionId, simulation: options.simulation })
  const etatPrecedent = verrou.lireEtat(RACINE)
  if (etatPrecedent) {
    ui.ligne('WARNING', 'Reprise', 'Une exécution précédente (' + etatPrecedent.executionId + ') s est interrompue après l étape '
      + (etatPrecedent.derniereEtape || '?') + '. Les étapes déjà appliquées sont reconnues par relecture, pas rejouées à l aveugle.')
    journal.donnees.reprise = etatPrecedent
  }

  // ───────────────────────────────── 0. Les trois sélections de l'opérateur
  // PROJET, BRANCHE, ENVIRONNEMENT : les seuls choix demandés. Tout le reste
  // est découvert. Les trois sont posés AVANT le pipeline, car l'environnement
  // choisi borne les écritures de toutes les étapes suivantes.
  journal.etape(0, 'Sélections de l opérateur : projet, branche, environnement')
  let choix = null
  try {
    const clientVercel = fournisseurVercel.client(RACINE, { cliEpingle: false })
    choix = await selection.choisir(RACINE, options, clientVercel)
  } catch (erreur) {
    if (erreur && erreur.selection) {
      journal.ligne('FAILED', 'Sélections', redact.nettoyer(erreur.message))
      journal.cloturer()
      prise.liberer()
      return 2
    }
    journal.ligne('WARNING', 'Sélections',
      'Découverte des projets et branches incomplète : ' + redact.nettoyer(erreur.message)
      + ' — exécution poursuivie sans restriction d environnement.')
    choix = null
  }

  if (choix) {
    const nomProjet = choix.projet ? choix.projet.nom : null
    journal.ligne(nomProjet ? 'SUCCESS' : 'WARNING', 'Projet',
      nomProjet
        ? nomProjet + ' (source : ' + choix.sources.projet + ' · '
          + choix.inventaire.projets.nombre + ' projet(s) découvert(s))'
        : 'Aucun projet Vercel identifié : les opérations distantes seront ignorées, pas devinées.')
    const nomBranche = choix.branche ? choix.branche.nom : null
    journal.ligne(nomBranche ? 'SUCCESS' : 'WARNING', 'Branche Git',
      nomBranche
        ? nomBranche + ' (source : ' + choix.sources.branche + ' · '
          + choix.inventaire.branches.nombre + ' branche(s) découverte(s))'
        : 'Aucune branche identifiée : dépôt Git absent ou racine non reconnue.')
    if (choix.environnement) {
      journal.ligne('SUCCESS', 'Environnement',
        choix.environnement.toUpperCase() + ' (source : ' + choix.sources.environnement + ') — '
        + 'écritures limitées à : ' + choix.ciblesEcriture.join(', ')
        + '. Les autres environnements restent LUS, jamais modifiés : c est ce qui permet de prouver l isolation.')
    } else {
      journal.ligne('SKIPPED', 'Environnement',
        'Aucun environnement sélectionné : toutes les cibles existantes sont traitées (comportement historique).')
    }
    for (const avertissement of choix.avertissements) {
      journal.ligne('WARNING', 'Sélections', avertissement)
    }
    journal.donnees.selection = {
      projet: nomProjet,
      branche: nomBranche,
      environnement: choix.environnement,
      sources: choix.sources,
      ciblesEcriture: choix.ciblesEcriture,
      inventaire: choix.inventaire,
    }
    options.environnement = choix.environnement
    options.ciblesEcriture = choix.ciblesEcriture
    options.brancheSelectionnee = nomBranche
    options.projetSelectionne = nomProjet
  }
  journal.cloturer()

  let codeSortie = 0
  let interrompu = false
  const terminer = () => {
    interrompu = true
  }
  process.once('SIGINT', terminer)
  process.once('SIGTERM', terminer)

  let etat = null
  try {
    etat = await pipeline.executer({ racine: RACINE, options, rapport: journal, executionId })
  } catch (erreur) {
    journal.erreur('pipeline', erreur)
    ui.ligne('FAILED', 'Exécution interrompue', redact.nettoyer(erreur.message))
    codeSortie = 1
    // Retour arrière automatique des écritures de CETTE exécution : une
    // configuration à moitié appliquée est plus dangereuse qu'une absence de
    // configuration, car elle donne l'illusion d'un système prêt.
    if (etat && etat.sessionSauvegarde && etat.sessionSauvegarde.entrees.length && !options.simulation) {
      const restauration = etat.sessionSauvegarde.restaurer()
      for (const fichier of restauration.restaures) {
        journal.ligne('SUCCESS', 'Retour arrière ' + fichier, 'État d origine restauré après l échec.')
      }
      for (const refus of restauration.refuses) {
        journal.ligne('BLOCKED', 'Retour arrière ' + refus.fichier, refus.raison)
      }
    }
  }

  // ───────────────────────────────────────────────── 20. Rapport final
  journal.etape(20, 'Rapport final')
  try {
    if (interrompu) {
      journal.ligne('WARNING', 'Interruption', 'Signal reçu pendant l exécution : l état de reprise est conservé pour la prochaine exécution.')
    }
    if (etat && etat.sondes) journal.donnees.sondes = etat.sondes
    journal.ligne('SUCCESS', 'Statuts employés',
      'SUCCESS = contrôle réellement effectué · REUSED = valeur existante conservée · GENERATED = secret créé · '
      + 'SYNCHRONIZED = variable écrite chez Vercel · WARNING = anomalie non bloquante · BLOCKED = autorisation ou ressource manquante · '
      + 'FAILED = erreur technique · SKIPPED = opération volontairement non effectuée.')
    journal.cloturer()

    const ecrit = journal.finaliser(path.join(__dirname, 'reports'))
    if (options.json) {
      process.stdout.write(JSON.stringify({ rapport: ecrit.fichier, verdict: ecrit.donnees.resume.verdict, resume: ecrit.donnees.resume }, null, 2) + '\n')
    } else {
      rapports.afficherResume(ecrit.donnees)
      ui.info('')
      ui.info('Rapport complet : ' + path.relative(RACINE, ecrit.fichier))
    }

    const verdict = ecrit.donnees.resume.verdict
    if (codeSortie === 0) {
      if (verdict === 'FAILED') codeSortie = 1
      else if (verdict === 'BLOCKED') codeSortie = 4
      else codeSortie = 0
    }

    // État de reprise : conservé seulement si quelque chose reste en suspens.
    const enSuspens = interrompu || ecrit.donnees.resume.bloquees > 0 || ecrit.donnees.erreurs.length > 0
    if (enSuspens) {
      verrou.ecrireEtat(RACINE, {
        executionId,
        derniereEtape: ecrit.donnees.etapes.filter((element) => element.numero !== null).length,
        verdict,
        bloquees: ecrit.donnees.secrets.bloques,
        erreurs: ecrit.donnees.erreurs.map((element) => element.contexte),
      })
    } else {
      verrou.effacerEtat(RACINE)
    }
  } catch (erreur) {
    ui.ligne('FAILED', 'Rapport final', redact.nettoyer(erreur.message))
    codeSortie = 1
  } finally {
    prise.liberer()
  }

  return codeSortie
}

if (require.main === module) {
  // Sortie tronquée (`| head`, terminal fermé) : sans ce garde-fou, la première
  // écriture après la fermeture du tuyau tue le processus avant la libération
  // du verrou. Le verrou orphelin est certes repris à l'exécution suivante,
  // mais l'opérateur voit alors un avertissement pour un incident qui n'en est
  // pas un.
  for (const flux of [process.stdout, process.stderr]) {
    flux.on('error', (erreur) => {
      if (erreur && (erreur.code === 'EPIPE' || erreur.code === 'ERR_STREAM_DESTROYED')) return
      throw erreur
    })
  }

  principal()
    .then((code) => {
      process.exitCode = code
    })
    .catch((erreur) => {
      // Dernier filet : même une erreur imprévue ne doit pas afficher de valeur.
      console.error('Configuration interrompue : ' + redact.nettoyer(erreur && erreur.message ? erreur.message : String(erreur)))
      process.exitCode = 1
    })
}

module.exports = { principal, analyserOptions, aide, RACINE, DRAPEAUX }
