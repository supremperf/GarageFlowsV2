'use strict'
/**
 * Politique de résolution des secrets Vercel Sensitive (non relisibles).
 * Une valeur illisible EXISTE : son remplacement est une rotation, pas un ajout.
 * Les fournisseurs produisent les vrais identifiants ; seuls les noms de
 * config-core.GENERATED autorisent un générateur de clés symétriques.
 * Les empreintes locales ne prouvent rien sur un autre projet ou une version
 * distante différente : le wizard contrôle aussi l’identité et les métadonnées.
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
 * Absence de témoins LOCAUX et contrôle serveur explicitement vide.
 * L’absence de fichiers sur ce PC ne prouve jamais que Vercel est neuf.
 */
function premiereInstallation(root, { receipts, existe = fs.existsSync, serveurNeuf = null } = {}) {
  const temoins = [
    path.join(root, '.env.server.local'),
    path.join(root, 'keys', 'private.pem'),
    receipts || cheminRecus(root),
  ]
  const aucunTemoin = temoins.every((chemin) => !existe(chemin))
  // Une inspection absente/indéterminée ne constitue jamais une autorisation.
  if (!aucunTemoin) return false
  return serveurNeuf === true
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
function verifierRecus(recus, valeurs, projet = '', stamps = null) {
  const coherents = [], divergents = [], inconnus = []
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (!utilisable(valeur)) continue
    const recu = recus[nom]
    if (!recu || !utilisable(recu.sha256) || (projet && recu.projet !== projet) || (stamps && (!projet || !stamps[nom] || recu.stamp !== stamps[nom]))) { inconnus.push(nom); continue }
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
function ecrireRecus(root, { projet = '', origines = {}, valeurs = {}, stamps = {}, horodatage = new Date().toISOString() } = {},
  { fichier, ecrire = null } = {}) {
  const chemin = fichier || cheminRecus(root)
  const noms = Object.fromEntries(Object.entries(lireRecus(root, { fichier: chemin }))
    .filter(([, recu]) => recu && recu.projet === projet))
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (!utilisable(valeur)) continue
    noms[nom] = { sha256: empreinte(valeur), origine: origines[nom] || 'synchronisée', projet, horodatage, stamp: stamps[nom] || '' }
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
