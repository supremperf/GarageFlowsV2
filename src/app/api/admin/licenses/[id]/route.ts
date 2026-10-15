export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/licenses/[id]  — update status / label / notes / hwid
 * DELETE /api/admin/licenses/[id] — remove key from registry
 *
 * ── Machine à états (voir src/lib/license/state-machine.ts) ──────────────────
 * Le statut n'est plus une chaîne libre écrite telle quelle. Trois défauts
 * corrigés ici :
 *
 *  1. `revoked → active` était une écriture de champ ordinaire, indiscernable
 *     d'un changement de libellé, sans acteur ni motif ni trace. La révocation
 *     n'était donc pas terminale. Elle exige désormais un geste DÉDIÉ
 *     (`confirmReactivation: true`) ET un motif, et laisse un événement d'audit.
 *
 *  2. `status` n'était typé qu'à la COMPILATION : `req.json()` ne valide rien à
 *     l'exécution. `{"status":"Revoked"}` était persisté puis scellé par un
 *     `recordMac` recalculé — donc « intègre ». Or toute la chaîne de contrôle
 *     compare par égalité stricte : une telle valeur ne déclenchait aucun refus
 *     et `/api/license/check` retombait sur « still active ». La licence
 *     s'affichait « Revoked » et ouvrait l'accès complet. Validation d'exécution
 *     désormais obligatoire.
 *
 *  3. `DELETE` supprimait la ligne — or `/api/license/activate` interprète
 *     l'ABSENCE de ligne comme un premier usage et la recrée en `active`.
 *     Supprimer une licence révoquée la ressuscitait au prochain démarrage du
 *     poste, exactement ce que la pierre tombale de `/revoke-by-key` cherche à
 *     empêcher. Seule une licence `active` peut désormais être retirée.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { isAdminSession, adminSessionActor } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { computeRecordMac } from '@/lib/license/record-mac'
import {
  canTransitionLicense,
  auditActionFor,
  type SettableLicenseState,
} from '@/lib/license/state-machine'

/** Refus métier porté hors de la transaction sans perdre son code. */
class TransitionRefused extends Error {
  constructor(readonly code: string, readonly httpStatus: number, message: string) {
    super(message)
    this.name = 'TransitionRefused'
  }
}

interface Transition {
  from: string
  to: SettableLicenseState
  kind: 'noop' | 'normal' | 'reactivation'
}

/** Événement d'audit d'une transition de licence (jamais de secret, jamais de jeton). */
function evenementAudit(
  licenseId: string,
  transition: Transition,
  acteur: string | null,
  motif: unknown,
) {
  return {
    licenseId,
    deviceId: null, // événement de LICENCE, pas d'appareil
    action:   auditActionFor(transition.to, transition.kind),
    detail:   JSON.stringify({
      from:   transition.from,
      to:     transition.to,
      actor:  acteur ?? 'admin',
      reason: typeof motif === 'string' ? motif.slice(0, 500) : null,
      at:     new Date().toISOString(),
    }),
  }
}

