'use strict'
/**
 * Affichage terminal. Toute sortie passe par ce module, et toute sortie est
 * nettoyée par `security/redact.js` avant d'atteindre la console : c'est ce qui
 * garantit qu'aucune valeur ne peut fuir par un message d'erreur imprévu.
 *
 * Les statuts sont ceux du cahier des charges, et leur sens est strict :
 * `SUCCESS` n'est employé que pour une vérification réellement effectuée — un
 * contrôle de format ne vaut pas un test de connexion.
 */

const redact = require('../security/redact.js')

const STATUTS = {
  SUCCESS: { libelle: 'SUCCESS', icone: 'OK  ', sens: 'configuration vérifiée par un contrôle réel' },
  REUSED: { libelle: 'REUSED', icone: 'REUT', sens: 'configuration existante réutilisée' },
  GENERATED: { libelle: 'GENERATED', icone: 'GEN ', sens: 'secret généré' },
  SYNCHRONIZED: { libelle: 'SYNCHRONIZED', icone: 'SYNC', sens: 'variable synchronisée' },
  WARNING: { libelle: 'WARNING', icone: 'ATTN', sens: 'anomalie non bloquante' },
  BLOCKED: { libelle: 'BLOCKED', icone: 'BLOQ', sens: 'autorisation ou ressource indispensable manquante' },
  FAILED: { libelle: 'FAILED', icone: 'ECHE', sens: 'erreur technique' },
  SKIPPED: { libelle: 'SKIPPED', icone: 'IGNO', sens: 'opération volontairement ignorée' },
}

const ORDRE_GRAVITE = ['FAILED', 'BLOCKED', 'WARNING', 'GENERATED', 'SYNCHRONIZED', 'SUCCESS', 'REUSED', 'SKIPPED']

// Les couleurs ANSI sont désactivées dès qu'une sortie n'est pas un terminal :
// un rapport redirigé dans un fichier ne doit pas contenir de séquences
// d'échappement, et certains terminaux Windows anciens les affichent en clair.
const couleursActives = !!process.stdout.isTTY && !process.env.NO_COLOR
const CODES = {
  SUCCESS: '32', REUSED: '36', GENERATED: '35', SYNCHRONIZED: '34',
  WARNING: '33', BLOCKED: '31', FAILED: '31', SKIPPED: '90',
}

function colorer(statut, texte) {
  if (!couleursActives || !CODES[statut]) return texte
  return '[' + CODES[statut] + 'm' + texte + '[0m'
}

function ecrire(texte) {
  process.stdout.write(redact.nettoyer(texte) + '\n')
}

function titre(texte) {
  ecrire('')
  ecrire('== ' + texte + ' ' + '='.repeat(Math.max(0, 72 - texte.length)))
}

function ligne(statut, sujet, detail) {
  const marque = STATUTS[statut] ? STATUTS[statut].icone : '    '
  const suffixe = detail ? ' — ' + detail : ''
  ecrire('  ' + colorer(statut, '[' + marque + ']') + ' ' + sujet + suffixe)
}

function info(texte) {
  ecrire('  ' + texte)
}

/** Liste de noms sur plusieurs lignes : jamais de valeurs, seulement des noms. */
function noms(prefixe, liste, largeur = 92) {
  if (!liste || !liste.length) return
  const tri = [...liste].sort()
  let courante = '      '
  const lignes = []
  for (const nom of tri) {
    if (courante.length + nom.length + 2 > largeur) {
      lignes.push(courante)
      courante = '      '
    }
    courante += nom + '  '
  }
  if (courante.trim()) lignes.push(courante)
  ecrire('    ' + prefixe + ' (' + tri.length + ') :')
  for (const l of lignes) ecrire(l.trimEnd())
}

module.exports = { STATUTS, ORDRE_GRAVITE, ecrire, titre, ligne, info, noms, colorer }
