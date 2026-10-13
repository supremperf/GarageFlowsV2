/**
 * Logique PURE de l'auto-sauvegarde des items d'inspection (testable sans DOM).
 *
 * Les modifications en attente sont stockées dans une Map dont la clé est
 * `${itemId}:${field}`. Le bug corrigé : un timer de debounce PARTAGÉ ne
 * flushait qu'un SEUL item (le dernier édité), laissant les modifications des
 * autres items orphelines indéfiniment. `groupPendingUpdates` regroupe TOUTES
 * les entrées par item pour qu'un flush unique les envoie toutes.
 */

export type PendingMap = Map<string, string | null>

export interface ItemPatch {
  itemId: string
  fields: Record<string, string | null>
}

/**
 * Regroupe les modifications en attente par item. Robuste aux noms de champ
 * contenant « : » (on découpe sur le PREMIER « : » seulement — l'id ne contient
 * jamais « : »). Ignore les clés malformées.
 */
export function groupPendingUpdates(pending: PendingMap): ItemPatch[] {
  const byItem = new Map<string, Record<string, string | null>>()
  pending.forEach((val, key) => {
    const idx = key.indexOf(':')
    if (idx <= 0 || idx >= key.length - 1) return // pas d'id ou pas de champ
    const itemId = key.slice(0, idx)
    const field = key.slice(idx + 1)
    let fields = byItem.get(itemId)
    if (!fields) { fields = {}; byItem.set(itemId, fields) }
    fields[field] = val
  })
  return Array.from(byItem.entries()).map(([itemId, fields]) => ({ itemId, fields }))
}

/** Clés en attente pour un item (pour les retirer après envoi réussi). */
export function pendingKeysForItem(patch: ItemPatch): string[] {
  return Object.keys(patch.fields).map((f) => `${patch.itemId}:${f}`)
}
