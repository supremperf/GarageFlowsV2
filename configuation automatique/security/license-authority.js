'use strict'
/**
 * Autorité cryptographique des licences GarageFlows (ECDSA P-256).
 *
 * Ce module OBSERVE et VÉRIFIE. Il ne remplace rien.
 *
 * La raison est structurelle : la clé publique est embarquée dans les binaires
 * déjà installés chez les clients (`electron/main.js`, `src/lib/license/
 * public-key.ts`). Générer une nouvelle paire ne « renouvelle » pas l'autorité —
 * elle en crée une SECONDE, que les clients déjà livrés refusent. Les licences
 * signées par l'ancienne ne valident plus, et le logiciel se verrouille sans
 * message exploitable. C'est arrivé deux fois dans l'histoire de ce dépôt
 * (commits f6ef4db puis a6fbff7, documentés dans
 * `src/lib/license/__tests__/public-key-consistency.test.ts`).
 *
 * Conséquence : la génération est autorisée dans un seul cas, et le code
 * l'exige explicitement — aucune autorité nulle part (pas de `keys/private.pem`,
 * pas de `keys/public.pem`, aucun ancrage embarqué exploitable). Dans tous les
 * autres cas, le module rend un diagnostic et laisse l'opérateur décider.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ANCRAGES = [
  { fichier: 'electron/main.js', variable: '_PK', libelle: 'Electron (binaire client)', production: true },
  { fichier: 'src/lib/license/public-key.ts', variable: '_LINES', libelle: 'Next.js (serveur et PWA)', production: true },
]
const ANCRAGE_TEST = {
  fichier: 'src/lib/license/__tests__/public-key-consistency.test.ts',
  variable: 'REFERENCE_FP',
  libelle: 'test de cohérence (empreinte de référence historique)',
}

/** Empreinte canonique d'une clé publique : SHA-256 du DER SPKI. */
function empreinte(materiel) {
  return crypto.createHash('sha256').update(crypto.createPublicKey(materiel).export({ type: 'spki', format: 'der' })).digest('hex')
}

/** Reconstruit un PEM depuis un tableau de littéraux JavaScript (`_PK`, `_LINES`). */
function pemDepuisTableau(source, variable) {
  const bloc = source.match(new RegExp(variable + '\\s*=\\s*\\[([\\s\\S]*?)\\]'))
  if (!bloc) return null
  const lignes = [...bloc[1].matchAll(/'([^']*)'/g)].map((correspondance) => correspondance[1])
  return lignes.length ? lignes.join('\n') : null
}

function lireTexte(fichier) {
  try {
    return fs.readFileSync(fichier, 'utf8')
  } catch (erreur) {
    if (erreur.code === 'ENOENT') return null
    throw erreur
  }
}

/**
 * Inspecte l'autorité présente sur ce poste et dans ce dépôt.
 *
 * @param {string} racine racine du dépôt
 * @returns {object} état complet, sans aucune valeur secrète
 */
