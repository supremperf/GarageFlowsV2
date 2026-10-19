/**
 * RENDU A4 DÉTERMINISTE — un document identique sur poste et sur téléphone.
 *
 * ─── Le défaut mesuré ───────────────────────────────────────────────────────
 * L'export PDF photographiait le nœud tel qu'il était mis en page À L'ÉCRAN.
 * La largeur capturée dépendait donc de l'appareil (recette du 2026-08-11, même
 * facture, même serveur) :
 *
 *     poste 1440 px  → nœud 896 px → image 1782×1292 posée en 190 × 137,8 mm ✔
 *     iPhone 12      → nœud 358 px → image  714×1452 posée en 190 × 277 mm
 *                                     PUIS la même image en 190 × 109,4 mm ✘
 *     Android 360 px → nœud 328 px → image  654×1452 en 190 × 277 puis 144,8 ✘
 *
 * Hauteur fidèle au ratio pour l'iPhone : 1452 ⁄ 714 × 190 = 386 mm. Le document
 * partait donc ÉCRASÉ verticalement (×0,72 puis ×0,28) et RÉPÉTÉ en entier sur
 * chaque page — d'où « le PDF est déformé sur le téléphone ».
 *
 * ─── Les deux règles tenues ici ─────────────────────────────────────────────
 *  1. LARGEUR FIXE : le nœud imprimé déclare `A4_CONTENT_WIDTH_PX`, jamais une
 *     largeur héritée du viewport. Le PDF est alors le même partout.
 *  2. DÉCOUPE, PAS ÉCRASEMENT : chaque page reçoit UNE BANDE recadrée du
 *     canevas (cf. `planPageSlices`), à son échelle exacte. Aucun `addImage`
 *     ne reçoit une hauteur qui ne correspond pas à son contenu.
 *
 * Ce module est le SEUL chemin d'export PDF de l'application : contrôle
 * véhicule, devis et facture partagent la même géométrie.
 */

import { planPageSlices } from './page-slices'

/**
 * Largeur de rendu des documents imprimables, en pixels CSS.
 * 794 px = 210 mm à 96 dpi. Valeur volontairement CONSTANTE : c'est elle qui
 * rend l'export indépendant de la taille de l'écran.
 */
export const A4_CONTENT_WIDTH_PX = 794

/**
 * Qualité JPEG des pages du PDF.
 *
 * 0,85 est le point où le texte reste net à `scale: 2` tout en divisant le
 * poids du fichier par ~30 face au PNG (voir la mesure dans `addImage`).
 */
export const JPEG_QUALITY = 0.85

export interface RenderA4Options {
  /** Nom du fichier proposé au téléchargement (avec ou sans .pdf). */
  fileName: string
  /** Marge de page en millimètres (défaut 10). */
  marginMm?: number
  /** Sur-échantillonnage du canevas (défaut 2 — texte net sans exploser la mémoire). */
  scale?: number
}

/**
 * Source de l'image de logo pour un document imprimable.
 *
 * Le logo d'un garage est stocké de DEUX façons selon son ancienneté : en
 * base64 dans la fiche (`logoBase64`) ou en fichier référencé (`logoPath`,
 * servi par /api/photos). Un document qui ne lit que `logoBase64` sort donc
 * SANS logo pour tous les garages de la seconde catégorie — silencieusement.
 */
export function printLogoSrc(
  garage: { logoBase64?: string | null; logoPath?: string | null } | null | undefined,
): string | null {
  if (!garage) return null
  if (garage.logoBase64) return garage.logoBase64
  if (garage.logoPath) return `/api/photos/${garage.logoPath}`
  return null
}

/** Résultat d'un rendu — exposé pour les tests et la journalisation. */
export interface RenderA4Result {
  pages: number
  canvasWidth: number
  canvasHeight: number
}

/**
 * Rend `element` en PDF A4 multi-pages et déclenche le téléchargement.
 *
 * `element` DOIT être un document d'impression dédié, de largeur
 * `A4_CONTENT_WIDTH_PX` : ne jamais passer un nœud d'interface, dont la mise en
 * page suit l'écran (et qui embarquerait champs de saisie et boutons).
 */
