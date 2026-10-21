'use strict'
/**
 * PIPELINE — les vingt étapes de la configuration automatique.
 *
 * Le pipeline est écrit pour être IDEMPOTENT : relancé dix fois, il ne crée pas
 * dix autorités cryptographiques ni dix bases de données. Cela repose sur trois
 * principes appliqués à chaque étape :
 *
 *   · CHERCHER avant de produire — l'inventaire précède toujours la décision ;
 *   · RÉUTILISER avant de remplacer — une valeur conforme est conservée telle
 *     quelle, et le rapport dit `REUSED` plutôt que de faire semblant d'agir ;
 *   · VÉRIFIER avant de conclure — un statut `SUCCESS` correspond à un contrôle
 *     réellement exécuté, et une opération qu'on n'a pas pu tenter est
 *     rapportée comme telle.
 *
 * Les étapes de lecture n'écrivent rien. Les seules étapes qui modifient quoi
 * que ce soit sont la 14 (fichiers locaux, après sauvegarde) et la 15
 * (synchronisation Vercel, création uniquement sauf autorisation explicite).
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const manifeste = require('../config/manifest.js')
const destinations = require('../config/destinations.js')
const discovery = require('./discovery.js')
const engine = require('./engine.js')
const backup = require('./backup.js')
const secrets = require('../security/secrets.js')
const autorite = require('../security/license-authority.js')
const redact = require('../security/redact.js')
const fichierEnv = require('../utils/env-file.js')
const fsx = require('../utils/fsx.js')
const exec = require('../utils/exec.js')
const fournisseurVercel = require('../providers/vercel.js')
const fournisseurPostgres = require('../providers/postgres.js')
const fournisseurUpstash = require('../providers/upstash.js')
const fournisseurStockage = require('../providers/storage.js')
const fournisseurSmtp = require('../providers/smtp.js')
const fournisseurAnthropic = require('../providers/anthropic.js')
const fournisseurEinvoicing = require('../providers/einvoicing.js')
const validateurVariables = require('../validators/variables.js')
const validateurEnvironnements = require('../validators/environments.js')
const validateurDepot = require('../validators/repository.js')

const CIBLES_ANALYSE = ['desktop', 'development', 'preview', 'production']

/** Fichiers que le configurateur peut écrire, par cible. */
function fichierDeCible(cible) {
  return engine.CIBLES[cible] ? engine.CIBLES[cible].fichier : null
}

