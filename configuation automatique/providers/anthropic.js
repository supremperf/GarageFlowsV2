'use strict'
/**
 * FOURNISSEUR ANTHROPIC (clé d'API).
 *
 * Deux contraintes du cahier des charges se combinent ici :
 *   · ne jamais activer automatiquement les appels payants du copilote ;
 *   · ne pas transmettre un secret à un service tiers sans nécessité.
 *
 * Par défaut, le configurateur se limite donc au CONTRÔLE DE FORME et rapporte
 * honnêtement `WARNING` — « format conforme, disponibilité non testée » — au
 * lieu d'un `SUCCESS` qui laisserait croire à une vérification réelle.
 *
 * La vérification réseau n'est faite que sur demande explicite
 * (`--verifier-anthropic`). Elle appelle `GET /v1/models`, qui est une
 * opération de listage non facturée : elle prouve que la clé est acceptée sans
 * consommer un seul jeton d'inférence. La variable `GARAGEFLOW_LLM` n'est
 * jamais basculée sur `anthropic` par le configurateur : activer le copilote
 * est une décision de coût.
 */

const redact = require('../security/redact.js')

const MOTIF_CLE = /^sk-ant-[A-Za-z0-9_-]{20,}$/

/** Contrôle de forme : préfixe officiel et longueur plausible. */
function controlerForme(valeur) {
  if (!valeur || !String(valeur).trim()) return ['ANTHROPIC_API_KEY : absente.']
  const propre = String(valeur).trim()
  const problemes = []
  if (!MOTIF_CLE.test(propre)) {
    problemes.push('ANTHROPIC_API_KEY : format inattendu (une clé Anthropic commence par « sk-ant- »).')
  }
  if (/\s/.test(propre)) problemes.push('ANTHROPIC_API_KEY : espace ou saut de ligne dans la valeur.')
  return problemes
}

/**
 * Vérifie l'état de la clé.
 *
 * @param {object} valeurs variables de la cible
 * @param {{ verifierEnLigne?: boolean, fetch?: Function }} options
 */
async function verifier(valeurs, options = {}) {
  const resultat = {
    presente: !!(valeurs.ANTHROPIC_API_KEY && String(valeurs.ANTHROPIC_API_KEY).trim()),
    forme: controlerForme(valeurs.ANTHROPIC_API_KEY),
    disponibilite: 'non-testee',
    copiloteActif: String(valeurs.GARAGEFLOW_LLM || 'off').trim() === 'anthropic',
    erreur: null,
  }
  if (!resultat.presente) {
    resultat.consequence = 'Reconnaissance de plaque par image et copilote indisponibles ; aucune autre fonction affectée.'
    return resultat
  }
  if (!options.verifierEnLigne || resultat.forme.length) return resultat

  const requete = options.fetch || fetch
  try {
    const reponse = await requete('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'x-api-key': String(valeurs.ANTHROPIC_API_KEY).trim(),
        'anthropic-version': '2023-06-01',
      },
    })
    if (reponse.status === 200) resultat.disponibilite = 'acceptee'
    else if (reponse.status === 401 || reponse.status === 403) resultat.disponibilite = 'refusee'
    else resultat.disponibilite = 'indeterminee'
    resultat.httpStatus = reponse.status
  } catch (erreur) {
    resultat.disponibilite = 'injoignable'
    resultat.erreur = redact.nettoyer(erreur.message).slice(0, 160)
  }
  return resultat
}

module.exports = { MOTIF_CLE, controlerForme, verifier }