function inspecter(racine) {
  const fichierPrive = path.join(racine, 'keys/private.pem')
  const fichierPublic = path.join(racine, 'keys/public.pem')
  const etat = {
    clePriveePresente: fs.existsSync(fichierPrive),
    clePubliquePresente: fs.existsSync(fichierPublic),
    chiffree: false,
    courbe: null,
    empreinteCleePrivee: null,
    empreinteClePublique: null,
    ancrages: [],
    ancrageTest: null,
    correspondancePriveePublique: null,
    signatureVerifiee: null,
    ancragesProductionCoherents: null,
    autoriteExiste: false,
    generationAutorisee: false,
    anomalies: [],
    avertissements: [],
  }

  const privee = lireTexte(fichierPrive)
  const publique = lireTexte(fichierPublic)

  if (privee) {
    etat.chiffree = /ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(privee)
    if (etat.chiffree) {
      // Une clé protégée par phrase secrète n'est pas lisible sans elle : on le
      // CONSTATE au lieu de demander un secret ou de conclure à son absence.
      etat.avertissements.push('keys/private.pem est chiffrée par phrase secrète : identité non vérifiable sans saisie, aucune valeur dérivée.')
    } else {
      try {
        const cle = crypto.createPrivateKey(privee)
        etat.courbe = cle.asymmetricKeyType === 'ec' ? cle.asymmetricKeyDetails.namedCurve : cle.asymmetricKeyType
        etat.empreinteCleePrivee = empreinte(cle)
        if (etat.courbe !== 'prime256v1') {
          etat.anomalies.push('keys/private.pem : courbe ' + etat.courbe + ' incompatible ; P-256 (prime256v1) attendue par le vérificateur embarqué.')
        }
      } catch {
        etat.anomalies.push('keys/private.pem illisible ou corrompue ; aucune clé de remplacement générée.')
      }
    }
  }

  if (publique) {
    try {
      etat.empreinteClePublique = empreinte(publique)
    } catch {
      etat.anomalies.push('keys/public.pem illisible ; ancrages non comparés à ce fichier.')
    }
  }

  // Les ancrages embarqués définissent ce que les clients acceptent. Ils sont la
  // référence réelle, bien avant les fichiers présents sur ce poste.
  for (const ancrage of ANCRAGES) {
    const source = lireTexte(path.join(racine, ancrage.fichier))
    if (source === null) {
      etat.ancrages.push({ ...ancrage, present: false, empreinte: null })
      continue
    }
    const pem = pemDepuisTableau(source, ancrage.variable)
    let empreinteAncrage = null
    if (pem) {
      try {
        empreinteAncrage = empreinte(pem)
      } catch {
        etat.anomalies.push(ancrage.fichier + ' : ancrage ' + ancrage.variable + ' présent mais illisible comme clé publique.')
      }
    }
    etat.ancrages.push({ ...ancrage, present: !!pem, empreinte: empreinteAncrage })
  }

  const sourceTest = lireTexte(path.join(racine, ANCRAGE_TEST.fichier))
  if (sourceTest) {
    const reference = sourceTest.match(/REFERENCE_FP\s*=\s*'([0-9a-f]{64})'/)
    etat.ancrageTest = { ...ANCRAGE_TEST, present: !!reference, empreinte: reference ? reference[1] : null }
  }

  const empreintesProduction = etat.ancrages.filter((ancrage) => ancrage.empreinte).map((ancrage) => ancrage.empreinte)
  etat.ancragesProductionCoherents = empreintesProduction.length > 0 && new Set(empreintesProduction).size === 1
  if (empreintesProduction.length > 1 && !etat.ancragesProductionCoherents) {
    etat.anomalies.push('Ancrages de production divergents entre Electron et Next.js : les clients ne valideraient pas les mêmes licences. Correction manuelle requise (npm run keys:sync après décision explicite).')
  }

  // Correspondance privée/publique : l'empreinte suffit à l'identité, mais une
  // signature réelle prouve en plus que la clé privée est UTILISABLE.
  if (etat.empreinteCleePrivee && etat.empreinteClePublique) {
    etat.correspondancePriveePublique = etat.empreinteCleePrivee === etat.empreinteClePublique
    if (!etat.correspondancePriveePublique) {
      etat.anomalies.push('keys/private.pem et keys/public.pem ne forment pas une paire : aucune synchronisation automatique, le choix de la clé émettrice appartient à l opérateur.')
    }
  }
  if (privee && !etat.chiffree && etat.empreinteCleePrivee) {
    etat.signatureVerifiee = verifierUtilisabilite(privee, publique || null)
    if (etat.signatureVerifiee === false) {
      etat.anomalies.push('keys/private.pem ne produit pas de signature vérifiable par la clé publique correspondante.')
    }
  }

  const empreinteProduction = empreintesProduction[0] || null
  if (empreinteProduction && etat.empreinteCleePrivee && empreinteProduction !== etat.empreinteCleePrivee) {
    etat.anomalies.push('keys/private.pem est une AUTRE autorité que celle embarquée dans les binaires : les licences qu elle signe seraient refusées par les clients déjà installés.')
  }
  if (etat.ancrageTest?.empreinte && empreinteProduction && etat.ancrageTest.empreinte !== empreinteProduction) {
    etat.avertissements.push(
      'L ancrage de test REFERENCE_FP (' + etat.ancrageTest.empreinte.slice(0, 16) + '…) diffère des ancrages de production (' +
      empreinteProduction.slice(0, 16) + '…). Cette empreinte documente l autorité qui a signé les licences déjà distribuées : ' +
      'la réaligner (npm run keys:sync) effacerait cette trace. Aucune action automatique.')
  }

  // Une autorité « existe » dès qu'un client embarque une clé publique : c'est
  // la condition qui interdit toute génération, même si ce poste n'a aucun
  // fichier dans keys/.
  etat.autoriteExiste = !!(empreinteProduction || etat.empreinteClePublique || etat.empreinteCleePrivee || etat.chiffree)
  etat.generationAutorisee = !etat.autoriteExiste
  if (etat.autoriteExiste && !etat.clePriveePresente) {
    etat.anomalies.push('Une autorité de licence existe (clé publique embarquée) mais sa clé privée est absente de ce poste : seule la clé d origine permet d émettre des licences acceptées. Génération refusée.')
  }
  return etat
}

