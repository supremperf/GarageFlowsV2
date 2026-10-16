'use strict'
/**
 * Résolution AUTOMATIQUE des variables « non relisibles » chez Vercel.
 *
 * ─── Le problème réel ────────────────────────────────────────────────────────
 *
 * Les secrets sont poussés chez Vercel en `--sensitive` : c'est le bon réglage
 * (Vercel ne les réaffiche jamais), mais il ferme la porte au run suivant —
 * `vercel env pull` ne renvoie rien pour ces noms. L'ancien comportement
 * demandait alors la « valeur ORIGINALE depuis votre coffre » et **s'arrêtait
 * net** si elle n'était pas fournie :
 *
 *   DATABASE_URL existe chez Vercel mais sa valeur n'est pas relisible.
 *   DEVICE_TOKEN_PEPPER : valeur de production nécessaire pour poursuivre.
 *
 * Résultat : impossible de configurer une installation neuve sans chasser des
 * valeurs que personne n'a copiées.
 *
 * ─── Ce que fait ce module ───────────────────────────────────────────────────
 *
 * Il décide, POUR CHAQUE variable non relisible, d'où vient sa valeur, dans cet
 * ordre — et il ne génère jamais à l'aveugle :
 *
 *   1. `locale`      : le fichier de profil la contient déjà → adoptée telle
 *                      quelle, elle sera écrite chez Vercel.
 *   2. `fournie:<source>` : un fournisseur automatique sait produire la VRAIE
 *                      valeur (Neon pour DATABASE_URL/DIRECT_URL). On ne
 *                      FABRIQUE jamais une URL de base de données.
 *   3. `generee`    : la variable est générable (clé symétrique de
 *                      `config-core.GENERATED`) ET la génération est autorisée
 *                      (première installation, ou accord explicite) → une
 *                      nouvelle valeur 256 bits est générée et REMPLACE celle de
 *                      Vercel.
 *   4. `a-fournir`  : aucune règle ne s'applique (mot de passe SMTP, clé d'un
 *                      service tiers…) → une seule question groupée, jamais une
 *                      boucle de saisies masquées.
 *
 * Le fichier de reçus (`GarageFlow-configuration/secrets-receipt.json`) ne
 * contient QUE des empreintes SHA-256 : il sert à prouver qu'une valeur locale
 * est bien celle qui a été poussée, et à SIGNALER une dérive (fichier local
 * modifié depuis) au lieu de laisser un remplacement silencieux chez Vercel.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** Empreinte d'une valeur : preuve de synchronisation, jamais la valeur. */
function empreinte(valeur) {
  return crypto.createHash('sha256').update(String(valeur), 'utf8').digest('hex')
}

/** Valeur exploitable : ni absente, ni vide après nettoyage. */
function utilisable(valeur) {
  return typeof valeur === 'string' && valeur.trim() !== ''
}

/**
 * Décide de la provenance de chaque variable non relisible.
 *
 * @param {object} options
 * @param {string[]} options.noms              variables marquées non relisibles par Vercel
 * @param {object} options.local               valeurs déjà connues du profil local
 * @param {object} options.recus               empreintes du run précédent : { nom: { sha256 } }
 * @param {string[]} options.generables        noms générables (clés symétriques)
 * @param {object} options.fournisseurs        valeurs réellement obtenues d'un service : { nom: valeur }
 * @param {boolean} options.rotationAutorisee  autorisation explicite de remplacer chez Vercel
 * @param {() => string} [options.generer]     générateur injectable (tests)
 * @returns {{ valeurs: object, generees: string[], remplacements: string[],
 *            fournies: string[], locales: string[], divergences: string[],
 *            aFournir: string[] }}
 */
function resoudreValeursCachees({
  noms = [], local = {}, recus = {}, generables = [], fournisseurs = {},
  rotationAutorisee = false, generer = null,
} = {}) {
  const generablesSet = new Set(generables)
  const resultat = {
    valeurs: {}, generees: [], remplacements: [], fournies: [], locales: [], divergences: [], aFournir: [],
  }

  for (const nom of noms) {
    // 1. Le profil local fait foi : aucune question, aucune rotation.
    if (utilisable(local[nom])) {
      resultat.valeurs[nom] = local[nom]
      resultat.locales.push(nom)
      // Le reçu ne décide de rien : il constate. Une empreinte différente veut
      // dire que le fichier local a changé depuis le dernier envoi ; pousser
      // cette valeur REMPLACERAIT celle de production, ce qui doit être dit.
      const recu = recus[nom]
      if (recu && utilisable(recu.sha256) && recu.sha256 !== empreinte(local[nom])) resultat.divergences.push(nom)
      continue
    }
    // 2. Un fournisseur a produit la VRAIE valeur (Neon pour les URLs de base).
    if (utilisable(fournisseurs[nom])) {
      resultat.valeurs[nom] = fournisseurs[nom]
      resultat.fournies.push(nom)
      continue
    }
    // 3. Génération : uniquement une clé symétrique, et uniquement si la
    //    génération est autorisée. Sur une installation établie, une nouvelle
    //    valeur rend illisibles les données/jetons produits avec l'ancienne.
    if (generablesSet.has(nom) && rotationAutorisee) {
      resultat.valeurs[nom] = generer ? generer(nom) : crypto.randomBytes(32).toString('base64')
      resultat.generees.push(nom)
      resultat.remplacements.push(nom)
      continue
    }
    // 4. Aucune règle ne s'applique : le wizard posera UNE question groupée
    //    (mot de passe SMTP, clé d'un service tiers, URL saisie à la main…).
    resultat.aFournir.push(nom)
  }

  return resultat
}

