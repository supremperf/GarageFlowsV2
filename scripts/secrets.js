'use strict'

/**
 * Génération et injection sûres des secrets d'installation (helpers PURS, testés).
 *
 * Règles :
 *  - secret cryptographiquement aléatoire (crypto.randomBytes, 32 octets) ;
 *  - NE JAMAIS écraser un secret existant déjà fort ;
 *  - remplacer uniquement une valeur absente / vide / placeholder / faible ;
 *  - ne jamais afficher la valeur.
 */

const crypto = require('crypto')

/** 32 octets aléatoires en base64 (~43 caractères, entropie 256 bits). */
function generateSecret() {
  return crypto.randomBytes(32).toString('base64')
}

const WEAK_MARKERS = ['change_me', 'change-me', 'placeholder', 'example', 'votre_secret', 'your-secret', 'replace_with', 'openssl']

/** Une valeur de secret est-elle absente / trop courte / manifestement générique ? */
function isWeakValue(v) {
  if (!v || String(v).trim().length < 16) return true
  const low = String(v).toLowerCase()
  return WEAK_MARKERS.some((m) => low.includes(m))
}

/**
 * Garantit qu'une variable `name` du contenu .env possède un secret fort.
 *  - présente et forte      → inchangée ({ changed:false }) ;
 *  - absente/vide/faible     → (ré)génère une valeur forte ({ changed:true }).
 * N'écrase JAMAIS un secret déjà fort. Ne renvoie pas la valeur générée.
 *
 * @param {string} content  contenu du fichier .env
 * @param {string} name     ex. 'NEXTAUTH_SECRET'
 * @param {() => string} [gen]  générateur (injectable pour tests)
 * @returns {{ content: string, changed: boolean }}
 */
function ensureEnvSecret(content, name, gen = generateSecret) {
  const src = typeof content === 'string' ? content : ''
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm')
  const m = src.match(re)

  const current = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  if (current !== null && !isWeakValue(current)) {
    return { content: src, changed: false } // déjà fort — on ne touche à rien
  }

  const value = gen()
  const line = `${name}="${value}"`
  if (m) {
    return { content: src.replace(re, line), changed: true }
  }
  const sep = src.length && !src.endsWith('\n') ? '\n' : ''
  return { content: `${src}${sep}${line}\n`, changed: true }
}

module.exports = { generateSecret, isWeakValue, ensureEnvSecret }
