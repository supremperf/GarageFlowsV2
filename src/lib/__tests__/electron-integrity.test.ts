import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Module CommonJS du process Electron (vérification d'intégrité anti-altération).
const integrity = require('../../../electron/integrity.js')

// ── Résolution du mode : la SÉCURITÉ ne dépend que de app.isPackaged ───────────
describe('resolveIntegrityMode — un build packagé applique toujours enforce', () => {
  it('packagé + aucune demande → enforce', () => {
    expect(integrity.resolveIntegrityMode({ isPackaged: true, requested: undefined }))
      .toEqual({ mode: 'enforce', downgradeIgnored: false })
  })

  it('packagé + demande "audit" → enforce (rétrogradation IGNORÉE)', () => {
    const r = integrity.resolveIntegrityMode({ isPackaged: true, requested: 'audit' })
    expect(r.mode).toBe('enforce')
    expect(r.downgradeIgnored).toBe(true)
  })

  it('packagé + demande "off" → enforce (rétrogradation IGNORÉE)', () => {
    const r = integrity.resolveIntegrityMode({ isPackaged: true, requested: 'off' })
    expect(r.mode).toBe('enforce')
    expect(r.downgradeIgnored).toBe(true)
  })

  it('packagé + valeur inconnue → enforce', () => {
    expect(integrity.resolveIntegrityMode({ isPackaged: true, requested: 'nonsense' }).mode).toBe('enforce')
  })

  it('NON packagé (dev) + aucune demande → off (ne bloque pas le développement)', () => {
    expect(integrity.resolveIntegrityMode({ isPackaged: false, requested: undefined }))
      .toEqual({ mode: 'off', downgradeIgnored: false })
  })

  it('NON packagé + demande "enforce" → enforce (permet de tester)', () => {
    expect(integrity.resolveIntegrityMode({ isPackaged: false, requested: 'enforce' }).mode).toBe('enforce')
  })

  it('NON packagé + demande "audit" → audit', () => {
    expect(integrity.resolveIntegrityMode({ isPackaged: false, requested: 'audit' }).mode).toBe('audit')
  })
})

// ── Vérification du manifeste : détection réelle des altérations ───────────────
describe('verify — détecte les altérations des fichiers critiques', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-integrity-'))
    // Reconstitue une arborescence "resources" packagée minimale.
    fs.writeFileSync(path.join(dir, 'app.asar'), 'FAKE ASAR CONTENT v1')
    fs.mkdirSync(path.join(dir, 'keys'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'keys', 'public.pem'), '-----PUBLIC KEY-----')
    fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'model X {}')
    fs.mkdirSync(path.join(dir, 'app.asar.unpacked', 'native'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.asar.unpacked', 'native', 'engine.node'), 'BINARY')
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('un build intact est vérifié OK', () => {
    integrity.writeManifest(dir, '2.0.0')
    const r = integrity.verify(dir)
    expect(r.present).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.checked).toBeGreaterThanOrEqual(4)
    expect(r.violations).toHaveLength(0)
  })

  it('un app.asar MODIFIÉ est détecté et refusé', () => {
    integrity.writeManifest(dir, '2.0.0')
    fs.writeFileSync(path.join(dir, 'app.asar'), 'FAKE ASAR CONTENT v1 TAMPERED')
    const r = integrity.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v.startsWith('modified:app.asar'))).toBe(true)
  })

  it('un module natif déballé MODIFIÉ est détecté', () => {
    integrity.writeManifest(dir, '2.0.0')
    fs.writeFileSync(path.join(dir, 'app.asar.unpacked', 'native', 'engine.node'), 'BINARY PATCHED')
    const r = integrity.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v.startsWith('modified:'))).toBe(true)
  })

  it('un fichier critique SUPPRIMÉ est détecté', () => {
    integrity.writeManifest(dir, '2.0.0')
    fs.rmSync(path.join(dir, 'keys', 'public.pem'))
    const r = integrity.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v.startsWith('missing:keys/public.pem'))).toBe(true)
  })

  it('un manifeste FALSIFIÉ (MAC invalide) est rejeté', () => {
    integrity.writeManifest(dir, '2.0.0')
    const mp = path.join(dir, integrity.MANIFEST_NAME)
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
    // Modifie l'empreinte attendue sans recalculer le MAC → MAC invalide.
    m.files[0].sha256 = '0'.repeat(64)
    fs.writeFileSync(mp, JSON.stringify(m))
    const r = integrity.verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations).toContain('manifest-mac')
  })

  it('sans manifeste, present=false (le runtime décide alors selon le mode)', () => {
    const r = integrity.verify(dir)
    expect(r.present).toBe(false)
  })
})
