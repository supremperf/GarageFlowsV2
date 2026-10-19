/**
 * Impression d'un document HTML autonome, AVEC REPLI MOBILE.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * L'ordre de réparation s'imprimait ainsi :
 *
 *     const w = window.open('', '_blank')
 *     if (w) { w.document.write(html); w.document.close(); w.print() }
 *
 * Dans une PWA installée (mode `standalone`) et sur la plupart des navigateurs
 * mobiles, `window.open` renvoie `null` : la fenêtre est bloquée. Le `if (w)`
 * avalait alors l'échec — l'utilisateur appuyait sur « Imprimer » et il ne se
 * passait STRICTEMENT RIEN, sans message.
 *
 * ─── La stratégie retenue ───────────────────────────────────────────────────
 * On imprime depuis une iframe cachée du document courant : aucune fenêtre à
 * ouvrir, donc rien à bloquer. C'est le seul chemin fiable en `standalone`.
 * Si même cela échoue, on le DIT — jamais d'échec silencieux.
 */

/**
 * Échappe une valeur destinée à du CONTENU ou à un ATTRIBUT HTML.
 *
 * Le document imprimé est injecté par `doc.write()` dans une iframe **de même
 * origine** : tout `<script>` qui s'y trouve s'exécute donc dans l'origine de
 * l'application — et sous Electron, dans le renderer. Interpoler une donnée
 * saisie par l'utilisateur (nom de client, note, libellé de ligne, référence de
 * pièce…) sans échappement était donc un XSS stocké : il suffisait d'enregistrer
 * un client nommé `<img src=x onerror=…>` puis d'imprimer l'ordre de réparation
 * (GF31-AUD-011).
 *
 * Les cinq caractères réservés sont couverts, guillemets simples ET doubles
 * inclus, pour que la fonction soit sûre à l'intérieur d'un attribut quoté.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * URL d'image sûre pour un attribut `src` : seules les données inline produites
 * par l'application (`data:image/…;base64,…`) sont admises. Tout le reste — et
 * en particulier `javascript:` — est remplacé par une chaîne vide. Retourne une
 * valeur DÉJÀ échappée pour l'attribut.
 */
export function safeImageSrc(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : ''
}

/**
 * Imprime `html` (document complet, `<!DOCTYPE html>…`).
 * @param onError appelé avec un message si l'impression est impossible.
 */
export function printHtmlDocument(html: string, errorMessage: string, onError?: (message: string) => void): void {
  try {
    const frame = document.createElement('iframe')
    // Hors écran plutôt que `display:none` : certains navigateurs refusent
    // d'imprimer une iframe non rendue.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.opacity = '0'
    frame.style.border = '0'
    document.body.appendChild(frame)

    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) throw new Error('iframe indisponible')

    doc.open()
    doc.write(html)
    doc.close()

    const launch = () => {
      try {
        win.focus()
        win.print()
      } catch {
        onError?.(errorMessage)
      } finally {
        // Retrait différé : supprimer l'iframe pendant que la boîte
        // d'impression est ouverte annulerait le travail en cours.
        setTimeout(() => frame.remove(), 60_000)
      }
    }

    // `load` couvre le cas des ressources (logo, polices) ; le repli minuté
    // garantit qu'on imprime même si l'événement n'arrive jamais.
    let launched = false
    const once = () => { if (!launched) { launched = true; launch() } }
    frame.addEventListener('load', once)
    setTimeout(once, 1_500)
  } catch {
    onError?.(errorMessage)
  }
}
