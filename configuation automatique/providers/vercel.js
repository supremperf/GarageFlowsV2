'use strict'
/**
 * FOURNISSEUR VERCEL — détection, lecture, synchronisation.
 *
 * Ce module ne réinvente pas l'accès à l'API : il réutilise les briques déjà
 * durcies du dépôt, parce qu'elles portent des protections qu'il serait absurde
 * de réécrire (et risqué de réécrire moins bien) :
 *
 *   · `scripts/lib/config-vercel-api.cjs` — décodage d'une réponse
 *     `vercel api --include --raw` et classification d'un échec en étiquettes
 *     fixes, sans jamais conserver la sortie brute du fournisseur (qui peut
 *     contenir un en-tête d'authentification) ;
 *   · `scripts/lib/config-vercel-env.cjs` — distinction entre « valeur
 *     relisible » et « métadonnée de protection » : une variable Sensitive
 *     renvoie une chaîne vide, et la confondre avec une absence conduirait à
 *     régénérer un secret de production ;
 *   · `scripts/lib/config-cloud.cjs` — inventaire par cible, refus des
 *     doublons et des paginations incomplètes, et surtout `protectedRecord()`,
 *     qui identifie les variables appartenant à une intégration Marketplace
 *     (Neon, Upstash). Y toucher casserait le lien du projet avec le service.
 *
 * Deux appels suffisent par environnement : l'inventaire, puis la lecture
 * groupée. Interroger chaque variable séparément, comme le fait l'assistant
 * interactif, prendrait plusieurs minutes pour les trois environnements.
 */

const fs = require('node:fs')
const path = require('node:path')

const exec = require('../utils/exec.js')
const redact = require('../security/redact.js')

const VERSION_EPINGLEE = 'vercel@64.0.2'
const MAJEURE_ATTENDUE = 64
const CIBLES = ['development', 'preview', 'production']

/**
 * Crée un client Vercel.
 *
 * @param {string} racine racine du dépôt
 * @param {{ delaiMs?: number, cliEpingle?: boolean }} options
 */
