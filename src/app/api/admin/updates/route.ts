export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
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

/** Taille maximale d'un manifeste : quelques kilo-octets suffisent largement. */
const MANIFEST_MAX_BYTES = 64 * 1024

/**
 * Lit le manifeste signé joint à la publication (fichier `.json` ou champ texte).
 *
 * On ne vérifie PAS la signature ici : la clé publique de vérification vit dans
 * le processus Electron, et c'est lui qui décide d'installer ou non. On se borne
 * à refuser ce qui n'est manifestement pas un manifeste — de sorte qu'un
 * fichier collé par erreur soit signalé au moment de la publication, et non
 * découvert au moment de l'installation sur le poste d'un client.
 */
async function lireManifeste(
  champ: FormDataEntryValue | null,
): Promise<{ value: unknown } | { error: string } | null> {
  if (champ == null) return null

  let texte: string
  if (champ instanceof File) {
    if (champ.size === 0) return null
    if (champ.size > MANIFEST_MAX_BYTES) {
      return { error: 'Manifeste trop volumineux : ce n’est probablement pas le bon fichier.' }
    }
    texte = await champ.text()
  } else {
    texte = String(champ)
  }
  if (!texte.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(texte)
  } catch {
    // Le message désignait `npm run release:manifest`, qui produit un fichier de
    // PROVENANCE DE BUILD (git, toolchain, comptes de tests) — jamais un
    // manifeste signé. L'administrateur téléversait donc consciencieusement le
    // mauvais fichier et se voyait refuser sans savoir lequel prendre.
    return { error: 'Manifeste illisible : un fichier JSON produit par `npm run release:sign` est attendu.' }
  }
  const o = parsed as { manifest?: unknown; signature?: unknown }
  if (!o || typeof o !== 'object' || typeof o.signature !== 'string' || !o.manifest) {
    return {
      error: 'Ce fichier n’est pas un manifeste signé (il doit contenir « manifest » et « signature »). '
        + 'Il est produit par `npm run release:sign` ; `release-manifest.json`, qui décrit le build, ne convient pas.',
    }
  }
  return { value: parsed }
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
    const fileName = `GarageFlows-Setup-${safeVersion}.exe`
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

    // ── MANIFESTE SIGNÉ (facultatif à l'appel, indispensable à l'installation) ──
    // Le processus principal refuse toute installation non signée dès qu'une clé
    // de vérification est embarquée. Publier un installeur SANS son manifeste
    // produisait donc un bouton « Mettre à jour » qui échouait à chaque fois,
    // sans que rien ne l'annonce au moment de la publication (GF31-AUD-042).
    //
    // Le manifeste est produit par l'ÉDITEUR au moment de la release
    // (`npm run release:manifest`) : l'administrateur du garage le téléverse tel
    // quel, il n'a rien à signer lui-même.
    const manifest = await lireManifeste(form.get('manifest'))
    if (manifest && 'error' in manifest) {
      return NextResponse.json({ error: manifest.error }, { status: 400 })
    }

    const meta = {
      hasUpdate:     true,
      latestVersion: version,
      releaseNotes,
      fileName,
      fileSize:      fs.statSync(dest).size,
      downloadPath:  `/api/admin/updates/file/${fileName}`,
      publishedAt:   new Date().toISOString(),
      manifest:      manifest?.value ?? null,
    }
    fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2))
    return NextResponse.json({
      ok: true,
      update: meta,
      // Dit franchement ce qui se passera côté poste, au moment où l'on peut
      // encore corriger — plutôt qu'un échec inexpliqué à l'installation.
      warning: meta.manifest
        ? null
        : "Aucun manifeste signé n'a été joint : les postes dont la vérification "
          + 'de signature est active ne pourront PAS installer cette mise à jour '
          + 'automatiquement (téléchargement manuel seulement).',
    })
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
