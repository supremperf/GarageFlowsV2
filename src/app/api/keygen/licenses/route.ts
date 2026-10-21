export const dynamic = 'force-dynamic'

/**
 * GET /api/keygen/licenses — état serveur des licences pour l'outil Keygen.
 *
 * POURQUOI : le Keygen affichait des informations qu'il ne pouvait pas connaître
 * (activation, appareils, liaison matérielle réellement enregistrée). Faute de
 * route, il « déduisait » : une licence non activée et une licence expirée
 * affichaient la même chose. Le serveur est la source de vérité — cette route
 * est le seul moyen de la consulter sans session de navigateur.
 *
 * AUTH : en-tête `x-gf-key` == GARAGEFLOW_API_KEY (comparaison à temps
 * constant, longueur minimale 16) — exactement le modèle de
 * `/api/admin/licenses/create`, déjà utilisé par le Keygen. Aucune session
 * navigateur n'est requise.
 *
 * SORTIE : aucune donnée secrète. Le jeton de licence n'est JAMAIS renvoyé
 * (le Keygen le détient déjà localement) ; les appareils sont renvoyés
 * pseudonymisés (deviceId opaque, jamais hwidHash ni tokenHash). Le HWID, lui,
 * est la valeur que la licence porte déjà en clair dans la base — il est utile
 * à l'exploitant pour reconnaître un poste, et n'est pas un secret d'accès.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { listDevices, countActiveDevices } from '@/lib/license/devices'
import { logger } from '@/lib/logger'

const MAX_LICENSES = 2000

/** Comparaison à temps constant (évite l'oracle de timing sur la clé API). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function authorized(req: NextRequest): boolean {
  const serverApiKey = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''
  if (!serverApiKey || serverApiKey.length < 16) return false
  const apiKey = req.headers.get('x-gf-key')?.trim() ?? ''
  if (!apiKey) return false
  return safeEqual(apiKey, serverApiKey)
}

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimit('admin', `keygen-licenses:${clientIpFrom(req)}`)
  if (!rl.ok) return rateLimitResponse(rl)

  if (!authorized(req)) {
    return NextResponse.json({ error: 'Accès refusé — clé API invalide' }, { status: 403 })
  }

  try {
    const keys = await prisma.licenseKey.findMany({
      orderBy: { createdAt: 'desc' },
      take:    MAX_LICENSES,
      select: {
        licenseId:       true,
        customerId:      true,
        licenseType:     true,
        status:          true,
        seats:           true,
        hwid:            true,
        label:           true,
        expiryAt:        true,
        activatedAt:     true,
        lastSeenAt:      true,
        createdAt:       true,
        revokedAt:       true,
        parentLicenseId: true,
      },
    })

    const licenses = await Promise.all(keys.map(async (k: {
      licenseId: string
      customerId: string
      licenseType: string
      status: string
      seats: number | null
      hwid: string | null
      label: string | null
      expiryAt: Date
      activatedAt: Date | null
      lastSeenAt: Date | null
      createdAt: Date
      revokedAt: Date | null
      parentLicenseId: string | null
    }) => {
      const [devices, activeDeviceCount] = await Promise.all([
        listDevices(k.licenseId),
        countActiveDevices(k.licenseId),
      ])
      return {
        licenseId:       k.licenseId,
        customerId:      k.customerId,
        type:            k.licenseType,
        status:          k.status,
        seats:           k.seats,
        label:           k.label,
        hwid:            k.hwid,
        bound:           !!k.hwid,
        expiryAt:        k.expiryAt.toISOString(),
        activatedAt:     k.activatedAt?.toISOString() ?? null,
        lastSeenAt:      k.lastSeenAt?.toISOString() ?? null,
        createdAt:       k.createdAt.toISOString(),
        revokedAt:       k.revokedAt?.toISOString() ?? null,
        parentLicenseId: k.parentLicenseId,
        deviceCount:     devices.length,
        activeDeviceCount,
        devices: devices.map((d) => ({
          deviceId:         d.deviceId,
          status:           d.status,
          name:             d.name,
          platform:         d.platform,
          appVersion:       d.appVersion,
          firstActivatedAt: d.firstActivatedAt.toISOString(),
          lastSeenAt:       d.lastSeenAt.toISOString(),
          revokedAt:        d.revokedAt?.toISOString() ?? null,
        })),
      }
    }))

    return NextResponse.json({
      ok: true,
      count: licenses.length,
      truncated: keys.length === MAX_LICENSES,
      serverTime: new Date().toISOString(),
      licenses,
    })
  } catch (err) {
    // Message neutre : la cause exacte reste côté serveur (journaux), jamais
    // renvoyée à un appelant distant.
    logger.error('[keygen/licenses] erreur base de données', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}
