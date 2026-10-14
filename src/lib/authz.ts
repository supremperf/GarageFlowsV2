/**
 * Matrice de permissions centralisée — « deny by default ».
 *
 * Toute permission NON explicitement accordée à un rôle est REFUSÉE.
 * Cette matrice est la référence unique pour l'espace mécanicien et la gestion
 * des accès mécaniciens ; les routes existantes conservent leurs vérifications
 * historiques (OWNER/MANAGER) mais peuvent migrer progressivement vers can().
 *
 * Le rôle MECHANIC n'est PAS un rôle NextAuth : il est porté par la session de
 * licence mécanicien (cookie gf_session, typ='mechanic') vérifiée en base à
 * chaque requête — voir src/lib/license/mechanic-session.ts.
 */

export type Role = 'OWNER' | 'MANAGER' | 'RECEPTIONIST' | 'MECHANIC'

export type Permission =
  // ── Espace mécanicien (périmètre strict) ────────────────────────────────────
  | 'job:read_assigned'        // lire UNIQUEMENT ses interventions attribuées
  | 'schedule:read_self'       // lire son propre planning
  | 'photo:create_assigned'    // ajouter une photo à SON intervention (append-only)
  | 'comment:create_assigned'  // ajouter un commentaire à SON intervention
  | 'note:create_assigned'     // ajouter une note technique à SON intervention
  | 'observation:create_assigned'
  | 'issue:create_assigned'    // signaler un problème sur SON intervention
  | 'checklist:update_assigned' // compléter la checklist de SON intervention
  | 'timer:update_assigned'    // démarrer/terminer SON intervention (fonction existante)
  | 'profile:read_self'
  | 'session:logout'
  // ── Gestion des accès mécaniciens (staff) ───────────────────────────────────
  | 'mechanicLicense:read'
  | 'mechanicLicense:register'
  | 'mechanicLicense:assign'
  | 'mechanicLicense:suspend'
  | 'mechanicLicense:revoke'
  | 'mechanicLicense:reactivate'
  | 'mechanicLicense:disconnect'
  | 'mechanicLicense:copyToken'
  | 'mechanicNote:read'        // lire les contributions des mécaniciens (staff)
  // ── Périmètre garage (référence — l'existant reste vérifié dans les routes) ──
  | 'job:manage'
  | 'customer:manage'
  | 'vehicle:manage'
  | 'invoice:manage'
  | 'quote:manage'
  | 'financial:read'
  | 'stock:manage'
  | 'settings:manage'
  | 'user:manage'
  | 'mechanic:manage'
  | 'assignment:manage'
  | 'license:manage'

const MECHANIC_PERMISSIONS: Permission[] = [
  'job:read_assigned',
  'schedule:read_self',
  'photo:create_assigned',
  'comment:create_assigned',
  'note:create_assigned',
  'observation:create_assigned',
  'issue:create_assigned',
  'checklist:update_assigned',
  'timer:update_assigned',
  'profile:read_self',
  'session:logout',
]

const RECEPTIONIST_PERMISSIONS: Permission[] = [
  'job:manage',
  'customer:manage',
  'vehicle:manage',
  'quote:manage',
  'mechanicNote:read',
]

const MANAGER_PERMISSIONS: Permission[] = [
  ...RECEPTIONIST_PERMISSIONS,
  'invoice:manage',
  'financial:read',
  'stock:manage',
  'mechanic:manage',
  'assignment:manage',
  'mechanicLicense:read',
  'mechanicLicense:disconnect',
]

const OWNER_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  'settings:manage',
  'user:manage',
  'license:manage',
  'mechanicLicense:register',
  'mechanicLicense:assign',
  'mechanicLicense:suspend',
  'mechanicLicense:revoke',
  'mechanicLicense:reactivate',
  'mechanicLicense:copyToken',
]

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  OWNER:        new Set(OWNER_PERMISSIONS),
  MANAGER:      new Set(MANAGER_PERMISSIONS),
  RECEPTIONIST: new Set(RECEPTIONIST_PERMISSIONS),
  MECHANIC:     new Set(MECHANIC_PERMISSIONS),
}

const PERM_LIST: Record<Role, Permission[]> = {
  OWNER:        OWNER_PERMISSIONS,
  MANAGER:      MANAGER_PERMISSIONS,
  RECEPTIONIST: RECEPTIONIST_PERMISSIONS,
  MECHANIC:     MECHANIC_PERMISSIONS,
}

/**
 * Le rôle possède-t-il la permission ? Rôle inconnu ou permission absente de la
 * matrice ⇒ false (deny by default), jamais d'exception.
 */
export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !Object.hasOwn(MATRIX, role)) return false
  const set = MATRIX[role as Role]
  if (!set) return false
  return set.has(permission)
}

/** Liste des permissions d'un rôle (copie défensive — la matrice est immuable). */
export function permissionsOf(role: string | null | undefined): Permission[] {
  if (!role || !Object.hasOwn(PERM_LIST, role)) return []
  const list = PERM_LIST[role as Role]
  return list ? [...list] : []
}

/**
 * Projection d'autorisation : retire le COÛT D'ACHAT des lignes de devis et de
 * factures pour les rôles dépourvus de `financial:read`.
 *
 * `InvoiceLine` et `QuoteLine` portent `unitCostTenThousandths` — le prix
 * d'achat, donc la marge. `/api/finance`, `/api/profitability`, `/api/forecast`,
 * `/api/export/fec` et `/api/copilot/*` exigent tous `financial:read` ; mais
 * `GET /api/invoices` et `GET /api/quotes` renvoyaient les lignes brutes à tout
 * utilisateur authentifié, coût inclus. Le contrôle posé sur la porte des
 * rapports se contournait donc en lisant les documents eux-mêmes
 * (GF31-AUD-009).
 *
 * On RETIRE le champ plutôt que de refuser la route : un RECEPTIONIST doit
 * pouvoir consulter les documents de son garage (il a `quote:manage`), mais pas
 * en connaître la marge.
 */
export function redactLineCosts<T extends Record<string, unknown>>(
  lines: T[] | null | undefined,
  role: string | null | undefined,
): T[] {
  if (can(role, 'financial:read')) return lines ?? []
  return (lines ?? []).map((l) => {
    const copie = { ...l }
    delete copie.unitCost
    delete copie.unitCostTenThousandths
    return copie
  })
}

/**
 * Même projection, appliquée aux PLANS DE RÉAPPROVISIONNEMENT.
 *
 * `ReorderPlan.estimatedCost` est le coût d'achat de la quantité recommandée :
 * divisé par `recommendedOrderQty`, il rend le prix d'achat unitaire — donc la
 * marge, exactement ce que `redactLineCosts` protège sur les documents. Le
 * contrôle posé sur `/api/finance` et `/api/profitability` se contournait en
 * demandant au copilote « quelles pièces sont en rupture ? » : la réponse
 * annonçait « coût estimé 450 € » à n'importe quel rôle authentifié.
 *
 * On RETIRE le champ plutôt que de refuser : savoir QUELLES pièces manquent est
 * un besoin d'atelier légitime pour un mécanicien ; connaître leur prix d'achat
 * ne l'est pas.
 */
export function redactReorderCosts<T extends Record<string, unknown>>(
  plans: T[] | null | undefined,
  role: string | null | undefined,
): T[] {
  if (can(role, 'financial:read')) return plans ?? []
  return (plans ?? []).map((p) => {
    const copie = { ...p }
    delete copie.estimatedCost
    return copie
  })
}
