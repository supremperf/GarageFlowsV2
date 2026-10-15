'use client'

/**
 * Ouverture d'un lien EXTERNE — un seul chemin pour tout le produit (GF-025).
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Dans l'application packagée, `setWindowOpenHandler` refuse tout ce qui n'est
 * pas un domaine GarageFlows : un `<a target="_blank">` vers un site tiers ne
 * fait RIEN, et le refus n'est que journalisé. Les 135 liens « Site de la
 * plateforme » du catalogue de facturation électronique — publiés par
 * impots.gouv.fr, donc par construction hors de notre liste blanche — étaient
 * tous morts. Le lien vers la liste officielle aussi. Et les liens des
 * notifications de l'éditeur également.
 *
 * Dans un NAVIGATEUR, ces mêmes liens fonctionnent : le défaut ne se voyait donc
 * qu'à l'endroit où il compte.
 *
 * ─── Ce que fait cette fonction ─────────────────────────────────────────────
 * Sous Electron, elle passe par le pont `openExternal`, qui n'ouvre qu'en HTTPS
 * et rend un motif de refus. Hors Electron, elle laisse le navigateur faire son
 * travail — le comportement par défaut du lien.
 *
 * Un lien en HTTP simple n'est pas ouvert : le rejet est EXPLIQUÉ et l'adresse
 * copiée dans le presse-papiers, pour que l'utilisateur puisse la coller
 * lui-même en connaissance de cause. Ouvrir en clair un lien depuis une
 * application de gestion serait un choix qu'on ferait à sa place.
 */

interface PontElectron {
  openExternal?: (url: string) => Promise<{ ok: boolean; raison?: string }>
}

/** Retour rendu à l'appelant, pour qu'il puisse informer l'utilisateur. */
export interface OuvertureLien {
  ouvert: boolean
  /** `non-https` | `url-invalide` | `pont-absent` */
  raison?: string
  /** Vrai si l'adresse a pu être copiée en repli. */
  copie?: boolean
}

/**
 * À brancher sur le `onClick` d'un `<a href=…>`. Ne fait rien hors Electron :
 * le navigateur suit le lien normalement.
 */
export async function ouvrirLienExterne(
  e: React.MouseEvent<HTMLAnchorElement>,
): Promise<OuvertureLien> {
  const pont = (typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: PontElectron }).electronAPI
    : undefined)
  if (!pont?.openExternal) return { ouvert: true }   // navigateur : comportement natif

  const url = e.currentTarget.href
  e.preventDefault()

  const r = await pont.openExternal(url).catch(() => ({ ok: false, raison: 'pont-absent' }))
  if (r?.ok) return { ouvert: true }

  let copie = false
  try {
    await navigator.clipboard.writeText(url)
    copie = true
  } catch { /* presse-papiers refusé : on le dira aussi */ }
  return { ouvert: false, raison: r?.raison, copie }
}

/** Message prêt à afficher pour un refus d'ouverture. */
export function messageRefusLien(r: OuvertureLien): string {
  const base = r.raison === 'non-https'
    ? 'Ce lien n’est pas sécurisé (http) : il n’a pas été ouvert.'
    : 'Ce lien n’a pas pu être ouvert.'
  return r.copie ? `${base} L’adresse a été copiée dans le presse-papiers.` : base
}
