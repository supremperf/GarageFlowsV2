/**
 * Category-tree helpers over a flat `Category[]`. Pure & deterministic.
 */
import type { Category, CategoryId } from './types'

/** The set of a category id plus all of its (transitive) descendants. */
export function categoryScope(categories: Category[], id: CategoryId): Set<CategoryId> {
  const childrenOf = new Map<CategoryId, CategoryId[]>()
  for (const c of categories) {
    if (c.parentId == null) continue
    const list = childrenOf.get(c.parentId) ?? []
    list.push(c.id)
    childrenOf.set(c.parentId, list)
  }
  const scope = new Set<CategoryId>()
  const stack: CategoryId[] = [id]
  while (stack.length) {
    const cur = stack.pop() as CategoryId
    if (scope.has(cur)) continue
    scope.add(cur)
    for (const child of childrenOf.get(cur) ?? []) stack.push(child)
  }
  return scope
}

/** Root→node path for a category, or [] when the id is unknown. */
export function categoryPath(categories: Category[], id: CategoryId): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const path: Category[] = []
  let cur = byId.get(id)
  const guard = new Set<CategoryId>() // cycle safety
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    path.unshift(cur)
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
  }
  return path
}

/** Categories linked to a given REPAIR_TYPES key. */
export function categoriesForRepairType(categories: Category[], repairType: string): Category[] {
  return categories.filter((c) => c.repairTypes?.includes(repairType))
}
