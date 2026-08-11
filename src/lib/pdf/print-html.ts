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
