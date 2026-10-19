/**
 * Découpe d'un canevas long en pages A4.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * L'export PDF réinjectait l'image ENTIÈRE dans chaque page en l'écrasant à la
 * hauteur de la tranche :
 *
 *     pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, sliceH)   // imgData complet
 *
 * Chaque page montrait donc le document complet, comprimé verticalement, au
 * lieu de bandes successives. Le plan de découpe est isolé ici pour être
 * vérifiable : couverture exacte, sans trou ni recouvrement.
 */

export interface PageSlice {
  /** Ordonnée de la bande dans le canevas source (pixels). */
  sourceY: number
  /** Hauteur de la bande dans le canevas source (pixels). */
  sourceHeight: number
  /** Hauteur de rendu sur la page, en millimètres. */
  heightMm: number
}

export interface PageGeometry {
  pageWidthMm?: number
  pageHeightMm?: number
  marginMm?: number
}

/**
 * Plan de découpe d'un canevas de `canvasWidthPx` × `canvasHeightPx`.
 * Renvoie une tranche par page, dans l'ordre.
 */
export function planPageSlices(
  canvasWidthPx: number,
  canvasHeightPx: number,
  geometry: PageGeometry = {},
): PageSlice[] {
  const pageWidthMm = geometry.pageWidthMm ?? 210
  const pageHeightMm = geometry.pageHeightMm ?? 297
  const marginMm = geometry.marginMm ?? 10

  if (!Number.isFinite(canvasWidthPx) || !Number.isFinite(canvasHeightPx)) return []
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) return []

  const imageWidthMm = pageWidthMm - marginMm * 2
  const usableHeightMm = pageHeightMm - marginMm * 2
  if (imageWidthMm <= 0 || usableHeightMm <= 0) return []

  // Échelle réelle : pixels du canevas par millimètre de page.
  const pxPerMm = canvasWidthPx / imageWidthMm
  const sliceHeightPx = Math.floor(usableHeightMm * pxPerMm)
  if (sliceHeightPx <= 0) return []

  const slices: PageSlice[] = []
  for (let y = 0; y < canvasHeightPx; y += sliceHeightPx) {
    // La dernière bande est plus courte : sa hauteur de rendu est réduite
    // d'autant, sinon le bas du document serait étiré sur la page finale.
    const sourceHeight = Math.min(sliceHeightPx, canvasHeightPx - y)
    slices.push({ sourceY: y, sourceHeight, heightMm: sourceHeight / pxPerMm })
  }
  return slices
}
