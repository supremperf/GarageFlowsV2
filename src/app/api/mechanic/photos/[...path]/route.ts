export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic } from '@/lib/mechanic-api'

const PHOTOS_DIR = process.env.GF_PHOTOS_DIR ?? ''

// GET /api/mechanic/photos/<relative-path>
// Sert une photo UNIQUEMENT si elle appartient à une intervention ATTRIBUÉE au
// mécanicien connecté (IDOR bloqué : garageId + mechanicId via la relation Job).
export const GET = withMechanic(async (_req, { params }: { params: { path: string[] } }) => {
  const ctx = await requireMechanic()
  if (!PHOTOS_DIR) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const segments = (params.path ?? []).map((s) => s.replace(/[^a-zA-Z0-9_\-.]/g, ''))
  const relative = segments.join('/')
  if (!relative) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Anti-traversal strict.
  const base = path.resolve(PHOTOS_DIR)
  const fullPath = path.resolve(base, relative)
  const rel = path.relative(base, fullPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // La photo DOIT appartenir à une intervention attribuée à ce mécanicien.
  const owned = await prisma.jobPhoto.count({
    where: { photoPath: relative, garageId: ctx.garageId, job: { mechanicId: ctx.mechanicId } },
  })
  if (owned === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!fs.existsSync(fullPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const buf = fs.readFileSync(fullPath)
  const ext = path.extname(fullPath).slice(1).toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'png' ? 'image/png'
             : ext === 'webp' ? 'image/webp'
             : ext === 'heic' || ext === 'heif' ? 'image/heic'
             : 'application/octet-stream'

  return new NextResponse(buf, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store' },
  })
})
