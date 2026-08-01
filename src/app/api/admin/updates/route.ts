export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { BRAND } from '@/config/brand'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { isAdminSession } from '@/lib/api-helpers'

// Répertoire de données persistant (userData en Electron, cwd en dev).
function dataRoot() {
  return process.env.GF_PHOTOS_DIR ? path.dirname(process.env.GF_PHOTOS_DIR) : process.cwd()
}
const updatesDir = () => path.join(dataRoot(), 'updates')
const metaFile   = () => path.join(dataRoot(), 'gf_update.json')

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')) } catch { return null }
}

// GET — public : renvoie l'info de mise à jour courante (utilisé par checkUpdates).
export async function GET() {
  return NextResponse.json(readMeta() ?? { hasUpdate: false })
}

// POST — admin uniquement : publie une mise à jour.
//   • multipart/form-data → téléverse directement le .exe (nouveau flux)
//   • application/json     → publie une URL (rétro-compatibilité)
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: 'Accès refusé — licence administrateur requise' }, { status: 403 })
  }

  const ctype = req.headers.get('content-type') || ''

  // ── Téléversement direct du .exe ──────────────────────────────────────────
  if (ctype.includes('multipart/form-data')) {
    const form = await req.formData()
    const version      = String(form.get('version') || '').trim()
    const releaseNotes = String(form.get('releaseNotes') || '').trim() || null
    const file         = form.get('file')

    if (!version) return NextResponse.json({ error: 'Numéro de version requis' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'Fichier .exe requis' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.exe')) {
      return NextResponse.json({ error: 'Le fichier doit être un installeur .exe' }, { status: 400 })
    }

    fs.mkdirSync(updatesDir(), { recursive: true })
    // On ne garde qu'un seul installeur (le dernier publié).
    for (const f of fs.readdirSync(updatesDir())) {
      try { fs.unlinkSync(path.join(updatesDir(), f)) } catch { /* ignore */ }
    }

    const safeVersion = version.replace(/[^0-9A-Za-z._-]/g, '') || 'latest'
    const fileName = `${BRAND.packaging.executableName}-Setup-${safeVersion}.exe`
    const dest = path.join(updatesDir(), fileName)

    // Écriture en flux vers le disque (pas de mise en mémoire du fichier entier).
    await new Promise<void>((resolve, reject) => {
      const nodeStream = Readable.fromWeb(file.stream() as unknown as import('stream/web').ReadableStream)
      const ws = fs.createWriteStream(dest)
      nodeStream.on('error', reject)
      ws.on('error', reject)
      ws.on('finish', () => resolve())
      nodeStream.pipe(ws)
    })

    const meta = {
      hasUpdate:     true,
      latestVersion: version,
      releaseNotes,
      fileName,
      fileSize:      fs.statSync(dest).size,
      downloadPath:  `/api/admin/updates/file/${fileName}`,
      publishedAt:   new Date().toISOString(),
    }
    fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2))
    return NextResponse.json({ ok: true, update: meta })
  }

  // ── Publication par URL (rétro-compatibilité) ─────────────────────────────
  const body = await req.json().catch(() => ({}))
  const version = String(body.version || '').trim()
  if (!version) return NextResponse.json({ error: 'Numéro de version requis' }, { status: 400 })

  const meta = {
    hasUpdate:     true,
    latestVersion: version,
    releaseNotes:  body.releaseNotes ?? null,
    releaseUrl:    body.releaseUrl ?? null,
    publishedAt:   new Date().toISOString(),
  }
  fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2))
  return NextResponse.json({ ok: true, update: meta })
}
