export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import fs   from 'fs'
import path from 'path'
import { withAuth } from '@/lib/api-helpers'

const PHOTOS_DIR = process.env.GF_PHOTOS_DIR ?? ''

export const GET = withAuth(async (_req: Request, { params }: { params: { path: string[] } }) => {
  if (!PHOTOS_DIR) {
    return NextResponse.json({ error: 'Photo storage not configured' }, { status: 501 })
  }

  // Prevent path traversal. Reject any '..' segment outright (the char-class
  // sanitizer alone kept '.' and '/', so '../' survived), then sanitize.
  const rawSegments = params.path ?? []
  if (rawSegments.some(s => s === '..' || s.includes('..'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const segments = rawSegments.map(s => s.replace(/[^a-zA-Z0-9_\-./]/g, ''))
  const relative = segments.join('/')

  // Containment guard: the resolved path must be the base itself or sit strictly
  // under it. Compare against base + path.sep so a sibling dir sharing the base's
  // name prefix (e.g. "photos-backup") can no longer pass a bare startsWith.
  const base = path.resolve(PHOTOS_DIR)
  const fullPath = path.resolve(base, relative)
  if (fullPath !== base && !fullPath.startsWith(base + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