export async function renderElementToA4Pdf(
  element: HTMLElement,
  options: RenderA4Options,
): Promise<RenderA4Result> {
  const margin = options.marginMm ?? 10
  const scale = options.scale ?? 2

  const { default: html2canvas } = await import('html2canvas')
  const { default: jsPDF } = await import('jspdf')

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    // La largeur de la fenêtre CLONÉE est imposée : sur un téléphone, la
    // fenêtre réelle fait 360 px et html2canvas y replierait la mise en page.
    windowWidth: A4_CONTENT_WIDTH_PX,
    width: element.scrollWidth,
    height: element.scrollHeight,
  })

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const imageWidthMm = 210 - margin * 2
  const slices = planPageSlices(canvas.width, canvas.height, { marginMm: margin })

  slices.forEach((slice, index) => {
    // Une bande = un recadrage réel du canevas source. Sans ce recadrage,
    // `addImage` recevrait l'image entière avec une hauteur de page : le
    // document complet apparaîtrait comprimé sur chaque page.
    const band = document.createElement('canvas')
    band.width = canvas.width
    band.height = slice.sourceHeight
    const ctx = band.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, band.width, band.height)
    ctx.drawImage(
      canvas,
      0, slice.sourceY, canvas.width, slice.sourceHeight,
      0, 0, canvas.width, slice.sourceHeight,
    )
    if (index > 0) pdf.addPage()
    // ── JPEG et non PNG : un PDF que l'on peut ENVOYER (GF-043) ──────────────
    // Mesuré en navigateur réel, même document, même échelle :
    //
    //     facture 1 page  · PNG 4,61 Mo · JPEG q=0,85 0,13 Mo   (×35)
    //     facture 4 pages · PNG 35,8 Mo · JPEG q=0,85 1,13 Mo   (×32)
    //
    // Une facture d'une page à 4,6 Mo passe mal en pièce jointe ; à quatre
    // pages, 35,8 Mo dépassent la limite de toutes les messageries courantes
    // (Gmail : 25 Mo). Le garage produisait donc un document qu'il ne pouvait
    // pas transmettre — sans qu'aucun message ne l'explique.
    //
    // Le JPEG n'a pas de couche alpha : c'est sans conséquence ici, la bande
    // est remplie en blanc opaque juste au-dessus. À `scale: 2`, le texte reste
    // net — l'image source fait 1684 px de large pour 190 mm imprimés.
    pdf.addImage(band.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', margin, margin, imageWidthMm, slice.heightMm)
  })

  const name = options.fileName.toLowerCase().endsWith('.pdf') ? options.fileName : `${options.fileName}.pdf`
  deliverPdf(pdf.output('blob') as Blob, name)

  return { pages: slices.length, canvasWidth: canvas.width, canvasHeight: canvas.height }
}

/**
 * Remise du fichier à l'utilisateur, avec REPLI.
 *
 * Sur un téléphone — et particulièrement dans une PWA installée (mode
 * `standalone`) — un téléchargement peut être ignoré : l'attribut `download`
 * n'est pas honoré partout, et il n'existe pas de gestionnaire de
 * téléchargement visible. L'utilisateur appuie sur « PDF » et il ne se passe
 * RIEN, sans le moindre message.
 *
 * On tente donc le téléchargement classique, puis on OUVRE le document si le
 * navigateur ne sait pas le télécharger. L'URL objet est révoquée tardivement :
 * la révoquer immédiatement viderait l'onglet qui vient de s'ouvrir.
 */
export function deliverPdf(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const revoke = () => setTimeout(() => URL.revokeObjectURL(url), 120_000)

  const anchor = document.createElement('a')
  const canDownload = 'download' in anchor
  if (canDownload) {
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    try {
      anchor.click()
      revoke()
      return
    } finally {
      anchor.remove()
    }
  }

  // Repli : affichage dans le visualiseur natif du navigateur. Jamais d'écran
  // vide — si l'ouverture est bloquée, on navigue dans l'onglet courant.
  const opened = window.open(url, '_blank', 'noopener')
  if (!opened) window.location.href = url
  revoke()
}

/**
 * Conteneur hors écran d'un document d'impression.
 *
 * `position: fixed` + décalage négatif : le nœud est réellement mis en page
 * (html2canvas a besoin de dimensions calculées) mais reste invisible, hors du
 * flux, et inaccessible aux lecteurs d'écran comme au tabulateur.
 */
export const PRINT_HOST_STYLE = {
  position: 'fixed',
  left: -10_000,
  top: 0,
  width: A4_CONTENT_WIDTH_PX,
  pointerEvents: 'none',
  zIndex: -1,
} as const