/**
 * Preuve de fraîcheur : « installation neuve » se prouve par des FAITS locaux,
 * jamais par une supposition. Si l'un de ces témoins existe, des données ou des
 * jetons ont pu être produits avec des clés déjà en service — et une rotation
 * automatique deviendrait destructrice.
 *
 * @param {string} root
 * @param {object} [options]
 * @param {string} [options.receipts] chemin du fichier de reçus
 * @param {(chemin: string) => boolean} [options.existe] injectable (tests)
 * @param {boolean} [options.serveurNeuf] verdict du contrôle de base serveur, quand il a pu être fait
 */
function premiereInstallation(root, { receipts, existe = fs.existsSync, serveurNeuf = null } = {}) {
  const temoins = [
    path.join(root, '.env.server.local'),
    path.join(root, 'keys', 'private.pem'),
    receipts || cheminRecus(root),
  ]
  const aucunTemoin = temoins.every((chemin) => !existe(chemin))
  // Un témoin trouvé est dirimant ; aucun témoin ET une base serveur qui n'est
  // pas manifestement vide (quand on a pu le vérifier) ne suffisent pas.
  if (!aucunTemoin) return false
  return serveurNeuf === null ? true : serveurNeuf
}

/** Chemin canonique du fichier de reçus (dossier privé, mode 0700). */
function cheminRecus(root) {
  return path.join(root, 'GarageFlow-configuration', 'secrets-receipt.json')
}

/**
 * Lit les reçus. Un fichier illisible ou douteux est IGNORÉ (retour vide) au
 * lieu d'être « réparé » en silence : un reçu ne doit jamais fonder une décision
 * sur un contenu incertain.
 */
function lireRecus(root, { fichier, lire = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const chemin = fichier || cheminRecus(root)
  try {
    const donnees = JSON.parse(lire(chemin))
    if (!donnees || typeof donnees !== 'object' || donnees === null) return {}
    const noms = donnees.noms
    if (!noms || typeof noms !== 'object' || Array.isArray(noms)) return {}
    return donnees.noms
  } catch {
    return {}
  }
}

/**
 * Vérifie qu'une valeur locale correspond à ce qui a été poussé la dernière
 * fois : c'est la seule façon de comparer un secret que Vercel ne relit pas.
 * @returns {{ coherents: string[], divergents: string[], inconnus: string[] }}
 */
function verifierRecus(recus, valeurs, projet = '') {
  const coherents = [], divergents = [], inconnus = []
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (!utilisable(valeur)) continue
    const recu = recus[nom]
    if (!recu || !utilisable(recu.sha256) || (projet && recu.projet && recu.projet !== projet)) { inconnus.push(nom); continue }
    if (recu.sha256 === empreinte(valeur)) coherents.push(nom)
    else divergents.push(nom)
  }
  return { coherents, divergents, inconnus }
}

/**
 * Enregistre les empreintes de ce qui vient d'être poussé : empreintes seules,
 * aucune valeur, permissions privées.
 * @returns {object} le contenu écrit
 */
function ecrireRecus(root, { projet = '', origines = {}, valeurs = {}, horodatage = new Date().toISOString() } = {},
  { fichier, ecrire = null } = {}) {
  const chemin = fichier || cheminRecus(root)
  const noms = {}
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (!utilisable(valeur)) continue
    noms[nom] = { sha256: empreinte(valeur), origine: origines[nom] || 'synchronisée', projet, horodatage }
  }
  const contenu = {
    schema: 1,
    note: 'Empreintes SHA-256 uniquement — aucune valeur secrète dans ce fichier.',
    projet, horodatage, noms,
  }
  const texte = JSON.stringify(contenu, null, 2) + '\n'
  if (ecrire) ecrire(chemin, texte)
  else {
    fs.mkdirSync(path.dirname(chemin), { recursive: true, mode: 0o700 })
    fs.writeFileSync(chemin, texte, { mode: 0o600 })
    try { fs.chmodSync(chemin, 0o600) } catch { /* Windows : ACL du dossier utilisateur */ }
  }
  return contenu
}

/**
 * Plan d'écriture chez Vercel pour une variable.
 *
 * Une variable déjà présente mais NON RELISIBLE ne peut pas être mise à jour par
 * un simple `env add` : il faut la retirer puis la recréer. La suppression n'est
 * planifiée que lorsqu'un remplacement est explicitement décidé (valeur générée
 * parce que l'originale était introuvable) — jamais « au cas où ».
 *
 * @returns {string[][]} une ou deux commandes `vercel env …`, dans l'ordre
 */
function planEcritureVercel(nom, { sensible, present, remplacer = false } = {}) {
  const commandes = []
  if (present && remplacer) commandes.push(['env', 'rm', nom, 'production', '--yes'])
  commandes.push(['env', 'add', nom, 'production', sensible ? '--sensitive' : '--no-sensitive', '--yes'])
  return commandes
}

module.exports = {
  empreinte, utilisable, resoudreValeursCachees, premiereInstallation, cheminRecus,
  lireRecus, verifierRecus, ecrireRecus, planEcritureVercel,
}
