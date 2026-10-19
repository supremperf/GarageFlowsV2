export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

function dataRoot() {
  return process.env.GF_PHOTOS_DIR ? path.dirname(process.env.GF_PHOTOS_DIR) : process.cwd()
}
const updatesDir = () => path.join(dataRoot(), 'updates')
const metaFile   = () => path.join(dataRoot(), 'gf_update.json')

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')) } catch { return null }
}

// GET /api/admin/updates/file/<name> — sert l'installeur .exe publié.
// Public : les clients téléchargent la mise à jour sans licence admin.
// On ne sert que le fichier référencé dans gf_update.json (pas de path traversal).
export async function GET(_req: NextRequest, { params: pendingParams }: { params: Promise<{ name: string }> }) {
  const params = await pendingParams
  const requested = path.basename(params.name || '')      // neutralise tout ../
  const meta = readMeta()

  if (!meta?.fileName || meta.fileName !== requested) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  }

  const filePath = path.join(updatesDir(), meta.fileName)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Fichier de mise à jour absent' }, { status: 404 })
  }

  const size = fs.statSync(filePath).size
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type':        'application/octet-stream',
      'Content-Length':      String(size),
      'Content-Disposition': `attachment; filename="${meta.fileName}"`,
      'Cache-Control':       'no-store',
    },
  })
}