/**
 * Prouve qu'une clé privée est utilisable : signature puis vérification réelle.
 * @returns {boolean|null} null si la vérification n'a pas pu être tentée
 */
function verifierUtilisabilite(privePem, publicPem) {
  try {
    const cle = crypto.createPrivateKey(privePem)
    const message = Buffer.from('garageflows-configurateur-controle-autorite')
    const signature = crypto.sign('sha256', message, cle)
    const verificateur = publicPem ? crypto.createPublicKey(publicPem) : crypto.createPublicKey(cle)
    return crypto.verify('sha256', message, verificateur, signature)
  } catch {
    return null
  }
}

/**
 * Dérive `GF_PRIVATE_KEY` (PEM encodé en base64) depuis `keys/private.pem`.
 *
 * C'est une RÉCUPÉRATION, pas une génération : la même autorité, exprimée dans
 * le format attendu par `src/app/api/admin/licenses/generate/route.ts`. La
 * dérivation est refusée si la clé ne correspond pas à l'ancrage embarqué, afin
 * de ne jamais provisionner un émetteur que les clients refuseraient.
 *
 * @returns {{ valeur: string }|{ bloque: string }}
 */
function deriverVariablePrivee(racine, etat) {
  if (!etat.clePriveePresente) return { bloque: 'keys/private.pem absente : GF_PRIVATE_KEY ne peut pas être dérivée.' }
  if (etat.chiffree) return { bloque: 'keys/private.pem chiffrée : la phrase secrète est requise, elle n est pas demandée en mode automatique.' }
  if (etat.anomalies.length) return { bloque: 'Autorité de licence en anomalie : aucune dérivation de GF_PRIVATE_KEY.' }
  const pem = lireTexte(path.join(racine, 'keys/private.pem'))
  if (!pem) return { bloque: 'keys/private.pem illisible.' }
  const valeur = Buffer.from(pem, 'utf8').toString('base64')
  // Dernier contrôle : la valeur dérivée doit satisfaire la vérification que
  // l'application applique elle-même (core.licenseKeyMatches).
  const ancrageProduction = etat.ancrages.find((ancrage) => ancrage.empreinte)
  if (!ancrageProduction) return { bloque: 'Aucun ancrage de clé publique exploitable : correspondance non vérifiable.' }
  try {
    const cle = crypto.createPrivateKey(Buffer.from(valeur, 'base64').toString('utf8'))
    if (empreinte(cle) !== ancrageProduction.empreinte) {
      return { bloque: 'La clé privée locale n est pas celle embarquée dans les clients : GF_PRIVATE_KEY non dérivée.' }
    }
  } catch {
    return { bloque: 'Dérivation de GF_PRIVATE_KEY non vérifiable.' }
  }
  return { valeur }
}

/**
 * Crée une autorité P-256 — uniquement quand il n'en existe aucune.
 * N'écrit rien si un fichier est déjà présent (ouverture exclusive).
 */
function creerAutorite(racine, etat, { ecrire }) {
  if (!etat.generationAutorisee) {
    throw new Error('Création d autorité refusée : une autorité de licence existe déjà (clé locale ou clé publique embarquée).')
  }
  const paire = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privePem = paire.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicPem = paire.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  if (verifierUtilisabilite(privePem, publicPem) !== true) {
    throw new Error('Paire générée non vérifiable ; aucun fichier écrit.')
  }
  ecrire(path.join(racine, 'keys/private.pem'), privePem, { exclusif: true, mode: 0o600 })
  ecrire(path.join(racine, 'keys/public.pem'), publicPem, { exclusif: true, mode: 0o644 })
  return { empreinte: empreinte(publicPem) }
}

module.exports = { ANCRAGES, ANCRAGE_TEST, empreinte, pemDepuisTableau, inspecter, verifierUtilisabilite, deriverVariablePrivee, creerAutorite }