async function executer(contexte) {
  const { racine, options, rapport } = contexte
  const etat = {
    unifie: null,
    divergences: null,
    decouverte: null,
    vercel: null,
    clientVercel: null,
    projet: null,
    snapshots: {},
    licence: null,
    plan: null,
    sondes: {},
    ecritures: [],
    sessionSauvegarde: null,
    cibles: [],
  }

  // ───────────────────────────────────────────────────────────── 1. Système
  rapport.etape(1, 'Système d exploitation et environnement de travail')
  {
    const windows = process.platform === 'win32'
    rapport.ligne(windows ? 'SUCCESS' : 'WARNING',
      'Plateforme ' + process.platform + ' ' + os.release(),
      windows
        ? 'Windows détecté : écritures atomiques et chemins à barres obliques pris en charge.'
        : 'Le configurateur fonctionne, mais les contrôles de permissions de fichiers diffèrent de la cible Windows du projet.')
    rapport.ligne('SUCCESS', 'Répertoire de travail', racine)
    const racineProjet = fs.existsSync(path.join(racine, 'package.json')) && fs.existsSync(path.join(racine, 'scripts/config-core.cjs'))
    if (!racineProjet) {
      rapport.ligne('FAILED', 'Racine du dépôt', 'package.json ou scripts/config-core.cjs introuvable : lancer la commande depuis la racine de GarageFlows.')
      rapport.cloturer('FAILED')
      throw new Error('Racine du dépôt GarageFlows non reconnue.')
    }
    if (windows) {
      // La console Windows en page de code 850/1252 affiche mal les accents des
      // messages. On le constate sans rien modifier dans la session de l'utilisateur.
      const encodage = process.stdout.isTTY ? (process.env.PYTHONIOENCODING || 'inconnu') : 'non-tty'
      rapport.ligne('SUCCESS', 'Sortie console', 'TTY=' + !!process.stdout.isTTY + ', encodage déclaré=' + encodage)
    }
  }
  rapport.cloturer()

  // ──────────────────────────────────────────────────────── 2. Node.js et npm
  rapport.etape(2, 'Node.js et npm')
  {
    const noyau = require(path.join(racine, 'scripts/config-core.cjs'))
    try {
      noyau.assertNodeVersion()
      rapport.ligne('SUCCESS', 'Node.js ' + process.versions.node, 'Conforme à la contrainte du projet (>=22.12.0 <23).')
    } catch (erreur) {
      rapport.ligne('FAILED', 'Node.js ' + process.versions.node, erreur.message)
      rapport.cloturer('FAILED')
      throw erreur
    }
    try {
      const npm = exec.npmCli()
      const version = await exec.lancer(process.execPath, [npm, '--version'], { cwd: racine, delaiMs: 60000, libelle: 'npm' })
      rapport.ligne('SUCCESS', 'npm ' + version.stdout.trim(), 'Disponible sans shell (npm-cli.js résolu).')
    } catch (erreur) {
      rapport.ligne('WARNING', 'npm', 'Non résolu : ' + erreur.message + ' Les opérations qui dépendent de npm seront ignorées.')
    }
  }
  rapport.cloturer()

  // ──────────────────────────────────────────────────── 3. Dépendances requises
  rapport.etape(3, 'Dépendances nécessaires aux contrôles réels')
  {
    const requises = [
      { chemin: 'node_modules/prisma/build/index.js', nom: 'prisma (CLI)', usage: 'validation des schémas', commande: 'npm ci' },
      { chemin: 'node_modules/@prisma/client', nom: '@prisma/client', usage: 'inspection SQLite desktop', commande: 'npm ci' },
      { chemin: 'src/generated/server-client/index.js', nom: 'client Prisma PostgreSQL', usage: 'sonde de connexion à la base serveur', commande: 'npm run db:server:generate' },
      { chemin: 'node_modules/@vercel/blob/package.json', nom: '@vercel/blob', usage: 'contrôle du stockage Blob', commande: 'npm ci' },
    ]
    for (const dependance of requises) {
      const present = fs.existsSync(path.join(racine, dependance.chemin))
      rapport.ligne(present ? 'SUCCESS' : 'WARNING', dependance.nom,
        present
          ? 'Présente — ' + dependance.usage + ' possible.'
          : 'Absente : ' + dependance.usage + ' sera rapporté comme non effectué. Installation non déclenchée automatiquement (' + dependance.commande + ').')
      if (!present) {
        rapport.nonEffectue(dependance.usage, 'Dépendance absente : ' + dependance.nom + '. Exécuter « ' + dependance.commande + ' ».')
      }
    }
  }
  rapport.cloturer()

  // ──────────────────────────────────────────────────────── 4. Analyse du dépôt
  rapport.etape(4, 'Analyse du dépôt et des lectures d environnement')
  {
    etat.unifie = manifeste.charger(racine)
    etat.divergences = manifeste.verifierContrat(etat.unifie)
    const scan = etat.unifie.scan
    rapport.ligne('SUCCESS', 'Fichiers de code analysés',
      scan.fichiersAnalyses + ' fichiers (' + Object.entries(scan.parCategorie).map((entree) => entree[1] + ' ' + entree[0]).join(', ') + ')')
    rapport.ligne('SUCCESS', 'Noms d environnement lus dans le code', String(scan.references.size))
    rapport.donnees.analyse = {
      fichiersAnalyses: scan.fichiersAnalyses,
      parCategorie: scan.parCategorie,
      nomsLus: scan.references.size,
      divergences: {
        consommeesHorsContrat: etat.divergences.consommeesHorsContrat,
        consommateursIntrouvables: etat.divergences.consommateursIntrouvables,
        sansLectureLitterale: etat.divergences.sansLectureLitterale.map((element) => element.nom),
        generationDivergente: etat.divergences.generationDivergente,
        aliasPresentsDansLeCode: etat.divergences.aliasPresentsDansLeCode,
      },
    }

    if (etat.divergences.consommeesHorsContrat.length) {
      for (const element of etat.divergences.consommeesHorsContrat) {
        rapport.ligne('WARNING', element.nom, 'Lue par le code mais absente du manifeste : ' + element.fichiers.slice(0, 3).join(', '))
      }
      rapport.nonAutomatisable('Manifeste des variables',
        'Des variables sont consommées sans être déclarées. Le manifeste est un fichier versionné du dépôt : il n est pas modifié automatiquement.')
    } else {
      rapport.ligne('SUCCESS', 'Contrat des variables', 'Aucune variable consommée hors du manifeste.')
    }
    if (etat.divergences.consommateursIntrouvables.length) {
      for (const element of etat.divergences.consommateursIntrouvables) {
        rapport.ligne('WARNING', element.nom, 'Consommateur déclaré introuvable : ' + element.fichiers.join(', '))
      }
    }
    if (etat.divergences.aliasPresentsDansLeCode.length) {
      for (const element of etat.divergences.aliasPresentsDansLeCode) {
        rapport.ligne('WARNING', element.nom, 'Alias interdit présent dans le code ; nom canonique : ' + element.canonique)
      }
    }
    if (etat.divergences.sansLectureLitterale.length) {
      rapport.ligne('SUCCESS', 'Lectures dynamiques',
        etat.divergences.sansLectureLitterale.length + ' variables sont lues via process.env[nom] : le consommateur déclaré fait foi, un inventaire statique ne peut pas les prouver.')
    }
  }
  rapport.cloturer()

  // ──────────────────────────────────────────── 5. Manifeste et destinations
  rapport.etape(5, 'Manifeste des variables et politique de destination')
  {
    const incoherences = destinations.verifierPolitique(etat.unifie.entrees)
    if (incoherences.length) {
      for (const probleme of incoherences) rapport.ligne('FAILED', 'Politique de destination', probleme)
      rapport.cloturer('FAILED')
      throw new Error('Politique de destination incohérente ; aucune configuration appliquée.')
    }
    const parCategorie = {}
    for (const entree of etat.unifie.entrees) {
      const categorie = entree.destination.categorieDestination
      parCategorie[categorie] = (parCategorie[categorie] || 0) + 1
    }
    rapport.ligne('SUCCESS', 'Variables au contrat', etat.unifie.entrees.length + ' entrées, toutes avec une destination explicite.')
    for (const [categorie, nombre] of Object.entries(parCategorie).sort((a, b) => b[1] - a[1])) {
      rapport.info('  ' + String(nombre).padStart(4) + '  ' + categorie)
    }
    const generables = etat.unifie.entrees.filter((entree) => secrets.generable(entree.name))
    rapport.ligne('SUCCESS', 'Secrets générables', generables.length + ' variables disposent d une spécification CSPRNG vérifiée.')
    rapport.donnees.manifeste = {
      entrees: etat.unifie.entrees.length,
      parDestination: parCategorie,
      requisesProduction: etat.unifie.entrees.filter((entree) => entree.requiredProduction).map((entree) => entree.name),
      generables: generables.map((entree) => entree.name),
      fiches: etat.unifie.entrees.map((entree) => entree.fiche),
    }
  }
  rapport.cloturer()

  // ─────────────────────────────────────────── 6. Configurations existantes
  rapport.etape(6, 'Configurations déjà présentes sur ce poste')
  {
    const nomsContrat = new Set([...etat.unifie.parNom.keys()])
    etat.decouverte = discovery.collecter(racine, { nomsContrat })
    for (const fichier of etat.decouverte.fichiers) {
      if (!fichier.present) {
        rapport.ligne('SKIPPED', fichier.fichier, 'Absent (' + fichier.libelle + ').')
        continue
      }
      if (!fichier.lisible) {
        rapport.ligne('FAILED', fichier.fichier, 'Présent mais illisible : aucune valeur importée, aucune écriture tentée.')
        continue
      }
      const details = []
      if (fichier.doublons.length) details.push('doublons : ' + fichier.doublons.join(', '))
      if (fichier.malformees.length) details.push('valeurs mal formées : ' + fichier.malformees.join(', '))
      rapport.ligne(fichier.doublons.length || fichier.malformees.length ? 'WARNING' : 'SUCCESS', fichier.fichier,
        fichier.renseignees + '/' + fichier.variables + ' variables renseignées' + (details.length ? ' — ' + details.join(' ; ') : ''))
    }
    for (const [cible, noms] of Object.entries(etat.decouverte.brouillons)) {
      rapport.ligne('WARNING', 'Brouillon ' + cible,
        noms.length + ' valeurs laissées par une configuration interrompue. Utilisables seulement après contrôle réel.')
    }
    for (const nom of etat.decouverte.jetonsTemporaires) {
      rapport.ligne('SKIPPED', nom, 'Jeton temporaire (régénéré par vercel env pull, expire en quelques heures) : jamais traité comme un secret permanent ni synchronisé.')
    }
    for (const rejet of etat.decouverte.rejetees) {
      // Une valeur compromise trouvée dans une source LOCALE est un constat de
      // sécurité, pas un blocage de configuration : elle est simplement refusée
      // comme candidate. Le blocage n'arrive que si la variable manque ensuite
      // réellement — c'est l'étape 12 qui le dira, en connaissance du plan.
      rapport.ligne('WARNING', rejet.nom, rejet.motif + ' (source : ' + rejet.origine
        + '). Valeur écartée des candidates ; révoquer l identifiant chez le fournisseur et nettoyer cette source.')
    }
    rapport.ligne('SUCCESS', 'Valeurs candidates trouvées', etat.decouverte.parNom.size + ' noms connus localement (valeurs jamais affichées).')
  }
  rapport.cloturer()

  // ────────────────────────────────── 7. Authentifications des fournisseurs
  rapport.etape(7, 'Authentifications des fournisseurs')
  if (options.horsLigne) {
    rapport.ligne('SKIPPED', 'Détection réseau', 'Mode hors ligne : aucune authentification vérifiée.')
  } else {
    etat.clientVercel = fournisseurVercel.client(racine)
    try {
      etat.vercel = await etat.clientVercel.detecter()
      rapport.ligne(etat.vercel.cli ? 'SUCCESS' : 'BLOCKED', 'Vercel CLI',
        etat.vercel.cli
          ? etat.vercel.cli.source === 'cli-global'
            ? 'binaire global ' + etat.vercel.cli.version
            : 'version épinglée du dépôt (' + etat.vercel.cli.version + ')'
              + (etat.vercel.cli.cliGlobal ? ', binaire global ' + etat.vercel.cli.cliGlobal + ' ignoré car de version majeure différente' : ', aucun binaire global compatible')
          : 'introuvable')
      if (etat.vercel.session) {
        rapport.ligne('SUCCESS', 'Session Vercel', 'compte authentifié : ' + etat.vercel.compte)
      } else {
        rapport.ligne('BLOCKED', 'Session Vercel', 'Aucune session : aucune connexion interactive n est déclenchée par le configurateur.')
        rapport.autorisationManquante('Vercel', 'Session CLI absente.', 'vercel login')
      }
    } catch (erreur) {
      rapport.erreur('detection-vercel', erreur)
      rapport.ligne('FAILED', 'Vercel', 'Détection impossible : ' + redact.nettoyer(erreur.message))
    }

    // Les inventaires Neon et Upstash servent à RETROUVER une ressource
    // existante quand les variables manquent. Leur absence n'est donc pas une
    // autorisation manquante en soi : si les identifiants sont déjà en place
    // chez Vercel, l'outil n'aurait rien apporté. L'étape 12 consignera le
    // besoin d'authentification uniquement si une valeur reste introuvable.
    // ── Inventaire par l'intégration Vercel, AVANT tout CLI de fournisseur ──
    //
    // Les bases Neon et les instances Upstash de ce projet sont provisionnées
    // par le Marketplace : la session Vercel déjà en place suffit à les lister,
    // avec leur rattachement par environnement. Exiger en plus `neonctl` et le
    // CLI Upstash — chacun avec sa propre authentification — faisait rapporter
    // « inventaire non effectué » pour une information déjà accessible, et
    // renvoyait l'opérateur installer deux outils pour rien.
    let ressources = null
    if (etat.clientVercel && etat.vercel && etat.vercel.projet) {
      try {
        const inventaire = await etat.clientVercel.inventaireRessources(etat.vercel.projet)
        ressources = inventaire.ressources
        const nomProjet = etat.vercel.projet.projectName || null
        const rattachees = ressources.filter((ressource) => !nomProjet
          || ressource.projetsConnectes.includes(nomProjet))
        rapport.ligne('SUCCESS', 'Ressources de l équipe (intégrations Vercel)',
          ressources.length + ' ressource(s) découverte(s), dont ' + rattachees.length
          + ' rattachée(s) à ce projet — sans aucun CLI de fournisseur.')
        for (const ressource of rattachees) {
          rapport.ligne('SUCCESS', 'Ressource ' + ressource.nom,
            [ressource.produit || ressource.type,
              ressource.environnements.length
                ? 'environnements : ' + ressource.environnements.join(', ')
                : 'aucun environnement rattaché',
              ressource.region ? 'région ' + ressource.region : null,
              ressource.quotaDepasse ? 'QUOTA DÉPASSÉ' : null,
            ].filter(Boolean).join(' · '))
        }
        // Une ressource attachée à Preview ET Production mérite d'être dite :
        // c'est le rattachement qui, s'il fournit les variables effectives,
        // ferait travailler les déploiements de branche sur le service réel.
        for (const ressource of rattachees) {
          if (ressource.environnements.includes('preview') && ressource.environnements.includes('production')) {
            rapport.ligne('WARNING', 'Ressource ' + ressource.nom,
              'Rattachée à la fois à Preview et à Production. Les variables effectives de chaque '
              + 'environnement restent à vérifier : un même magasin servant les deux annulerait '
              + 'l isolation que le reste de la configuration s emploie à garantir.')
          }
        }
        const orphelines = ressources.filter((ressource) => ressource.nombreProjets === 0)
        if (orphelines.length) {
          rapport.ligne('WARNING', 'Ressources non rattachées',
            orphelines.length + ' ressource(s) de l équipe ne sont connectées à aucun projet ('
            + orphelines.map((ressource) => ressource.nom).join(', ')
            + '). Elles peuvent rester facturées. Aucune suppression automatique.')
        }
        rapport.donnees.fournisseurs.ressources = ressources
      } catch (erreur) {
        rapport.ligne('SKIPPED', 'Ressources de l équipe (intégrations Vercel)',
          'Inventaire indisponible : ' + redact.nettoyer(erreur.message)
          + ' — les CLI de fournisseur restent la seule source.')
      }
    }

    const neonIntegration = ressources
      ? etat.clientVercel.filtrerRessources(ressources, 'neon|postgres', null)
      : []
    const neon = await fournisseurPostgres.inventaireNeon(racine)
    neon.integrations = neonIntegration
    // L'inventaire est RÉPUTÉ FAIT dès que l'intégration a répondu : le CLI
    // n'apporte alors qu'un détail de branches, utile mais pas nécessaire.
    const neonConnu = neon.authentifie || neonIntegration.length > 0
    rapport.ligne(neonConnu ? 'SUCCESS' : 'SKIPPED', 'Inventaire Neon',
      neon.authentifie
        ? neon.projets.length + ' projet(s) via le CLI Neon'
        : neonIntegration.length
          ? neonIntegration.length + ' base(s) PostgreSQL via l intégration Vercel ('
            + neonIntegration.map((ressource) => ressource.nom).join(', ')
            + ') — CLI Neon non requis'
          : neon.erreur)
    if (!neonConnu) rapport.nonEffectue('Inventaire Neon', neon.erreur || 'Aucune source disponible.')
    etat.inventaireNeon = neon
    rapport.donnees.fournisseurs.neon = {
      authentifie: neon.authentifie,
      projets: neon.projets.length,
      integrations: neonIntegration.length,
      source: neon.authentifie ? 'cli' : (neonIntegration.length ? 'integration-vercel' : null),
      erreur: neonConnu ? null : neon.erreur,
    }

    const upstashIntegration = ressources
      ? etat.clientVercel.filtrerRessources(ressources, 'upstash|redis|kv', null)
      : []
    const upstash = await fournisseurUpstash.inventaire(racine)
    upstash.integrations = upstashIntegration
    const upstashConnu = upstash.authentifie || upstashIntegration.length > 0
    rapport.ligne(upstashConnu ? 'SUCCESS' : 'SKIPPED', 'Inventaire Upstash',
      upstash.authentifie
        ? upstash.bases.length + ' base(s) Redis via le CLI Upstash'
        : upstashIntegration.length
          ? upstashIntegration.length + ' instance(s) Redis via l intégration Vercel ('
            + upstashIntegration.map((ressource) => ressource.nom).join(', ')
            + ') — CLI Upstash non requis'
          : upstash.erreur)
    if (!upstashConnu) rapport.nonEffectue('Inventaire Upstash', upstash.erreur || 'Aucune source disponible.')
    etat.inventaireUpstash = upstash
    rapport.donnees.fournisseurs.upstash = {
      authentifie: upstash.authentifie,
      bases: upstash.bases.length,
      integrations: upstashIntegration.length,
      source: upstash.authentifie ? 'cli' : (upstashIntegration.length ? 'integration-vercel' : null),
      erreur: upstashConnu ? null : upstash.erreur,
    }
  }
  rapport.cloturer()

  // ───────────────────────────────────────────────────── 8. Vérifier Vercel
  rapport.etape(8, 'Projet Vercel : identité, équipe et environnements')
  if (options.horsLigne || !etat.vercel || !etat.vercel.session) {
    rapport.ligne('SKIPPED', 'Projet Vercel', options.horsLigne ? 'Mode hors ligne.' : 'Session absente : projet non interrogé.')
  } else if (!etat.vercel.projet) {
    rapport.ligne('BLOCKED', 'Projet Vercel', 'Aucun projet lié (.vercel/project.json absent ou invalide). Aucune supposition de projet.')
    rapport.autorisationManquante('Vercel', 'Projet non lié à ce dossier.', 'vercel link --project app.garageflows.fr --scope garage-flows')
  } else if (!etat.vercel.identiteConfirmee) {
    rapport.ligne('BLOCKED', 'Projet Vercel', 'Identité non confirmée par le serveur (blocage : ' + etat.vercel.blocage + ').')
  } else {
    etat.projet = etat.vercel.projet
    rapport.ligne('SUCCESS', 'Projet ' + (etat.vercel.nomProjet || etat.projet.projectName || etat.projet.projectId),
      'Identité et équipe confirmées par l API (équipe ' + etat.vercel.equipe + ').')
    rapport.donnees.vercel.projet = {
      projectId: etat.projet.projectId,
      orgId: etat.projet.orgId,
      nom: etat.vercel.nomProjet || etat.projet.projectName,
      cli: etat.vercel.cli,
      compte: etat.vercel.compte,
    }
  }
  rapport.cloturer()

  // ────────────────────────────────── 9. Variables existantes chez Vercel
  rapport.etape(9, 'Variables existantes chez Vercel (par environnement)')
  if (!etat.projet) {
    rapport.ligne('SKIPPED', 'Lecture Vercel', 'Projet non confirmé : aucune lecture distante.')
  } else {
    for (const cible of fournisseurVercel.CIBLES) {
      try {
        const snapshot = await etat.clientVercel.lire(etat.projet, cible)
        etat.snapshots[cible] = snapshot
        const lisibles = Object.keys(snapshot.valeurs).filter((nom) => snapshot.valeurs[nom])
        rapport.ligne('SUCCESS', 'Environnement ' + cible,
          snapshot.presentes.size + ' variables : ' + lisibles.length + ' relisibles, ' + snapshot.cachees.size
          + ' protégées en lecture (Sensitive), ' + snapshot.protegees.size + ' détenues par une intégration.')
        if (snapshot.lecture !== 'lue') {
          rapport.ligne('WARNING', 'Lecture groupée ' + cible,
            'Refusée par l API : les noms sont connus, les valeurs restent indéterminées. Aucune conclusion de « valeur absente ».')
        }
        if (snapshot.surchargesBranche) {
          rapport.ligne('WARNING', 'Surcharges de branche ' + cible,
            snapshot.surchargesBranche + ' variable(s) liée(s) à une branche ou à un environnement personnalisé : laissées intactes.')
        }
        rapport.donnees.vercel.environnements[cible] = {
          presentes: [...snapshot.presentes].sort(),
          relisibles: lisibles.sort(),
          protegeesEnLecture: [...snapshot.cachees].sort(),
          detenuesParIntegration: [...snapshot.protegees].sort(),
          surchargesBranche: snapshot.surchargesBranche,
          lecture: snapshot.lecture,
        }
        // Les valeurs relisibles deviennent des candidats de récupération.
        for (const [nom, valeur] of Object.entries(snapshot.valeurs)) {
          if (!valeur) continue
          if (!etat.decouverte.parNom.has(nom)) etat.decouverte.parNom.set(nom, [])
          etat.decouverte.parNom.get(nom).push({
            nom, valeur, empreinte: redact.empreinteCourte(valeur),
            origine: 'vercel:' + cible, cible, confiance: 'prouvee',
            preuve: 'lue depuis le projet Vercel (' + cible + ')',
          })
        }
      } catch (erreur) {
        rapport.erreur('lecture-vercel-' + cible, erreur)
        rapport.ligne('FAILED', 'Environnement ' + cible, 'Lecture impossible : ' + redact.nettoyer(erreur.message))
      }
    }
  }
  rapport.cloturer()

  // ─────────────────────────────── 10. Plan : récupération puis génération
  rapport.etape(10, 'Plan de configuration : réutilisation, dérivation, génération')
  {
    // Prouver les brouillons AVANT de les autoriser : une URL de base qui
    // répond à SELECT 1 est vérifiée par l'usage, pas par la confiance.
    const brouillonsProuves = new Set()
    if (!options.horsLigne) {
      for (const [cible, noms] of Object.entries(etat.decouverte.brouillons)) {
        const valeurs = {}
        for (const nom of ['DATABASE_URL', 'DIRECT_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
          if (!noms.includes(nom)) continue
          const candidat = (etat.decouverte.parNom.get(nom) || []).find((element) => element.origine === 'brouillon:' + cible)
          if (candidat) valeurs[nom] = candidat.valeur
        }
        if (valeurs.DATABASE_URL && valeurs.DIRECT_URL) {
          const sonde = await fournisseurPostgres.sonder(racine, valeurs)
          etat.sondes['brouillon-postgres-' + cible] = sonde
          if (sonde.poolee && sonde.directe) {
            brouillonsProuves.add('DATABASE_URL@' + cible)
            brouillonsProuves.add('DIRECT_URL@' + cible)
            rapport.ligne('SUCCESS', 'Brouillon ' + cible + ' : base de données',
              'Connexions poolée ET directe confirmées (' + (sonde.resumePoolee ? sonde.resumePoolee.hote : 'hôte inconnu')
              + ', base ' + (sonde.resumePoolee ? sonde.resumePoolee.base : '?') + ', '
              + (sonde.vide === null ? 'contenu non inspecté' : sonde.vide ? 'aucune donnée métier' : sonde.tables + ' tables avec données') + ').')
          } else {
            rapport.ligne('BLOCKED', 'Brouillon ' + cible + ' : base de données',
              'Connexion non confirmée : valeur non importée. ' + (sonde.erreur || ''))
          }
        }
        if (valeurs.UPSTASH_REDIS_REST_URL && valeurs.UPSTASH_REDIS_REST_TOKEN) {
          const sonde = await fournisseurUpstash.sonder(racine, valeurs)
          etat.sondes['brouillon-redis-' + cible] = sonde
          if (sonde.joignable) {
            brouillonsProuves.add('UPSTASH_REDIS_REST_URL@' + cible)
            brouillonsProuves.add('UPSTASH_REDIS_REST_TOKEN@' + cible)
            rapport.ligne('SUCCESS', 'Brouillon ' + cible + ' : Redis',
              'PING REST confirmé sur ' + sonde.hote + ' (' + sonde.latenceMs + ' ms).')
          } else {
            rapport.ligne('BLOCKED', 'Brouillon ' + cible + ' : Redis',
              'PING non confirmé : valeur non importée. ' + (sonde.erreur || ''))
          }
        }
      }
    }

    // Autorité de licence : inspectée ici car elle alimente une dérivation.
    etat.licence = autorite.inspecter(racine)
    const derivees = {}
    if (etat.licence.clePriveePresente) {
      const derivation = autorite.deriverVariablePrivee(racine, etat.licence)
      derivees.GF_PRIVATE_KEY = derivation.valeur
        ? { valeur: derivation.valeur, origine: 'keys/private.pem', empreinte: redact.empreinteCourte(derivation.valeur) }
        : { bloque: derivation.bloque }
      if (derivation.valeur) redact.enregistrer(derivation.valeur)
    }

    // Empreinte de la base de production : dérivée de l'URL de production si
    // elle est relisible. Sinon la valeur déjà déclarée est conservée.
    const urlProduction = (etat.snapshots.production && etat.snapshots.production.valeurs.DATABASE_URL)
      || (etat.decouverte.parNom.get('DATABASE_URL') || []).filter((candidat) => candidat.cible === 'production').map((candidat) => candidat.valeur)[0]
      || null
    if (urlProduction) {
      const empreinte = fournisseurPostgres.empreinteCible(urlProduction)
      if (empreinte) {
        for (const cible of CIBLES_ANALYSE) {
          derivees['GF_PRODUCTION_DB_FINGERPRINT@' + cible] = {
            valeur: empreinte, origine: 'derive:DATABASE_URL@production', empreinte: empreinte.slice(0, 12),
          }
        }
      }
    }

    // Cibles ANALYSÉES : toutes celles qui existent réellement, pour que le
    // rapport dise la vérité sur chaque environnement.
    etat.cibles = CIBLES_ANALYSE.filter((cible) => {
      if (cible === 'desktop' || cible === 'production') return true
      if (options.fichiersCloud) return true
      if (fs.existsSync(path.join(racine, fichierDeCible(cible)))) return true
      return !!(etat.snapshots[cible] && etat.snapshots[cible].presentes.size)
    })

    // Cibles ÉCRITES : plus restreint. Un miroir local de Preview n'est lu par
    // personne (Next.js ne charge pas `.env.preview.local`), et un
    // `.env.development.local` créé d'office changerait le comportement de
    // `npm run dev`, qui tourne aujourd'hui sur SQLite. On n'écrit donc ces
    // fichiers que s'ils existent déjà — l'opérateur les utilise — ou si
    // `--fichiers-cloud` le demande explicitement.
    etat.ciblesEcrites = etat.cibles.filter((cible) => {
      if (cible === 'desktop' || cible === 'production') return true
      if (options.fichiersCloud) return true
      return fs.existsSync(path.join(racine, fichierDeCible(cible)))
    })

    // ── Environnement SÉLECTIONNÉ : borne des ÉCRITURES, pas des lectures ──
    //
    // L'opérateur choisit UN environnement (§ sélections). À partir d'ici, rien
    // ne doit muter ailleurs : écrire `.env` du poste pendant une configuration
    // de production, ou toucher Preview pendant une configuration de
    // development, est exactement la confusion d'environnements que le reste de
    // ce fichier s'emploie à rendre impossible.
    //
    // `etat.cibles` (ANALYSE) reste complet : c'est ce qui permet de constater,
    // en lecture seule, que Preview et Production visent des bases distinctes.
    // Seule la liste des cibles ÉCRITES est réduite.
    if (Array.isArray(options.ciblesEcriture)) {
      const autorisees = new Set(options.ciblesEcriture)
      etat.ciblesHorsSelection = etat.ciblesEcrites.filter((cible) => !autorisees.has(cible))
      etat.ciblesEcrites = etat.ciblesEcrites.filter((cible) => autorisees.has(cible))
    } else {
      etat.ciblesHorsSelection = []
    }

    // Vacuité des bases : c'est la preuve qui autorise — ou interdit — la
    // création d'une clé liée à des données déjà écrites. Une base qu'on ne
    // peut pas inspecter vaut « inconnue », jamais « vide ».
    const basesVides = {}
    for (const cible of CIBLES_ANALYSE) {
      if (cible === 'desktop') {
        const urlLocale = (etat.decouverte.parNom.get('DATABASE_URL') || [])
          .filter((candidat) => candidat.origine === 'fichier:.env')
          .map((candidat) => candidat.valeur)[0] || engine.DEFAUTS_DESKTOP.DATABASE_URL
        if (urlLocale.startsWith('file:')) {
          try {
            const services = require(path.join(racine, 'scripts/config-services.cjs'))
            const inspection = await services.inspectDesktop(racine, urlLocale)
            basesVides.desktop = inspection.empty
            rapport.ligne('SUCCESS', 'Base locale SQLite',
              inspection.tableCount + ' tables, ' + (inspection.empty ? 'aucune donnée métier' : 'données métier présentes')
              + ' — détermine si une clé liée aux données peut être créée sans risque.')
          } catch (erreur) {
            basesVides.desktop = null
            rapport.ligne('WARNING', 'Base locale SQLite', 'Inspection impossible : ' + redact.nettoyer(erreur.message)
              + ' Les clés liées aux données ne seront pas créées.')
          }
        }
        continue
      }
      if (options.horsLigne) {
        basesVides[cible] = null
        continue
      }
      const snapshot = etat.snapshots[cible]
      if (!snapshot) {
        basesVides[cible] = null
        continue
      }
      const urls = { ...snapshot.aliasRessources, ...snapshot.valeurs }
      if (!urls.DIRECT_URL) {
        basesVides[cible] = null
        continue
      }
      const sonde = etat.sondes['postgres-' + cible] || await fournisseurPostgres.sonder(racine, urls)
      etat.sondes['postgres-' + cible] = sonde
      basesVides[cible] = sonde.vide
    }
    etat.basesVides = basesVides
    rapport.donnees.basesVides = basesVides

    etat.plan = engine.planifier({
      unifie: etat.unifie,
      decouverte: etat.decouverte,
      distant: etat.snapshots,
      derivees,
      cibles: etat.cibles,
      brouillonsProuves,
      basesVides,
      options,
    })

    // Génération effective des secrets que le plan a décidé de créer.
    const dejaAttribuees = new Set()
    for (const candidats of etat.decouverte.parNom.values()) {
      for (const candidat of candidats) dejaAttribuees.add(candidat.valeur)
    }
    for (const cible of etat.cibles) {
      for (const prise of etat.plan.cibles[cible].decisions) {
        if (prise.action !== 'generer' || prise.valeur) continue
        try {
          const produit = secrets.generer(prise.nom, { exclure: dejaAttribuees })
          prise.valeur = produit.valeur
          prise.origine = 'genere:csprng'
          prise.confiance = 'prouvee'
          prise.empreinte = redact.empreinteCourte(produit.valeur)
          dejaAttribuees.add(produit.valeur)
          redact.enregistrer(produit.valeur)
        } catch (erreur) {
          prise.action = 'bloquer'
          prise.statut = 'FAILED'
          prise.raison = 'Génération refusée : ' + erreur.message
          rapport.erreur('generation-' + prise.nom, erreur)
        }
      }
    }

    for (const cible of etat.cibles) {
      const decisions = etat.plan.cibles[cible].decisions
      const interessantes = decisions.filter((prise) => prise.statut !== 'SKIPPED')
      rapport.ligne('SUCCESS', 'Cible ' + cible,
        interessantes.length + ' variables à traiter sur ' + decisions.length + ' rattachées (' + engine.CIBLES[cible].libelle + ').')
      for (const prise of interessantes) {
        rapport.variable(prise)
        rapport.ligne(prise.statut, cible + ' / ' + prise.nom, prise.raison)
        for (const avertissement of prise.avertissements) rapport.info('        ! ' + avertissement)
      }
      // Les décisions ignorées sont enregistrées dans le rapport, sans bruit
      // dans le terminal : elles expliquent pourquoi une variable du contrat
      // n'apparaît nulle part.
      for (const prise of decisions.filter((element) => element.statut === 'SKIPPED')) rapport.variable(prise)
    }
  }
  rapport.cloturer()

  // ───────────────────────────────────── 11. Clés cryptographiques du produit
  rapport.etape(11, 'Autorité de licences et clés cryptographiques')
  {
    const licence = etat.licence || autorite.inspecter(racine)
    etat.licence = licence
    rapport.donnees.licence = {
      clePriveePresente: licence.clePriveePresente,
      clePubliquePresente: licence.clePubliquePresente,
      chiffree: licence.chiffree,
      courbe: licence.courbe,
      empreinteAutorite: licence.empreinteCleePrivee || licence.empreinteClePublique,
      ancrages: licence.ancrages.map((ancrage) => ({ fichier: ancrage.fichier, present: ancrage.present, empreinte: ancrage.empreinte })),
      ancrageTest: licence.ancrageTest,
      autoriteExiste: licence.autoriteExiste,
      generationAutorisee: licence.generationAutorisee,
    }

    if (licence.clePriveePresente && licence.correspondancePriveePublique && licence.signatureVerifiee) {
      rapport.ligne('REUSED', 'Autorité de licences',
        'Paire P-256 existante réutilisée : clé privée et clé publique correspondent, signature vérifiée par un essai réel (empreinte '
        + String(licence.empreinteCleePrivee).slice(0, 16) + '…).')
    } else if (licence.autoriteExiste && !licence.clePriveePresente) {
      rapport.ligne('BLOCKED', 'Autorité de licences',
        'Une autorité existe (clé publique embarquée dans les clients) mais sa clé privée est absente de ce poste. Aucune génération : une nouvelle paire créerait une autorité concurrente que les clients déjà installés refuseraient.')
    } else if (licence.chiffree) {
      rapport.ligne('WARNING', 'Autorité de licences', 'Clé privée chiffrée par phrase secrète : identité non vérifiable en mode automatique, aucune valeur dérivée.')
    } else if (licence.generationAutorisee && options.creerAutoriteLicence) {
      if (options.simulation) {
        rapport.ligne('SKIPPED', 'Autorité de licences',
          'Création autorisée et aucune autorité existante : une paire ECDSA P-256 serait créée. Mode simulation, rien n est écrit.')
      } else {
        try {
          const creation = autorite.creerAutorite(racine, licence, {
            ecrire: (fichier, contenu, parametres) => fsx.ecrireAtomique(fichier, contenu, parametres),
          })
          rapport.ligne('GENERATED', 'Autorité de licences',
            'Paire ECDSA P-256 créée (empreinte ' + creation.empreinte.slice(0, 16) + '…) dans keys/private.pem et keys/public.pem.')
          rapport.nonAutomatisable('Diffusion de la nouvelle clé publique',
            'La clé publique doit maintenant être embarquée dans les clients (npm run keys:sync, puis reconstruction et redistribution). '
            + 'Tant que ce n est pas fait, aucune licence signée par cette autorité ne sera acceptée par un client installé.')
          etat.licence = autorite.inspecter(racine)
        } catch (erreur) {
          rapport.erreur('creation-autorite-licence', erreur)
          rapport.ligne('FAILED', 'Autorité de licences', redact.nettoyer(erreur.message))
        }
      }
    } else if (licence.generationAutorisee) {
      rapport.ligne('WARNING', 'Autorité de licences',
        'Aucune autorité détectée. La création n est pas automatique : elle définirait la racine de confiance de toutes les licences (--creer-autorite-licence pour l autoriser sur une installation réellement neuve).')
      rapport.nonAutomatisable('Création de l autorité de licences',
        'Décision structurante : la clé publique correspondante doit être embarquée dans les clients avant toute émission de licence.')
    }

    for (const ancrage of licence.ancrages) {
      rapport.ligne(ancrage.present ? 'SUCCESS' : 'WARNING', 'Ancrage ' + ancrage.fichier,
        ancrage.present
          ? 'Clé publique embarquée, empreinte ' + String(ancrage.empreinte).slice(0, 16) + '… (' + ancrage.libelle + ')'
          : 'Ancrage introuvable dans ce fichier.')
    }
    if (licence.ancragesProductionCoherents) {
      rapport.ligne('SUCCESS', 'Cohérence des ancrages de production', 'Electron et Next.js embarquent la même clé publique.')
    }
    for (const anomalie of licence.anomalies) rapport.ligne('BLOCKED', 'Autorité de licences', anomalie)
    for (const avertissement of licence.avertissements) rapport.ligne('WARNING', 'Autorité de licences', avertissement)

    // Contrôle complémentaire : la garde du dépôt elle-même.
    try {
      const resultat = await exec.lancer(process.execPath, [path.join(racine, 'scripts/sync-public-key.mjs'), '--check'],
        { cwd: racine, delaiMs: 90000, captureStderr: true, libelle: 'keys:check' })
      rapport.ligne(resultat.code === 0 ? 'SUCCESS' : 'WARNING', 'Garde keys:check',
        resultat.code === 0
          ? 'Tous les ancrages sont alignés sur keys/public.pem.'
          : 'Divergence signalée par la garde du dépôt. Aucune réparation automatique : npm run keys:sync réécrirait l empreinte de référence historique.')
    } catch (erreur) {
      rapport.ligne('SKIPPED', 'Garde keys:check', 'Non exécutée : ' + redact.nettoyer(erreur.message))
    }
  }
  rapport.cloturer()

  // ──────────────────────────── 12. Ressources externes et valeurs bloquées
  rapport.etape(12, 'Ressources externes manquantes et valeurs non automatisables')
  {
    const bloquees = []
    for (const cible of etat.cibles) {
      for (const prise of etat.plan.cibles[cible].decisions) {
        if (prise.statut === 'BLOCKED') bloquees.push(prise)
      }
    }
    if (!bloquees.length) {
      rapport.ligne('SUCCESS', 'Ressources externes', 'Aucune valeur bloquée : tout ce qui est nécessaire est disponible ou déjà en place.')
    }
    for (const prise of bloquees) {
      rapport.ligne('BLOCKED', prise.cible + ' / ' + prise.nom, prise.raison)
      const entree = etat.unifie.parNom.get(prise.nom)
      // Une valeur candidate avait-elle été écartée parce qu'elle est compromise ?
      // Le lien compte : « introuvable » et « trouvée mais révoquée » n'appellent
      // pas la même action de la part de l'exploitant.
      const rejet = etat.decouverte.rejetees.find((element) => element.nom === prise.nom)
      if (rejet) {
        rapport.autorisationManquante(prise.nom,
          'Une valeur existait (' + rejet.origine + ') mais a été écartée : ' + rejet.motif
          + '. Émettre un nouvel identifiant chez le fournisseur puis relancer.', null)
        continue
      }
      if (entree && entree.classification === 'external') {
        const fournisseur = /^(?:DATABASE_URL|DIRECT_URL)$/.test(prise.nom)
          ? { nom: 'Neon', commande: 'npm exec --package=neonctl@8.4.4 -- neonctl auth' }
          : /^UPSTASH_/.test(prise.nom)
            ? { nom: 'Upstash', commande: 'npm exec --package=upstash@1.5.0 -- upstash auth login' }
            : { nom: prise.nom, commande: null }
        rapport.autorisationManquante(fournisseur.nom, prise.nom + ' — ' + prise.raison, fournisseur.commande)
        continue
      }
      rapport.nonEffectue(prise.cible + ' / ' + prise.nom, prise.raison)
    }

    // État des services, indépendamment du plan.
    const valeursProduction = etat.snapshots.production ? etat.snapshots.production.valeurs : {}
    const smtp = fournisseurSmtp.verifier(valeursProduction)
    rapport.ligne(smtp.cle === 'presente-conforme' ? 'SUCCESS' : smtp.cle === 'absente' ? 'SKIPPED' : 'WARNING',
      'SMTP (chiffrement des identifiants)', smtp.consequence)
    for (const limite of fournisseurSmtp.limites()) rapport.info('        · ' + limite)
    rapport.donnees.fournisseurs.smtp = smtp

    const anthropic = await fournisseurAnthropic.verifier(
      { ...valeursProduction, ...Object.fromEntries((etat.decouverte.parNom.get('ANTHROPIC_API_KEY') || []).slice(0, 1).map((candidat) => ['ANTHROPIC_API_KEY', candidat.valeur])) },
      { verifierEnLigne: options.verifierAnthropic && !options.horsLigne })
    rapport.ligne(!anthropic.presente ? 'SKIPPED' : anthropic.forme.length ? 'WARNING' : anthropic.disponibilite === 'acceptee' ? 'SUCCESS' : 'WARNING',
      'Anthropic (clé d API)',
      !anthropic.presente
        ? anthropic.consequence
        : anthropic.forme.length
          ? anthropic.forme.join(' ')
          : anthropic.disponibilite === 'non-testee'
            ? 'Format conforme ; disponibilité NON testée (aucune requête vers un service tiers sans --verifier-anthropic).'
            : 'Disponibilité : ' + anthropic.disponibilite + (anthropic.httpStatus ? ' (HTTP ' + anthropic.httpStatus + ')' : ''))
    if (anthropic.copiloteActif) {
      rapport.ligne('WARNING', 'Copilote LLM', 'GARAGEFLOW_LLM vaut anthropic : les appels facturés sont actifs. Le configurateur ne modifie jamais ce réglage.')
    }
    rapport.donnees.fournisseurs.anthropic = { presente: anthropic.presente, forme: anthropic.forme, disponibilite: anthropic.disponibilite }

    const facturation = fournisseurEinvoicing.verifier(valeursProduction)
    rapport.ligne(facturation.emissionReellePossible ? 'BLOCKED' : 'SUCCESS', 'Facturation électronique',
      facturation.emissionReellePossible
        ? 'Configuration autorisant une émission réelle détectée : refusée par le configurateur.'
        : 'Désactivée et verrouillée en sandbox (état attendu). Aucune activation automatique.')
    for (const anomalie of facturation.anomalies) rapport.ligne('WARNING', 'Facturation électronique', anomalie)
    rapport.donnees.fournisseurs.einvoicing = facturation
  }
  rapport.cloturer()

  // ────────────────────────────── 13. Ressources accessibles : rattachements
  rapport.etape(13, 'Ressources accessibles : stockage et rattachements')
  if (!etat.projet || options.horsLigne) {
    rapport.ligne('SKIPPED', 'Stockage Blob', 'Projet Vercel non confirmé ou mode hors ligne.')
  } else {
    for (const cible of Object.keys(etat.snapshots)) {
      const snapshot = etat.snapshots[cible]
      const valeurs = { ...snapshot.valeurs, ...snapshot.aliasRessources }
      if (!valeurs.BLOB_READ_WRITE_TOKEN) {
        rapport.ligne('SKIPPED', 'Blob ' + cible, 'Aucun jeton Blob déclaré pour cet environnement ; aucun jeton inventé.')
        continue
      }
      const inventaire = await fournisseurStockage.inventaireBlob(racine, etat.clientVercel, etat.projet, cible, snapshot)
      const controle = fournisseurStockage.verifierBlob(racine, valeurs, { storeIds: inventaire.storeIds })
      rapport.ligne(controle.associe === true ? 'SUCCESS' : controle.compromis ? 'BLOCKED' : 'WARNING', 'Blob ' + cible,
        controle.compromis
          ? controle.anomalies[0]
          : controle.associe === true
            ? 'Jeton valide et store rattaché à ce projet pour cet environnement.'
            : controle.associe === false
              ? controle.anomalies[0]
              : controle.consequence + (inventaire.erreur ? ' (' + inventaire.erreur + ')' : ''))
      rapport.donnees.fournisseurs['blob-' + cible] = {
        present: controle.present, formeValide: controle.formeValide,
        associe: controle.associe, compromis: controle.compromis,
      }
    }
    const chemins = fournisseurStockage.verifierChemins(etat.snapshots.production ? etat.snapshots.production.valeurs : {}, { cibleVercel: true })
    for (const anomalie of chemins.anomalies) rapport.ligne('WARNING', 'Stockage fichier', anomalie)
    if (!chemins.anomalies.length) {
      rapport.ligne('SUCCESS', 'Stockage fichier', 'Aucun chemin de disque local déclaré pour un environnement Vercel (système de fichiers éphémère).')
    }
  }
  rapport.cloturer()

  // ─────────────────────────────────────── 14. Écriture des fichiers .env
  rapport.etape(14, 'Fichiers d environnement locaux')
  {
    const cibles = etat.ciblesEcrites
    const fichiers = cibles.map(fichierDeCible)
    const nonEcrites = etat.cibles.filter((cible) => !cibles.includes(cible))
    const horsSelection = new Set(etat.ciblesHorsSelection || [])
    for (const cible of nonEcrites) {
      // Deux raisons DIFFÉRENTES de ne pas écrire : hors de l'environnement
      // choisi, ou miroir local qu'aucun processus ne lit. Les confondre
      // laisserait croire qu'un oubli d'option explique une cible épargnée,
      // alors que c'est la sélection de l'opérateur qui la protège.
      if (horsSelection.has(cible)) {
        rapport.ligne('SKIPPED', fichierDeCible(cible),
          'Hors de l environnement sélectionné (' + String(options.environnement).toUpperCase()
          + ') : cette cible est analysée en lecture seule et n est pas modifiée.')
        continue
      }
      rapport.ligne('SKIPPED', fichierDeCible(cible),
        'Miroir local non créé pour la cible ' + cible + ' : ce fichier n est lu par aucun processus en l état, '
        + 'et le créer modifierait le comportement de npm run dev. Utiliser --fichiers-cloud pour l écrire.')
    }
    const securite = validateurDepot.verifier(racine, fichiers)
    etat.securiteDepot = securite
    rapport.donnees.securite = securite
    for (const anomalie of securite.anomalies) rapport.ligne('BLOCKED', 'Sûreté du dépôt', anomalie)
    for (const avertissement of securite.avertissements) rapport.ligne('WARNING', 'Sûreté du dépôt', avertissement)
    if (securite.ok) {
      rapport.ligne('SUCCESS', 'Sûreté du dépôt',
        'Destinations ignorées par Git, aucun fichier d exemple porteur de secret, aucun lien symbolique sur le chemin.')
    }

    if (!securite.ok && !options.forcerEcriture) {
      rapport.ligne('BLOCKED', 'Écriture des fichiers',
        'Anomalies de sûreté : aucune écriture. Corriger les points ci-dessus, ou relancer avec --forcer-ecriture en connaissance de cause.')
      rapport.cloturer('BLOCKED')
    } else {
      if (options.simulation) {
        rapport.ligne('SKIPPED', 'Écriture des fichiers', 'Mode simulation : contenu calculé, rien n est écrit.')
      }
      etat.sessionSauvegarde = backup.session(racine, contexte.executionId)
      for (const cible of cibles) {
        const relatif = fichierDeCible(cible)
        const valeurs = engine.valeursAEcrire(etat.plan.cibles[cible])
        if (!Object.keys(valeurs).length) {
          rapport.ligne('SKIPPED', relatif, 'Aucune valeur à inscrire pour la cible ' + cible + '.')
          continue
        }
        const avant = fsx.lireTexte(path.join(racine, relatif))
        const resultat = fichierEnv.appliquer(avant, valeurs, {
          entete: [
            'Généré par « configuation automatique » — SECRETS LOCAUX, ne jamais committer.',
            'Cible : ' + cible + ' (' + engine.CIBLES[cible].libelle + ').',
            'Les valeurs existantes sont conservées ; relancer le configurateur ne remplace aucun secret.',
          ],
        })

        // Contrôle de relecture : ce qui est écrit doit être relisible par
        // l'application elle-même, sinon on n'écrit rien.
        const noyau = require(path.join(racine, 'scripts/config-core.cjs'))
        const relu = noyau.parseEnv(resultat.texte)
        const incoherentes = Object.keys(valeurs).filter((nom) => relu[nom] !== valeurs[nom])
        if (incoherentes.length) {
          rapport.ligne('FAILED', relatif,
            'Le contenu calculé ne serait pas relu à l identique par l application (' + incoherentes.join(', ') + ') : écriture annulée.')
          continue
        }

        const inchange = avant !== null && resultat.texte === avant
        const details = []
        if (resultat.ajoutees.length) details.push(resultat.ajoutees.length + ' ajoutée(s)')
        if (resultat.modifiees.length) details.push(resultat.modifiees.length + ' modifiée(s)')
        if (resultat.inchangees.length) details.push(resultat.inchangees.length + ' inchangée(s)')
        if (resultat.decommentees.length) details.push(resultat.decommentees.length + ' déclaration(s) documentée(s) renseignée(s)')
        if (resultat.dedoublonnees.length) details.push('doublons neutralisés : ' + resultat.dedoublonnees.join(', '))
        if (resultat.reparees.length) details.push('valeurs mal formées réparées : ' + resultat.reparees.join(', '))

        if (inchange) {
          rapport.ligne('REUSED', relatif, 'Déjà conforme : aucune écriture (' + details.join(', ') + ').')
          rapport.donnees.fichiers.inchanges.push(relatif)
          continue
        }
        if (options.simulation) {
          rapport.ligne('SKIPPED', relatif, 'Simulation — modifications prévues : ' + details.join(', ') + '.')
          continue
        }

        const sauvegarde = etat.sessionSauvegarde.sauvegarder(relatif)
        fsx.ecrireAtomique(path.join(racine, relatif), resultat.texte, { mode: 0o600 })
        etat.sessionSauvegarde.noterEcriture(relatif, resultat.texte)
        etat.ecritures.push(relatif)
        rapport.donnees.fichiers.sauvegardes.push({ fichier: relatif, presentAvant: sauvegarde.present })
        if (sauvegarde.present) rapport.donnees.fichiers.modifies.push(relatif)
        else rapport.donnees.fichiers.crees.push(relatif)
        rapport.ligne('SUCCESS', relatif,
          (sauvegarde.present ? 'Mis à jour' : 'Créé') + ' après sauvegarde : ' + details.join(', ') + '.')

        const permissions = fsx.permissions(path.join(racine, relatif))
        rapport.ligne(permissions.lisibleParTous === true ? 'WARNING' : 'SUCCESS', relatif + ' (permissions)',
          permissions.modeSignificatif
            ? 'mode ' + permissions.mode + (permissions.lisibleParTous ? ' — lisible par tous, à restreindre' : ' — accès restreint au propriétaire')
            : 'Windows : les droits effectifs viennent des ACL NTFS du profil utilisateur ; le mode POSIX rapporté (' + permissions.mode + ') n est pas significatif.')
      }
      if (etat.sessionSauvegarde.entrees.length) {
        const index = etat.sessionSauvegarde.ecrireIndex({ executionId: contexte.executionId, cibles })
        rapport.ligne('SUCCESS', 'Sauvegardes', index.fichiers.length + ' fichier(s) sauvegardé(s) dans GarageFlow-configuration/sauvegardes/' + contexte.executionId + '/')
      }
      rapport.cloturer()
    }
  }

  // ───────────────────────────────── 15. Synchronisation vers Vercel
  rapport.etape(15, 'Synchronisation des variables autorisées vers Vercel')
  if (!etat.projet || options.horsLigne) {
    rapport.ligne('SKIPPED', 'Synchronisation', 'Projet Vercel non confirmé ou mode hors ligne : aucune mutation.')
  } else {
    const operations = construireOperations(etat, options)
    rapport.donnees.vercel.refusees = operations.refusees
    for (const refus of operations.refusees) {
      rapport.ligne(refus.statut, refus.cible + ' / ' + refus.nom, refus.raison)
    }
    if (!operations.aFaire.length) {
      rapport.ligne('SUCCESS', 'Synchronisation',
        'Aucune opération nécessaire : toutes les variables requises existent déjà dans les environnements visés.')
    }
    for (const operation of operations.aFaire) {
      if (options.simulation) {
        rapport.ligne('SKIPPED', operation.cible + ' / ' + operation.nom,
          'Simulation — opération prévue : ' + operation.genre + ' (type ' + operation.type + ').')
        continue
      }
      try {
        await etat.clientVercel.ecrire(etat.projet, operation.cible, {
          genre: operation.genre,
          cle: operation.nom,
          valeur: operation.valeur,
          type: operation.type,
          marque: operation.marque,
          enregistrement: operation.enregistrement,
        })
        etat.mutations = etat.mutations || []
        etat.mutations.push(operation)
        rapport.donnees.vercel.synchronisations.push({
          nom: operation.nom, cible: operation.cible, genre: operation.genre, type: operation.type,
          empreinte: redact.empreinteCourte(operation.valeur),
        })
        rapport.ligne('SYNCHRONIZED', operation.cible + ' / ' + operation.nom,
          operation.genre === 'creer' ? 'Variable créée (type ' + operation.type + ').' : 'Variable mise à jour (type ' + operation.type + ').')
      } catch (erreur) {
        rapport.erreur('synchronisation-' + operation.nom, erreur)
        rapport.ligne('FAILED', operation.cible + ' / ' + operation.nom,
          'Écriture refusée : ' + redact.nettoyer(erreur.message))
      }
    }

    // Sonde d'écriture : prouve la capacité réelle sans toucher à une variable
    // applicative. Hors simulation et sur demande explicite seulement.
    if (options.sondeVercel && !options.simulation) {
      const sonde = await etat.clientVercel.sonder(etat.projet, 'development')
      etat.sondes.vercelEcriture = sonde
      const reussie = sonde.creee && sonde.relue && sonde.retiree && sonde.nettoyageVerifie
      rapport.ligne(reussie ? 'SUCCESS' : 'FAILED', 'Sonde d écriture Vercel (development)',
        reussie
          ? 'Création, relecture et retrait vérifiés sur une variable de sonde dédiée : la synchronisation fonctionne réellement.'
          : 'Sonde incomplète — créée=' + sonde.creee + ', relue=' + sonde.relue + ', retirée=' + sonde.retiree
            + ', nettoyage vérifié=' + sonde.nettoyageVerifie + (sonde.erreur ? ' (' + sonde.erreur + ')' : ''))
      rapport.donnees.vercel.sonde = sonde
    }
  }
  rapport.cloturer()

  // ─────────────────────────────────── 16. Vérification des variables distantes
  rapport.etape(16, 'Vérification des variables distantes après synchronisation')
  if (!etat.projet || options.horsLigne) {
    rapport.ligne('SKIPPED', 'Relecture Vercel', 'Projet non confirmé ou mode hors ligne.')
  } else if (options.simulation) {
    rapport.ligne('SKIPPED', 'Relecture Vercel', 'Mode simulation : aucune mutation, donc rien à vérifier.')
  } else if (!etat.mutations || !etat.mutations.length) {
    // Même sans mutation, on reconfirme la présence des variables requises :
    // c'est la vérification qui compte pour un déploiement.
    let complet = true
    for (const [cible, snapshot] of Object.entries(etat.snapshots)) {
      const requises = etat.unifie.entrees
        .filter((entree) => entree.destination.cibles.includes(cible) && entree.requiredProduction)
        .map((entree) => entree.name)
      const manquantes = requises.filter((nom) => !snapshot.presentes.has(nom))
      if (manquantes.length) complet = false
      rapport.ligne(manquantes.length ? 'BLOCKED' : 'SUCCESS', 'Requises dans ' + cible,
        manquantes.length
          ? manquantes.length + ' absente(s) : ' + manquantes.join(', ')
          : requises.length + ' variable(s) requise(s) présente(s) sous leur nom canonique.')
    }
    if (complet) rapport.ligne('SUCCESS', 'Contrat de déploiement', 'Toutes les variables requises existent dans les environnements visés.')
  } else {
    for (const cible of [...new Set(etat.mutations.map((operation) => operation.cible))]) {
      try {
        const relu = await etat.clientVercel.lire(etat.projet, cible)
        etat.snapshots[cible] = relu
        for (const operation of etat.mutations.filter((element) => element.cible === cible)) {
          const presente = relu.presentes.has(operation.nom)
          const valeurEgale = relu.valeurs[operation.nom] === operation.valeur
          const confirme = presente && (valeurEgale || relu.cachees.has(operation.nom))
          rapport.ligne(confirme ? 'SUCCESS' : 'FAILED', cible + ' / ' + operation.nom,
            !presente
              ? 'Variable absente après écriture : opération non confirmée.'
              : valeurEgale
                ? 'Présence ET valeur confirmées par relecture.'
                : 'Présence confirmée ; valeur non relisible (Sensitive) — la métadonnée atteste l écriture, pas le contenu.')
        }
      } catch (erreur) {
        rapport.erreur('relecture-' + cible, erreur)
        rapport.ligne('FAILED', 'Relecture ' + cible, redact.nettoyer(erreur.message))
      }
    }
  }
  rapport.cloturer()

  // ────────────────────────────────────────── 17. Vérification des connexions
  rapport.etape(17, 'Connexions réelles aux services')
  if (options.horsLigne) {
    rapport.ligne('SKIPPED', 'Connexions', 'Mode hors ligne : aucune connexion tentée. Aucun SUCCESS revendiqué.')
  } else {
    for (const cible of etat.cibles) {
      if (cible === 'desktop') continue
      const valeurs = { ...engine.valeursAEcrire(etat.plan.cibles[cible]) }
      const snapshot = etat.snapshots[cible]
      if (snapshot) {
        for (const [nom, valeur] of Object.entries({ ...snapshot.aliasRessources, ...snapshot.valeurs })) {
          if (valeur && !valeurs[nom]) valeurs[nom] = valeur
        }
      }
      if (valeurs.DATABASE_URL && valeurs.DIRECT_URL) {
        const sonde = await fournisseurPostgres.sonder(racine, valeurs)
        etat.sondes['postgres-' + cible] = sonde
        const resume = {
          cible, service: 'postgresql', poolee: sonde.poolee, directe: sonde.directe,
          vide: sonde.vide, tables: sonde.tables, hote: sonde.resumePoolee ? sonde.resumePoolee.hote : null,
        }
        rapport.donnees.connexions.push(resume)
        rapport.ligne(sonde.poolee && sonde.directe ? 'SUCCESS' : 'FAILED', 'PostgreSQL ' + cible,
          sonde.poolee && sonde.directe
            ? 'Connexions poolée et directe confirmées (' + resume.hote + ', '
              + (sonde.vide === null ? 'contenu non inspecté' : sonde.vide ? 'base sans donnée métier' : sonde.tables + ' tables avec données') + ').'
            : 'Connexion non confirmée : ' + (sonde.erreur || 'cause indéterminée') + '. Aucun secret généré en remplacement.')
        for (const probleme of sonde.forme) rapport.ligne('WARNING', 'PostgreSQL ' + cible + ' (forme)', probleme)
      } else {
        rapport.ligne('SKIPPED', 'PostgreSQL ' + cible,
          'URL poolée et/ou directe non relisible depuis ce poste : connexion non testée (aucune conclusion sur son état).')
      }

      if (valeurs.UPSTASH_REDIS_REST_URL && valeurs.UPSTASH_REDIS_REST_TOKEN) {
        const sonde = await fournisseurUpstash.sonder(racine, valeurs)
        etat.sondes['redis-' + cible] = sonde
        rapport.donnees.connexions.push({ cible, service: 'upstash-redis', joignable: sonde.joignable, latenceMs: sonde.latenceMs, hote: sonde.hote })
        rapport.ligne(sonde.joignable ? 'SUCCESS' : 'FAILED', 'Redis ' + cible,
          sonde.joignable
            ? 'PING REST confirmé (' + sonde.hote + ', ' + sonde.latenceMs + ' ms).'
            : 'PING non confirmé : ' + (sonde.erreur || 'cause indéterminée') + '. Le limiteur de débit refuserait les routes critiques.')
      } else {
        rapport.ligne('SKIPPED', 'Redis ' + cible, 'Identifiants Upstash non relisibles depuis ce poste : PING non tenté.')
      }
    }

    // Base locale du poste : SQLite desktop.
    const valeursDesktop = etat.plan.cibles.desktop ? engine.valeursAEcrire(etat.plan.cibles.desktop) : {}
    if (valeursDesktop.DATABASE_URL && valeursDesktop.DATABASE_URL.startsWith('file:')) {
      try {
        const services = require(path.join(racine, 'scripts/config-services.cjs'))
        const inspection = await services.inspectDesktop(racine, valeursDesktop.DATABASE_URL)
        rapport.donnees.connexions.push({ cible: 'desktop', service: 'sqlite', tables: inspection.tableCount, vide: inspection.empty })
        rapport.ligne('SUCCESS', 'SQLite desktop',
          inspection.tableCount + ' tables' + (inspection.empty ? ', aucune donnée métier' : ', données présentes')
          + ' — base locale conservée telle quelle.')
      } catch (erreur) {
        rapport.ligne('WARNING', 'SQLite desktop', 'Inspection impossible : ' + redact.nettoyer(erreur.message))
      }
    }
  }
  rapport.cloturer()

  // ──────────────────────────────────────────────────── 18. Vérifier Prisma
  rapport.etape(18, 'Schémas Prisma')
  {
    const prismaCli = path.join(racine, 'node_modules/prisma/build/index.js')
    if (!fs.existsSync(prismaCli)) {
      rapport.ligne('SKIPPED', 'Prisma', 'CLI absent : validation non effectuée (npm ci).')
    } else {
      for (const [libelle, schema, urlFactice] of [
        ['Schéma desktop (SQLite)', 'prisma/schema.prisma', 'file:./dev.db'],
        ['Schéma serveur (PostgreSQL)', 'prisma/server/schema.prisma', 'postgresql://utilisateur:motdepasse@127.0.0.1:5432/validation'],
      ]) {
        try {
          // `prisma validate` exige que les variables du bloc datasource soient
          // définies, même pour une validation purement statique. On passe donc
          // une valeur de forme correcte, jamais un identifiant réel.
          const resultat = await exec.lancer(process.execPath, [prismaCli, 'validate', '--schema', schema], {
            cwd: racine,
            delaiMs: 120000,
            captureStderr: true,
            libelle: 'prisma validate',
            env: { ...process.env, DATABASE_URL: urlFactice, DIRECT_URL: urlFactice },
          })
          rapport.ligne(resultat.code === 0 ? 'SUCCESS' : 'FAILED', libelle,
            resultat.code === 0 ? 'Schéma valide.' : 'Validation en échec (code ' + resultat.code + ').')
        } catch (erreur) {
          rapport.ligne('WARNING', libelle, 'Validation non effectuée : ' + redact.nettoyer(erreur.message))
        }
      }
      const clientServeur = fs.existsSync(path.join(racine, 'src/generated/server-client/index.js'))
      rapport.ligne(clientServeur ? 'SUCCESS' : 'WARNING', 'Client Prisma PostgreSQL',
        clientServeur ? 'Généré et chargeable (sondes de connexion possibles).' : 'Absent : npm run db:server:generate.')
    }
  }
  rapport.cloturer()

  // ───────────────────────── 19. Cohérence entre environnements et contrats
  rapport.etape(19, 'Cohérence entre environnements')
  {
    const coherence = validateurEnvironnements.verifier(racine, etat.unifie, etat.snapshots, {})
    etat.coherence = coherence
    rapport.donnees.coherence = coherence
    for (const anomalie of coherence.anomalies) rapport.ligne('BLOCKED', 'Cohérence', anomalie)
    for (const avertissement of coherence.avertissements) rapport.ligne('WARNING', 'Cohérence', avertissement)
    if (coherence.isolationPreview.conclusion === 'respectée') {
      rapport.ligne('SUCCESS', 'Isolation Preview', coherence.isolationPreview.detail)
    } else if (coherence.isolationPreview.conclusion !== 'non vérifiée') {
      rapport.ligne(coherence.isolationPreview.conclusion === 'VIOLÉE' ? 'BLOCKED' : 'WARNING',
        'Isolation Preview', coherence.isolationPreview.detail)
    }
    if (coherence.inconnuesDuContrat.length) {
      const parProtection = coherence.inconnuesDuContrat.filter((element) => !element.protegee)
      rapport.ligne(parProtection.length ? 'WARNING' : 'SUCCESS', 'Variables inconnues du contrat',
        coherence.inconnuesDuContrat.length + ' variable(s) présentes chez Vercel hors manifeste, dont '
        + (coherence.inconnuesDuContrat.length - parProtection.length) + ' fournies par une intégration. Aucune suppression automatique.')
    }

    // Validation finale des valeurs par cible, avec la validation du dépôt.
    for (const cible of etat.cibles) {
      const valeurs = engine.valeursAEcrire(etat.plan.cibles[cible])
      const geres = etat.plan.cibles[cible].decisions
        .filter((prise) => prise.statut !== 'SKIPPED')
        .map((prise) => prise.nom)
      const environnement = engine.CIBLES[cible].vercel
      const snapshotCible = environnement ? etat.snapshots[environnement] : null
      const presentsNonRelisibles = snapshotCible ? [...snapshotCible.cachees] : []
      const validation = validateurVariables.valider(racine, valeurs, cible)
      const pertinentes = validateurVariables.erreursPertinentes(validation.erreurs, geres, { presentsNonRelisibles })
      rapport.ligne(pertinentes.length ? 'WARNING' : 'SUCCESS', 'Validation ' + cible + ' (profil ' + validation.profil + ')',
        pertinentes.length
          ? pertinentes.length + ' remarque(s) sur les variables gérées'
          : Object.keys(valeurs).length + ' valeur(s) vérifiables conformes aux règles du dépôt (config-core.validate)'
            + (presentsNonRelisibles.length
              ? ' ; ' + presentsNonRelisibles.length + ' variable(s) présentes chez Vercel mais protégées en lecture, dont le format ne peut pas être contrôlé d ici.'
              : '.'))
      for (const message of pertinentes) rapport.ligne('WARNING', cible, message)
      if (validation.vides.length) {
        rapport.ligne('WARNING', cible, 'Variables déclarées mais vides : ' + validation.vides.join(', '))
      }
    }
  }
  rapport.cloturer()

  return etat
}

/**
 * Construit les opérations Vercel autorisées.
 *
 * Deux principes :
 *   · on CRÉE ce qui manque et qui est requis par la politique ;
 *   · on ne REMPLACE rien sans autorisation explicite — une variable existante
 *     peut porter une valeur dont dépendent des données déjà écrites, et son
 *     remplacement est une rotation.
 */
function construireOperations(etat, options) {
  const crypto = require('node:crypto')
  const aFaire = []
  const refusees = []

  // L'environnement sélectionné borne les MUTATIONS distantes exactement comme
  // il borne les écritures locales. Une cible hors sélection reste lue (son
  // instantané sert aux contrôles d'isolation) mais n'est jamais mutée, et le
  // rapport dit pourquoi — une ligne silencieusement absente se lirait comme
  // « rien à faire ».
  const selectionActive = Array.isArray(options.ciblesEcriture)
  const autoriseesEcriture = selectionActive ? new Set(options.ciblesEcriture) : null

  for (const cible of etat.cibles) {
    const environnement = engine.CIBLES[cible].vercel
    if (!environnement) continue
    const snapshot = etat.snapshots[environnement]
    if (!snapshot) continue
    if (selectionActive && !autoriseesEcriture.has(cible)) {
      refusees.push({
        statut: 'SKIPPED',
        cible,
        nom: '(toutes les variables)',
        raison: 'Hors de l environnement sélectionné (' + String(options.environnement).toUpperCase()
          + ') : variables lues pour les contrôles, aucune synchronisation.',
      })
      continue
    }

    for (const prise of etat.plan.cibles[cible].decisions) {
      const entree = etat.unifie.parNom.get(prise.nom)
      if (!entree || !entree.destination.cibles.includes(environnement)) continue
      if (!prise.valeur) continue

      const enregistrement = snapshot.enregistrements.find((record) => record.key === prise.nom)
      const nuage = require(path.join(etat.unifie.racine, 'scripts/lib/config-cloud.cjs'))

      // Rien à faire : la valeur distante est relisible et déjà identique. On
      // teste cette égalité AVANT les règles de refus, sinon une variable
      // parfaitement configurée serait signalée comme « non modifiable ».
      if (enregistrement && snapshot.valeurs[prise.nom] === prise.valeur) continue

      if (enregistrement && nuage.protectedRecord(enregistrement, [...etat.unifie.plateforme])) {
        refusees.push({
          nom: prise.nom, cible: environnement, statut: 'SKIPPED',
          raison: 'Détenue par une intégration Marketplace ou par la plateforme : modification refusée (le rattachement du service en dépend).',
        })
        continue
      }
      if (enregistrement && nuage.targets(enregistrement).length !== 1) {
        refusees.push({
          nom: prise.nom, cible: environnement, statut: 'SKIPPED',
          raison: 'Variable partagée entre plusieurs environnements : la scinder est une décision manuelle.',
        })
        continue
      }

      const type = require(path.join(etat.unifie.racine, 'scripts/config-core.cjs')).isSecret(prise.nom) ? 'encrypted' : 'plain'

      if (!enregistrement) {
        aFaire.push({
          genre: 'creer', nom: prise.nom, cible: environnement, valeur: prise.valeur, type,
          marque: 'GarageFlows configurateur ' + crypto.randomUUID(),
        })
        continue
      }

      // La variable existe. Si sa valeur est relisible et identique, rien à faire.
      const valeurDistante = snapshot.valeurs[prise.nom]
      if (valeurDistante === prise.valeur) continue
      if (snapshot.cachees.has(prise.nom)) {
        refusees.push({
          nom: prise.nom, cible: environnement, statut: 'SKIPPED',
          raison: 'Présente mais non relisible (Sensitive) : impossible de savoir si la valeur diffère. Aucun remplacement à l aveugle.',
        })
        continue
      }
      const risque = entree.rotationRisk || 'inconnu'
      if (!options.autoriserRemplacementVercel) {
        refusees.push({
          nom: prise.nom, cible: environnement, statut: 'WARNING',
          raison: 'Valeur distante différente de la valeur locale. Remplacement non effectué (risque de rotation : ' + risque
            + '). Autoriser explicitement avec --autoriser-remplacement-vercel après avoir vérifié l impact.',
        })
        continue
      }
      if (engine.RISQUES_INTOUCHABLES.has(risque)) {
        refusees.push({
          nom: prise.nom, cible: environnement, statut: 'BLOCKED',
          raison: 'Remplacement refusé même avec autorisation : rotation classée ' + risque
            + ', elle exige une migration des données protégées et une fenêtre de bascule.',
        })
        continue
      }
      aFaire.push({ genre: 'remplacer', nom: prise.nom, cible: environnement, valeur: prise.valeur, type, enregistrement })
    }
  }

  return { aFaire, refusees }
}

module.exports = { executer, construireOperations, CIBLES_ANALYSE, fichierDeCible }
