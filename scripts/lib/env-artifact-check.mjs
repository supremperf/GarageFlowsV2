/**
 * DÉTECTION DE FUITE `.env` DANS UN ARTEFACT DISTRIBUÉ — logique pure.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * La règle d'origine n'acceptait comme gabarits que les noms EXACTS
 * `.env.example`, `.env.sample` et `.env.template`. Le dépôt contient aussi
 * `.env.storage.example` (modèle fournisseur, valeurs toutes vides). Le
 * vérificateur le classait donc comme « fuite de secrets » : **toute**
 * fabrication d'artefact échouait, alors qu'aucun secret n'était présent.
 *
 * ─── Pourquoi pas un simple `*.example` ─────────────────────────────────────
 * Blanchir tout fichier dont le nom finit par `.example` ouvrirait la porte à
 * un `.env.production.example` contenant une vraie valeur — exactement le
 * scénario que la garde existe pour arrêter. Un gabarit n'est accepté que si
 * son CONTENU le prouve : uniquement des commentaires, des lignes vides et des
 * affectations SANS valeur. Une seule valeur non vide dans un nom étendu et le
 * fichier redevient une fuite.
 *
 * Les trois noms exacts historiques restent acceptés sans inspection : ils
 * existent depuis l'origine, portent des valeurs par défaut inoffensives
 * (`DATABASE_URL="file:./dev.db"`), et leur contenu est verrouillé par
 * `check:env-consistency`.
 */

/** Noms historiques acceptés sans inspection de contenu. */
export const GABARITS_EXACTS = new Set(['.env.example', '.env.sample', '.env.template'])

/** Nom étendu : `.env.<qualificatif>.example|sample|template`. */
const MOTIF_ETENDU = /^\.env\.[A-Za-z0-9._-]+\.(example|sample|template)$/

/** Ligne d'affectation sans valeur (espaces éventuels après `=`). */
const AFFECTATION_VIDE = /^[A-Za-z_][A-Za-z0-9_]*=\s*(?:#.*)?$/

/**
 * Le contenu est-il celui d'un GABARIT sans secret ?
 * Tout ce qui n'est ni ligne vide, ni commentaire, ni affectation vide est
 * refusé — y compris une ligne de continuation, un export ou du texte libre.
 */
export function contenuSansValeur(contenu) {
  if (typeof contenu !== 'string') return false
  for (const brute of contenu.split('\n')) {
    const ligne = brute.trim()
    if (ligne === '' || ligne.startsWith('#')) continue
    if (!AFFECTATION_VIDE.test(ligne)) return false
  }
  return true
}

/**
 * Un fichier est-il un gabarit acceptable ?
 * `lireContenu` n'est appelé que pour les noms étendus (jamais pour `.env`).
 */
export function estGabarit(nom, lireContenu) {
  if (GABARITS_EXACTS.has(nom)) return true
  if (!MOTIF_ETENDU.test(nom)) return false
  try {
    return contenuSansValeur(lireContenu())
  } catch {
    // Illisible : on ne blanchit pas par accident.
    return false
  }
}

/** Un nom de fichier est-il un `.env` réel (donc une fuite potentielle) ? */
export function estEnvReel(nom) {
  return nom === '.env' || (nom.startsWith('.env.') && !nom.endsWith('.example') &&
    !nom.endsWith('.sample') && !nom.endsWith('.template'))
}

/**
 * Cherche les `.env` réels dans une liste de répertoires.
 *
 * @param {Array<{dir: string, always: boolean}>} dossiers
 * @param {(fichier: string) => string} lireContenu
 * @param {{ racine: string, modeArtifact: boolean, readdir: Function, stat: Function, exists: Function, join: Function }} io
 * @returns {string[]} chemins relatifs des fuites
 */
export function fichiersEnvFuite(dossiers, lireContenu, io) {
  const fuites = []
  for (const { dir, always } of dossiers) {
    if (!io.exists(dir)) continue
    if (!always && !io.modeArtifact) continue
    for (const nom of io.readdir(dir)) {
      const complet = io.join(dir, nom)
      if (!io.stat(complet).isFile()) continue
      if (estEnvReel(nom)) { fuites.push(io.join(dir, nom)); continue }
      // Un nom qui RESSEMBLE à un gabarit mais dont le contenu porte une valeur
      // est une fuite : c'est le contournement que la règle doit voir.
      const etendu = MOTIF_ETENDU.test(nom) && !GABARITS_EXACTS.has(nom)
      if (etendu && !estGabarit(nom, () => lireContenu(complet))) fuites.push(io.join(dir, nom))
    }
  }
  return fuites
}