function client(racine, options = {}) {
  const codec = require(path.join(racine, 'scripts/lib/config-vercel-api.cjs'))
  const decodeur = require(path.join(racine, 'scripts/lib/config-vercel-env.cjs'))
  const nuage = require(path.join(racine, 'scripts/lib/config-cloud.cjs'))
  const delaiMs = options.delaiMs || 180000

  let invocation = null
  let versionUtilisee = null

  /** Choisit comment lancer le CLI : binaire global compatible, sinon version épinglée. */
  async function preparer() {
    if (invocation) return invocation
    const global = await exec.version('vercel', ['--version'], /(\d+\.\d+\.\d+)/)
    const majeure = global.version ? Number(global.version.split('.')[0]) : null
    if (global.present && majeure === MAJEURE_ATTENDUE && !options.cliEpingle) {
      versionUtilisee = { source: 'cli-global', version: global.version }
      invocation = (args, parametres) => exec.lancer('vercel', args, { cwd: racine, delaiMs, ...parametres })
      return invocation
    }
    // Pas de binaire compatible : on passe par la version ÉPINGLÉE du dépôt.
    // Jamais une version « la plus récente » : un changement de format de
    // sortie transformerait une lecture en fausse absence de variable.
    versionUtilisee = { source: 'npm-exec', version: VERSION_EPINGLEE, cliGlobal: global.version }
    const npm = exec.npmCli()
    invocation = (args, parametres) => exec.lancer(process.execPath,
      [npm, 'exec', '--yes', '--package=' + VERSION_EPINGLEE, '--', 'vercel', ...args],
      { cwd: racine, delaiMs, ...parametres })
    return invocation
  }

  /** Lance une commande Vercel et rend sa sortie standard. */
  async function commande(args, parametres = {}) {
    const lancer = await preparer()
    const resultat = await lancer(args, { captureStderr: true, libelle: 'vercel', ...parametres })
    if (resultat.code !== 0) {
      const erreur = new Error('Vercel : commande refusée (détails filtrés).')
      erreur.vercelApi = codec.commandFailure(resultat.stdout, resultat.stderr, resultat.code)
      throw erreur
    }
    return resultat.stdout
  }

  /** Appel API authentifié, décodé par le codec durci du dépôt. */
  async function appel(route, parametres = {}) {
    const sortie = await commande(['api', route, '--include', '--raw'], parametres)
    return codec.decode(sortie)
  }

  const requete = (projet, chemin, requeteUrl = {}) =>
    chemin + '?' + new URLSearchParams({ teamId: projet.orgId, ...requeteUrl }).toString()

  /** Projet lié par `vercel link`, validé avant tout appel. */
  function projetLie() {
    let brut
    try {
      brut = JSON.parse(fs.readFileSync(path.join(racine, '.vercel/project.json'), 'utf8'))
    } catch {
      return null
    }
    if (!/^prj_[A-Za-z0-9_-]+$/.test(brut.projectId || '')) return null
    if (!/^(?:team_|user_)[A-Za-z0-9_-]+$/.test(brut.orgId || '')) return null
    return { projectId: brut.projectId, orgId: brut.orgId, projectName: brut.projectName || null }
  }

  /**
   * Détection complète, sans aucune mutation ni connexion interactive.
   *
   * Un `vercel login` n'est jamais déclenché : une commande qui attend une
   * saisie dans un configurateur automatique bloquerait indéfiniment.
   */
  async function detecter() {
    const etat = {
      cli: null,
      session: false,
      compte: null,
      projet: null,
      identiteConfirmee: false,
      equipe: null,
      environnements: [],
      blocage: null,
    }
    await preparer()
    etat.cli = versionUtilisee
    if (versionUtilisee.source === 'npm-exec' && !versionUtilisee.cliGlobal) {
      etat.installationPossible = true
    }

    try {
      const sortie = await commande(['whoami'])
      const lignes = sortie.split(/\r?\n/).map((ligne) => ligne.trim()).filter(Boolean)
      etat.compte = lignes[lignes.length - 1] || null
      etat.session = !!etat.compte
    } catch (erreur) {
      etat.blocage = 'session-absente'
      etat.echec = erreur.vercelApi || null
      return etat
    }

    const projet = projetLie()
    if (!projet) {
      etat.blocage = 'projet-non-lie'
      return etat
    }
    etat.projet = projet

    try {
      const confirme = await appel(requete(projet, '/v9/projects/' + encodeURIComponent(projet.projectId)))
      etat.identiteConfirmee = confirme.id === projet.projectId && confirme.accountId === projet.orgId
      etat.equipe = confirme.accountId || null
      etat.nomProjet = typeof confirme.name === 'string' ? confirme.name : null
      if (!etat.identiteConfirmee) etat.blocage = 'identite-non-confirmee'
    } catch (erreur) {
      etat.blocage = 'projet-inaccessible'
      etat.echec = erreur.vercelApi || null
    }
    return etat
  }

  /**
   * Lit un environnement : inventaire des noms et métadonnées, puis valeurs
   * réellement relisibles.
   *
   * @returns {{ cible, enregistrements, presentes:Set, valeurs, cachees:Set,
   *             protegees:Set, surchargesBranche:number, lecture:string }}
   */
  async function lire(projet, cible) {
    if (!CIBLES.includes(cible)) throw new Error('Environnement Vercel inconnu : ' + cible)
    const inventaire = await appel(requete(projet, '/v10/projects/' + encodeURIComponent(projet.projectId) + '/env',
      { target: cible, source: 'vercel-cli:env:pull' }))
    if (inventaire.pagination && inventaire.pagination.next) {
      throw new Error('Vercel : inventaire paginé incomplet pour ' + cible + ' ; aucune décision prise sur cet environnement.')
    }
    const tous = Array.isArray(inventaire.envs) ? inventaire.envs : []
    const enregistrements = nuage.recordsFor(tous, cible)
    const surchargesBranche = tous.filter((record) => nuage.targets(record).includes(cible)
      && (record.gitBranch || (record.customEnvironmentIds && record.customEnvironmentIds.length))).length

    let brutes = {}
    let lecture = 'indisponible'
    try {
      const corps = await appel(requete(projet, '/v3/env/pull/' + encodeURIComponent(projet.projectId) + '/' + cible,
        { source: 'vercel-cli:env:pull' }))
      if (corps.env && !Array.isArray(corps.env) && typeof corps.env === 'object') {
        // Ne jamais importer une valeur hors de cet inventaire : une surcharge
        // de branche n'appartient pas à l'environnement qu'on configure.
        for (const record of enregistrements) {
          if (decodeur.readable(corps.env[record.key])) brutes[record.key] = corps.env[record.key]
        }
        lecture = 'lue'
      }
    } catch {
      // Une lecture groupée refusée ne prouve rien sur l'existence des valeurs :
      // l'inventaire reste exploitable, les valeurs restent « cachées ».
      lecture = 'refusee'
    }

    const etat = decodeur.fromPull(enregistrements, brutes)
    // `resourceAliases` complète les noms canoniques depuis les variables d'une
    // intégration du même store (POSTGRES_URL_NON_POOLING → DIRECT_URL,
    // KV_REST_API_* → UPSTASH_*). C'est précieux pour DÉCOUVRIR une ressource,
    // mais ce n'est pas la valeur de l'enregistrement canonique : en Preview,
    // `DIRECT_URL` existe en Sensitive ET un alias d'intégration porte une URL
    // du même store. Les confondre ferait croire la valeur relisible — et
    // conclure « identique » ou « divergente » sans pouvoir le vérifier.
    const avecAlias = nuage.resourceAliases(enregistrements, etat.values)
    const valeurs = {}
    const aliasRessources = {}
    for (const [nom, valeur] of Object.entries(avecAlias)) {
      if (etat.hidden.has(nom)) aliasRessources[nom] = valeur
      else valeurs[nom] = valeur
    }
    // Masquage sélectif : un secret est masqué, un nom d'hôte ne l'est pas.
    // `PGHOST` vaut littéralement le nom d'hôte de la base ; l'enregistrer
    // comme valeur sensible masquerait ce même hôte partout ailleurs, y compris
    // dans le résultat d'une sonde de connexion — et un rapport qui annonce
    // « [valeur masquée] a répondu » ne vaut rien pour diagnostiquer.
    redact.enregistrerTout(valeurs)
    redact.enregistrerTout(aliasRessources)

    const protegees = new Set(enregistrements
      .filter((record) => nuage.protectedRecord(record))
      .map((record) => record.key))

    return {
      cible,
      enregistrements,
      presentes: etat.present,
      valeurs,
      aliasRessources,
      cachees: etat.hidden,
      protegees,
      empreintes: etat.stamps,
      surchargesBranche,
      lecture,
    }
  }

  /**
   * Applique UNE opération sur UN environnement.
   *
   * Les garde-fous sont volontairement redondants avec ceux de
   * `config-cloud.write` : cette fonction est le seul endroit du configurateur
   * qui modifie un projet en production.
   */
  async function ecrire(projet, cible, operation) {
    if (!CIBLES.includes(cible)) throw new Error('Environnement Vercel inconnu : ' + cible)
    if (!nuage.validName(operation.cle)) throw new Error('Nom de variable refusé par la validation Vercel.')
    if (operation.enregistrement && nuage.protectedRecord(operation.enregistrement)) {
      throw new Error(operation.cle + ' : variable détenue par une intégration ou par la plateforme ; modification refusée.')
    }

    const prefixe = '/v10/projects/' + encodeURIComponent(projet.projectId) + '/env'
    let methode
    let chemin
    let corps = null

    if (operation.genre === 'creer') {
      methode = 'POST'
      chemin = prefixe
      corps = {
        key: operation.cle,
        value: operation.valeur,
        type: operation.type || 'encrypted',
        target: [cible],
        comment: operation.marque,
      }
    } else if (operation.genre === 'remplacer' || operation.genre === 'supprimer') {
      const enregistrement = operation.enregistrement
      const ciblesRecord = enregistrement ? nuage.targets(enregistrement) : []
      if (!enregistrement || !enregistrement.id || ciblesRecord.length !== 1 || ciblesRecord[0] !== cible
        || enregistrement.gitBranch || (enregistrement.customEnvironmentIds && enregistrement.customEnvironmentIds.length)) {
        throw new Error(operation.cle + ' : variable partagée entre plusieurs environnements ou liée à une branche ; mutation refusée.')
      }
      if (operation.genre === 'supprimer') {
        // Une suppression n'est permise que sur une variable dont le
        // configurateur prouve la paternité : la marque de propriété écrite au
        // moment de la création. Sans elle, supprimer reviendrait à détruire la
        // configuration de quelqu'un d'autre.
        if (!operation.marque || enregistrement.comment !== operation.marque) {
          throw new Error(operation.cle + ' : suppression refusée — marque de propriété du configurateur absente ou différente.')
        }
        methode = 'DELETE'
        chemin = prefixe + '/' + encodeURIComponent(enregistrement.id)
      } else {
        methode = 'PATCH'
        chemin = prefixe + '/' + encodeURIComponent(enregistrement.id)
        corps = { key: operation.cle, value: operation.valeur, type: operation.type || 'encrypted', target: [cible] }
      }
    } else {
      throw new Error('Opération Vercel non autorisée : ' + operation.genre)
    }

    // La valeur part dans un FICHIER privé temporaire, jamais dans argv : la
    // ligne de commande d'un processus est lisible par les autres processus de
    // la session Windows.
    if (!corps) {
      // Une requête DELETE n'a pas de corps : le CLI exige alors de confirmer
      // explicitement l'absence d'invite. Le plan a déjà été autorisé, et la
      // paternité de la variable vient d'être vérifiée ci-dessus.
      const sortie = await commande(['api', requete(projet, chemin), '--method', methode, '--raw', '--dangerously-skip-permissions'])
      if (sortie.trim()) codec.decode(sortie)
      return
    }

    const dossier = path.join(racine, 'GarageFlow-configuration')
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 })
    const temporaire = fs.mkdtempSync(path.join(dossier, 'api-'))
    try {
      try { fs.chmodSync(temporaire, 0o700) } catch { /* Windows : ACL du profil */ }
      const fichier = path.join(temporaire, 'body.json')
      require('../utils/fsx.js').ecrireAtomique(fichier, JSON.stringify(corps), { mode: 0o600 })
      const sortie = await commande(['api', requete(projet, chemin), '--method', methode, '--raw', '--input', fichier])
      if (sortie.trim()) codec.decode(sortie)
    } finally {
      fs.rmSync(temporaire, { recursive: true, force: true })
    }
  }

  /**
   * SONDE D'ÉCRITURE — prouve la capacité réelle de synchronisation sans
   * toucher à une variable applicative.
   *
   * Créer, relire, puis retirer une variable dédiée est le seul moyen honnête
   * de rapporter « la synchronisation fonctionne » : vérifier des droits
   * déclarés n'engage à rien, et écrire une vraie variable pour tester en
   * engagerait beaucoup trop. La sonde porte un nom réservé, une valeur non
   * secrète, et une marque de propriété qui conditionne sa suppression.
   */
  async function sonder(projet, cible, { nom = 'GF_CONFIG_PROBE' } = {}) {
    const crypto = require('node:crypto')
    const marque = 'GarageFlows configurateur sonde ' + crypto.randomUUID()
    const valeur = 'sonde-' + crypto.randomBytes(8).toString('hex')
    const resultat = { nom, cible, creee: false, relue: false, retiree: false, nettoyageVerifie: false, erreur: null }

    const avant = await lire(projet, cible)
    if (avant.presentes.has(nom)) {
      resultat.erreur = nom + ' existe déjà dans ' + cible + ' : sonde annulée pour ne rien écraser.'
      return resultat
    }
    try {
      await ecrire(projet, cible, { genre: 'creer', cle: nom, valeur, type: 'plain', marque })
      resultat.creee = true
      const apres = await lire(projet, cible)
      resultat.relue = apres.valeurs[nom] === valeur
      const enregistrement = apres.enregistrements.find((record) => record.key === nom)
      if (enregistrement) {
        await ecrire(projet, cible, { genre: 'supprimer', cle: nom, enregistrement, marque })
        resultat.retiree = true
      }
    } catch (erreur) {
      resultat.erreur = erreur.message
    }
    try {
      const final = await lire(projet, cible)
      resultat.nettoyageVerifie = !final.presentes.has(nom)
    } catch {
      resultat.nettoyageVerifie = false
    }
    return resultat
  }

  /**
   * INVENTAIRE DES RESSOURCES DE L'ÉQUIPE — sans aucun CLI de fournisseur.
   *
   * POURQUOI. L'inventaire Neon passait par `neonctl`, et l'inventaire Upstash
   * par le CLI Upstash. Sans ces outils — ou sans session sur chacun — le
   * rapport annonçait « inventaire non effectué » et renvoyait l'opérateur
   * installer puis authentifier deux CLI de plus, pour une information que la
   * session Vercel DÉJÀ en place suffit à donner.
   *
   * Les bases Neon et les instances Upstash de ce projet sont provisionnées par
   * l'intégration Marketplace de Vercel : `/v1/storage/stores` les liste avec
   * leur produit, leur état de facturation, les projets connectés et les
   * ENVIRONNEMENTS auxquels chacune est rattachée. C'est précisément ce qu'il
   * faut pour savoir quelle ressource sert Production, laquelle sert Preview,
   * et lesquelles ne servent plus à rien.
   *
   * Aucune valeur de connexion ne transite : l'API expose les NOMS des secrets
   * et leur longueur, jamais leur contenu. Rien n'est créé, rien n'est muté.
   */
  async function inventaireRessources(projet) {
    const reponse = await appel(requete(projet, '/v1/storage/stores', { limit: '100' }))
    const brut = (reponse && (reponse.stores || (reponse.body && reponse.body.stores))) || []
    const ressources = brut.map((store) => {
      const projets = Array.isArray(store.projectsMetadata) ? store.projectsMetadata : []
      const environnements = [...new Set(projets.flatMap((lien) =>
        lien.environments || lien.targets || []))].sort()
      return {
        id: store.id || null,
        nom: store.name || null,
        type: store.type || null,
        produit: (store.product && (store.product.name || store.product.slug)) || null,
        region: store.region || null,
        etatFacturation: store.billingState || null,
        environnements,
        projetsConnectes: projets.map((lien) => lien.name || lien.projectId || null).filter(Boolean),
        nombreProjets: typeof store.totalConnectedProjects === 'number'
          ? store.totalConnectedProjects : projets.length,
        // Noms des secrets fournis par l'intégration — JAMAIS leurs valeurs.
        secrets: Array.isArray(store.secrets)
          ? store.secrets.map((secret) => secret && secret.name).filter(Boolean) : [],
        rotationTerminee: store.secretRotationCompletedAt || null,
        quotaDepasse: store.usageQuotaExceeded === true,
      }
    })
    return { ressources }
  }

  /** Ressources d'un produit donné (« Neon », « Upstash »…), pour ce projet ou non. */
  function filtrerRessources(ressources, motifProduit, nomProjet) {
    const motif = new RegExp(motifProduit, 'i')
    return ressources.filter((ressource) => {
      const correspond = motif.test(String(ressource.produit || ''))
        || motif.test(String(ressource.nom || ''))
      if (!correspond) return false
      if (!nomProjet) return true
      return ressource.projetsConnectes.includes(nomProjet)
    })
  }

  return {
    detecter, lire, ecrire, sonder, projetLie, appel, commande,
    inventaireRessources, filtrerRessources,
    versionUtilisee: () => versionUtilisee, CIBLES,
  }
}

module.exports = { client, CIBLES, VERSION_EPINGLEE, MAJEURE_ATTENDUE }
