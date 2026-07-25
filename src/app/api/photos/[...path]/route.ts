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

  // Prevent path traversal — strip any "." segments (so "..", ".", "…") entirely,
  // then keep only safe characters. This removes the "../" vector before joining.
  const segments = (params.path ?? [])
    .map(s => s.replace(/[^a-zA-Z0-9_\-.]/g, ''))
    .filter(s => s && s !== '.' && s !== '..')
  const relative = segments.join('/')

  // Extra guard: resolve and confirm the final path is strictly inside PHOTOS_DIR.
  // Compare with a trailing separator so a sibling dir ("<root>-evil") can't match.
  const root     = path.resolve(PHOTOS_DIR)
  const fullPath = path.resolve(root, relative)
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
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