export async function PATCH(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ id: string }> }
) {
  const params = await pendingParams
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Limitation de débit (GF-DUR-045). Cette route pilote les TRANSITIONS d'état
  // d'une licence — suspendre, révoquer, réactiver. `create` et `revoke-by-key`
  // en portaient une, pas elle : une session admin volée pouvait donc révoquer
  // le parc entier en boucle, chaque appel coupant un client.
  const rl = await enforceRateLimit('admin', `license-transition:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID invalide' }, { status: 400 })
  }

  let body: {
    status?:  unknown
    label?:   string | null
    notes?:   string | null
    hwid?:    string | null
    /** Geste dédié exigé pour sortir de l'état terminal `revoked`. */
    confirmReactivation?: unknown
    /** Motif — obligatoire pour une réactivation, journalisé dans tous les cas. */
    reason?:  unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.label !== undefined) data.label = body.label
  if (body.notes !== undefined) data.notes = body.notes
  if (body.hwid  !== undefined) data.hwid  = body.hwid

  const acteur = await adminSessionActor()

  // Remonté hors de la transaction pour le journal best-effort des transitions
  // PROTECTRICES, écrit une fois la coupure d'accès effectivement engagée.
  // Porté par un objet et non par un `let` : TypeScript ne suit pas les
  // affectations faites dans une closure et réduirait la variable à `null` au
  // point de lecture.
  const differe: { protectrice: { licenseId: string; transition: Transition } | null } = { protectrice: null }

  try {
    // ATOMIQUE : lecture + décision de transition + recalcul du recordMac +
    // écriture + journal, sous verrou de ligne. Décider hors transaction
    // laisserait deux réactivations concurrentes lire le même `revoked` ; et
    // deux éditions concurrentes de la MÊME clé sur des champs DIFFÉRENTS
    // (ex. status vs hwid) pouvaient laisser un recordMac calculé sur un état
    // périmé → MAC incohérent → licence considérée « tampered » et bloquée.
    const updated = await prisma.$transaction(async (tx) => {
      if (isPostgresDatabase()) {
        // Sérialise les éditions concurrentes de cette licence (PostgreSQL).
        await tx.$executeRaw`SELECT "id" FROM "LicenseKey" WHERE "id" = ${id} FOR UPDATE`
      }

      let transition: { to: SettableLicenseState; kind: 'noop' | 'normal' | 'reactivation'; from: string } | null = null

      // Re-compute MAC whenever security-critical fields may have changed
      if (body.status !== undefined || body.hwid !== undefined) {
        const current = await tx.licenseKey.findUnique({ where: { id } })
        if (!current) throw Object.assign(new Error('not found'), { code: 'P2025' })

        if (body.status !== undefined) {
          const verdict = canTransitionLicense({
            from: current.status,
            to: body.status,
            confirmReactivation: body.confirmReactivation === true,
            reason: body.reason,
          })
          if (!verdict.ok) {
            // 400 pour une valeur inacceptable, 409 pour un conflit d'état.
            throw new TransitionRefused(verdict.code, verdict.code === 'INVALID_STATUS' ? 400 : 409, verdict.message)
          }
          const cible = body.status as SettableLicenseState
          transition = { to: cible, kind: verdict.kind, from: current.status }

          data.status = cible
          if (cible === 'revoked') data.revokedAt = new Date()
          if (cible === 'active')  data.revokedAt = null
        }

        // Les champs MÉCANICIEN (parentLicenseId, mechanicId) font partie du
        // message signé dès qu'ils sont non nuls. Les omettre ici produisait un
        // MAC calculé sur un message PLUS COURT que celui que `verifyRecordMac`
        // reconstruit ensuite à partir de la ligne réelle : toute suspension,
        // réactivation ou modification de HWID d'une clé mécanicien attribuée
        // laissait donc la licence définitivement vue comme « altérée »
        // (`MECHANIC_LICENSE_TAMPERED`) — GF31-AUD-006.
        data.recordMac = computeRecordMac({
          licenseId: current.licenseId,
          token:     current.token,
          status:    (transition ? transition.to : current.status) as string,
          expiryAt:  current.expiryAt,
          hwid:      (body.hwid !== undefined ? body.hwid : current.hwid) ?? null,
          parentLicenseId: current.parentLicenseId ?? null,
          mechanicId:      current.mechanicId ?? null,
        })

        // ── Journal du cycle de vie ──────────────────────────────────────────
        // Une transition de statut doit être traçable : qui, quand, depuis quel
        // état, vers quel état, pourquoi. Sans cela, « la licence est redevenue
        // active » reste une affirmation invérifiable.
        //
        // Deux régimes, délibérément dissymétriques :
        //  - transition PERMISSIVE (vers `active`) → journal FAIL-CLOSED, écrit
        //    DANS la transaction, avant la mise à jour : pas de trace, pas de
        //    réactivation. Une réactivation intraçable est précisément ce qu'on
        //    cherche à rendre impossible.
        //  - transition PROTECTRICE (vers `suspended`/`revoked`) → journal
        //    best-effort APRÈS la transaction : une table d'audit indisponible
        //    ne doit jamais empêcher de couper un accès.
        // Aucun changement de statut effectif → aucun événement (renommer un
        // libellé n'est pas un événement de cycle de vie).
        if (transition && transition.kind !== 'noop') {
          if (transition.to === 'active') {
            await tx.licenseDeviceEvent.create({ data: evenementAudit(current.licenseId, transition, acteur, body.reason) })
          } else {
            differe.protectrice = { licenseId: current.licenseId, transition }
          }
        }

        return await tx.licenseKey.update({ where: { id }, data })
      }

      // Aucun champ sensible touché : mise à jour simple, aucun MAC à recalculer.
      return tx.licenseKey.update({ where: { id }, data })
    })

    // Journal best-effort des coupures d'accès : la sanction est déjà appliquée,
    // un journal indisponible ne doit pas la faire échouer — mais son échec doit
    // être bruyant, sans quoi la trace disparaîtrait en silence.
    if (differe.protectrice) {
      const { licenseId, transition } = differe.protectrice
      try {
        await prisma.licenseDeviceEvent.create({ data: evenementAudit(licenseId, transition, acteur, body.reason) })
      } catch (auditErr) {
        logger.error('[admin/licenses/patch] transition appliquée mais NON journalisée', {
          licenseId, from: transition.from, to: transition.to, auditErr,
        })
      }
    }

    return NextResponse.json(updated)
  } catch (err: any) {
    if (err instanceof TransitionRefused) {
      logger.warn('[admin/licenses/patch] transition refusée', { id, code: err.code })
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus })
    }
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Licence introuvable' }, { status: 404 })
    }
    logger.error('[admin/licenses/patch] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params: pendingParams }: { params: Promise<{ id: string }> }
) {
  const params = await pendingParams
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Même raison que pour PATCH : suppression d'enregistrement de licence.
  const rl = await enforceRateLimit('admin', `license-delete:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  const id = parseInt(params.id, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID invalide' }, { status: 400 })
  }

  try {
    // Supprimer la ligne d'une licence BLOQUÉE la réactive : `/api/license/activate`
    // traite l'absence d'enregistrement comme un premier usage et recrée la
    // licence avec `status:'active'`. La suppression est donc réservée aux
    // licences actives — pour les autres, l'enregistrement EST la sanction.
    const current = await prisma.licenseKey.findUnique({ where: { id } })
    if (!current) {
      return NextResponse.json({ error: 'Licence introuvable' }, { status: 404 })
    }
    if (current.status !== 'active') {
      const revoquee = current.status === 'revoked'
      logger.warn('[admin/licenses/delete] suppression refusée (licence bloquée)', { id, status: current.status })
      return NextResponse.json(
        {
          error: revoquee
            ? 'Une licence révoquée ne peut pas être supprimée : la supprimer la réactiverait à la prochaine activation du poste.'
            : 'Cette licence n\'est pas active : la supprimer lèverait le blocage à la prochaine activation du poste.',
          code: revoquee ? 'REVOKED_CANNOT_BE_DELETED' : 'BLOCKED_LICENSE_CANNOT_BE_DELETED',
        },
        { status: 409 },
      )
    }

    await prisma.licenseKey.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Licence introuvable' }, { status: 404 })
    }
    logger.error('[admin/licenses/delete] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}
