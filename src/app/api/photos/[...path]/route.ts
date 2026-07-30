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

  // Prevent path traversal — only allow alphanumerics, dashes, underscores, dots, slashes
  const segments = (params.path ?? []).map(s => s.replace(/[^a-zA-Z0-9_\-./]/g, ''))
  const relative = segments.join('/')

  // Extra guard: resolve and confirm the final path is still inside PHOTOS_DIR.
  // Compare against base + path separator so a sibling dir sharing the prefix
  // (e.g. "/data/photos-secret" vs base "/data/photos") cannot pass the check.
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
