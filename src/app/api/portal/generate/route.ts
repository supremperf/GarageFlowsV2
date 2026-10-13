export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { portalSecret } from '@/lib/portal-secret'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortailToken } from '@/lib/portal/routes'
import { buildPortalSnapshot } from '@/lib/portal/snapshot'
import { cloudPost, isDesktopInstance } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'
import { shortId } from '@/lib/sync/garage-auth'

// POST /api/portal/generate — lien portail client, valable 7 jours.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const { jobId } = await req.json()

  if (!jobId) return NextResponse.json({ error: 'jobId requis' }, { status: 400 })
  const garageId = session.user.garageId

  const job = await prisma.job.findFirst({
    where: { id: jobId, garageId },
    select: { id: true },
  })
  if (!job) return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })

  // ── Cas 1 : instance CLOUD ───────────────────────────────────────────────
  // Les données sont déjà là où le client ira les lire : jeton local, rien à
  // publier. Comportement historique, inchangé.
  if (!isDesktopInstance()) {
    return NextResponse.json(await localLink(jobId, garageId))
  }

  // ── Cas 2 : POSTE (Electron) ─────────────────────────────────────────────
  // L'intervention n'existe que dans le SQLite du poste et le jeton local est
  // signé avec le secret d'installation : un lien purement local s'ouvre sur
  // app.garageflows.fr mais renvoie « Token invalide ». On PUBLIE donc
  // l'instantané au cloud, qui signe le jeton et sert la page.
  const snapshot = await buildPortalSnapshot(jobId, garageId)
  if (!snapshot) return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })

  const garageLicense = await prisma.licenseKey.findFirst({
    where: { garageId, status: 'active', licenseType: { not: 'mechanic' } },
    select: { token: true },
    orderBy: { createdAt: 'desc' },
  })

  if (garageLicense?.token) {
    const out = await cloudPost('/api/sync/portal', {
      garageLicense: garageLicense.token,
      garageId,
      jobId,
      payload: snapshot.payload,
    }, 15_000)

    if (out.ok && typeof out.data?.url === 'string' && typeof out.data?.token === 'string') {
      logger.info('[portal/generate] publié au cloud', {
        job: shortId(jobId), garage: shortId(garageId), photosOmises: snapshot.photosOmitted,
      })
      return NextResponse.json({
        token: out.data.token,
        path:  cheminPortailToken(out.data.token),
        url:   out.data.url,
        cloudPublished: true,
        photosOmitted: snapshot.photosOmitted,
      })
    }
    logger.warn('[portal/generate] publication cloud impossible', { job: shortId(jobId), code: out.code ?? 'UNKNOWN' })
  } else {
    logger.warn('[portal/generate] aucune licence garage locale — publication impossible', { garage: shortId(garageId) })
  }

  // Repli HONNÊTE : jeton local. Le lien reste sur le domaine officiel mais ne
  // sera lisible qu'une fois la publication passée ; `cloudPublished:false`
  // permet à l'interface de le dire au lieu d'annoncer un faux succès.
  const local = await localLink(jobId, garageId)
  return NextResponse.json({ ...local, cloudPublished: false })
})

/** Jeton signé localement — lié au couple (intervention, garage), 7 jours. */
async function localLink(jobId: string, garageId: string) {
  const token = await new SignJWT({ typ: 'portal', jobId, garageId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(portalSecret())
  const path = cheminPortailToken(token)
  return { token, path, url: publicUrlFor(path), cloudPublished: true as boolean }
}
