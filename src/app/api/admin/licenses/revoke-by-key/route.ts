export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/licenses/revoke-by-key
 *
 * Programmatic endpoint used by the keygen_gui.py admin tool to update
 * license status in real-time without a browser session.
 *
 * Auth: x-gf-key header must match GARAGEFLOW_API_KEY.
 * Body: { licenseId: string, status: 'active' | 'revoked' | 'suspended' }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { computeRecordMac } from '@/lib/license/record-mac'
import { canTransitionLicense } from '@/lib/license/state-machine'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

const VALID_STATUSES = ['active', 'revoked', 'suspended'] as const
type Status = typeof VALID_STATUSES[number]

/** Comparaison à temps constant (évite l'oracle de timing sur la clé API). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export async function POST(req: NextRequest) {
  // Défense en profondeur (§5) : limite le débit AVANT toute comparaison — réduit
  // la surface de brute-force sur la clé API réseau-accessible.
  //
  // MAIS cette route est appelée par l'outillage de CONFIANCE (keygen, script de
  // reset) authentifié par une clé API forte à comparaison à temps constant. Un
  // repli fail-closed (503) sur indisponibilité d'Upstash bloquerait le reset —
  // qui rote justement Upstash — au moment où il teste cette route (chicken-and-egg
  // observé en production). On rejette donc UNIQUEMENT une vraie limite atteinte
  // (429) ; l'indisponibilité du backend (fail_closed) est laissée passer, la clé
  // API restant le contrôle d'accès fort.
  const rl = await enforceRateLimit('admin', clientIpFrom(req))
  if (!rl.ok && rl.degraded !== 'fail_closed') return rateLimitResponse(rl)

  // Auth : compare x-gf-key à GARAGEFLOW_API_KEY (temps constant).
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''

  // Refuse une clé serveur absente OU trop faible (pas de contrôle d'accès mou).
  if (!serverApiKey || serverApiKey.length < 16) {
    console.error('[admin/licenses/revoke-by-key] GARAGEFLOW_API_KEY absente ou trop faible')
    return NextResponse.json(
      { error: 'Configuration serveur incomplète (GARAGEFLOW_API_KEY).' },
      { status: 500 }
    )
  }

  if (!apiKey || !safeEqual(apiKey, serverApiKey)) {
    return NextResponse.json(
      { error: 'Accès refusé — clé API invalide' },
      { status: 403 }
    )
  }

  let licenseId: string
  let status: Status
  let confirmReactivation: unknown
  let reason: unknown

  try {
    const body = await req.json()

    licenseId = String(body.licenseId ?? '').trim()
    status = body.status as Status
    // Sortir de `revoked` exige un geste DÉDIÉ et un motif (GF-DUR-048).
    confirmReactivation = body.confirmReactivation
    reason = body.reason
    // SÉCURITÉ : ne jamais journaliser DATABASE_URL ni de secret. Trace minimale.
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête invalide' },
      { status: 400 }
    )
  }

  if (!licenseId) {
    return NextResponse.json(
      { error: 'licenseId manquant' },
      { status: 400 }
    )
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status invalide — valeurs autorisées : ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const record = await prisma.licenseKey.findUnique({
      where: { licenseId },
    })

    // Licence non encore enregistrée côté serveur
    if (!record) {
      if (status === 'active') {
        return NextResponse.json({
          ok: true,
          licenseId,
          status,
          note: 'not_registered',
        })
      }

      const expiryAt = new Date('2099-12-31T23:59:59.000Z')
      const token = `pending:${licenseId}`

      const tombMac = computeRecordMac({
        licenseId,
        token,
        status,
        expiryAt,
        hwid: null,
      })

      const created = await prisma.licenseKey.create({
        data: {
          licenseId,
          token,
          customerId: 'pending',
          licenseType: 'standard',
          expiryAt,
          status,
          revokedAt: status === 'revoked' ? new Date() : null,
          recordMac: tombMac,
          label:
            status === 'revoked'
              ? 'Révoquée avant activation'
              : 'Suspendue avant activation',
        },
      })

      return NextResponse.json({
        ok: true,
        created: true,
        licenseId: created.licenseId,
        status: created.status,
        label: created.label,
      })
    }

    /**
     * MÊME MACHINE À ÉTATS QUE `PATCH /api/admin/licenses/[id]` (GF-DUR-048).
     *
     * Cette route écrivait `status` DIRECTEMENT, sans consulter l'état courant.
     * `revoked → active` y était donc une écriture de champ ordinaire — et elle
     * effaçait même `revokedAt`. Or `revoked` est TERMINAL depuis le LOT 1 : il
     * n'en sort que par une action d'administration explicite, avec drapeau de
     * confirmation ET motif obligatoire.
     *
     * La protection existait, mais sur UNE seule des deux routes qui changent
     * l'état d'une licence. Une garde qu'un second chemin contourne ne garde
     * rien : l'outil keygen pouvait réactiver ce que l'interface d'admin
     * refusait.
     *
     * On passe donc par le même verdict, avec les mêmes exigences. Le corps
     * accepte `confirmReactivation` et `reason` pour le cas légitime.
     */
    const verdict = canTransitionLicense({
      from: record.status,
      to: status,
      confirmReactivation: confirmReactivation === true,
      reason,
    })
    if (!verdict.ok) {
      return NextResponse.json(
        { error: verdict.message, code: verdict.code },
        { status: verdict.code === 'REVOKED_IS_FINAL' ? 409 : 400 },
      )
    }

    // Même exigence que PATCH /api/admin/licenses/[id] : les champs MÉCANICIEN
    // entrent dans le message signé dès qu'ils sont non nuls. Les omettre
    // produisait un MAC incohérent avec celui que `verifyRecordMac` recalcule
    // depuis la ligne, si bien que révoquer puis réactiver une clé mécanicien
    // attribuée la laissait vue comme « altérée » (GF31-AUD-006).
    const newMac = computeRecordMac({
      licenseId: record.licenseId,
      token: record.token,
      status,
      expiryAt: record.expiryAt,
      hwid: record.hwid ?? null,
      parentLicenseId: record.parentLicenseId ?? null,
      mechanicId: record.mechanicId ?? null,
    })

    const updated = await prisma.licenseKey.update({
      where: {
        id: record.id,
      },
      data: {
        status,
        revokedAt:
          status === 'revoked'
            ? new Date()
            : status === 'active'
            ? null
            : undefined,
        recordMac: newMac,
      },
    })

    // Trace de la transition (GF-DUR-047) — même journal que `[id]`, jamais de
    // jeton ni de clé. Best-effort : une table d'audit indisponible ne doit pas
    // annuler une révocation déjà engagée, mais l'écart est signalé.
    await prisma.licenseDeviceEvent.create({
      data: {
        licenseId: updated.licenseId,
        deviceId:  null,
        action:    status === 'revoked' ? 'revoked' : status === 'suspended' ? 'suspended' : 'reactivated',
        detail: JSON.stringify({
          from:   record.status,
          to:     status,
          actor:  'keygen (x-gf-key)',
          reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
          at:     new Date().toISOString(),
        }),
      },
    }).catch((e) => {
      console.error('[admin/licenses/revoke-by-key] trace non écrite', e)
    })

    return NextResponse.json({
      ok: true,
      licenseId: updated.licenseId,
      status: updated.status,
      label: updated.label,
    })
  } catch (err) {
    // Ne jamais renvoyer le message d'erreur brut (fuite d'infos internes).
    console.error('[admin/licenses/revoke-by-key] erreur base de données')
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}