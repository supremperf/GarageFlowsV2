export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import fs   from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

const PHOTOS_DIR = process.env.GF_PHOTOS_DIR ?? ''

// GET /api/photos/<relative-path> — serve a stored photo.
// SECURITY:
//  1. Authenticated (requireSession) — never public.
//  2. Robust anti-traversal via path.relative (not a fragile startsWith prefix).
//  3. IDOR: the path must be a media RECORDED for the caller's garage
//     (JobPhoto.garageId, InspectionItem.inspection.garageId, ou Garage.logoPath).
export const GET = withAuth(async (_req: Request, { params }: { params: { path: string[] } }) => {
  const session = await requireSession()
  if (!PHOTOS_DIR) {
    return NextResponse.json({ error: 'Photo storage not configured' }, { status: 501 })
  }

  // Sanitize each segment (strip slashes/traversal chars), then rebuild the path.
  const segments = (params.path ?? []).map((s) => s.replace(/[^a-zA-Z0-9_\-.]/g, ''))
  const relative = segments.join('/')
  if (!relative) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Anti-traversal: resolved path MUST stay strictly inside PHOTOS_DIR.
  const base = path.resolve(PHOTOS_DIR)
  const fullPath = path.resolve(base, relative)
  const rel = path.relative(base, fullPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Ownership: the relative path must belong to a resource of THIS garage.
  // Le logo du garage (`Garage.logoPath`, écrit par savePhoto(..., 'logos'))
  // est stocké au même endroit mais n'est ni un JobPhoto ni un InspectionItem :
  // sans ce troisième contrôle il tombait en 404 et le header affichait une
  // image cassée. Le filtre reste borné au garage de la session — aucun
  // relâchement de l'isolation multi-garage.
  const [jobOwned, inspOwned, logoOwned] = await Promise.all([
    prisma.jobPhoto.count({ where: { photoPath: relative, garageId: session.user.garageId } }),
    prisma.inspectionItem.count({ where: { photoPath: relative, inspection: { garageId: session.user.garageId } } }),
    prisma.garage.count({ where: { id: session.user.garageId, logoPath: relative } }),
  ])
  if (jobOwned + inspOwned + logoOwned === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const buf  = fs.readFileSync(fullPath)
  const ext  = path.extname(fullPath).slice(1).toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'png'  ? 'image/png'
             : ext === 'webp' ? 'image/webp'
             : ext === 'gif'  ? 'image/gif'
             : 'application/octet-stream'

  return new NextResponse(buf, {
    headers: {
      'Content-Type':  mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
})
