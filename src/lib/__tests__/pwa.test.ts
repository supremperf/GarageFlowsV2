import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const readPublic = (p: string) => fs.readFileSync(path.join(root, 'public', p), 'utf8')

describe('PWA — manifeste complet', () => {
  const manifest = JSON.parse(readPublic('manifest.webmanifest'))

  it('possède les champs requis', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toBeTruthy()
    expect(manifest.theme_color).toBeTruthy()
    expect(typeof manifest.id).toBe('string')
  })

  it('fournit des icônes 192 et 512 + au moins une maskable', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose)
    expect(purposes).toContain('maskable')
  })

  it('les fichiers d’icônes existent réellement', () => {
    for (const icon of manifest.icons) {
      const rel = icon.src.replace(/^\//, '')
      expect(fs.existsSync(path.join(root, 'public', rel))).toBe(true)
    }
    expect(fs.existsSync(path.join(root, 'public', 'icons', 'apple-touch-icon.png'))).toBe(true)
  })
})

describe('PWA — service worker sûr', () => {
  const sw = readPublic('sw.js')

  it("N'inclut JAMAIS l'API dans le cache (données authentifiées)", () => {
    // La garde d'exclusion des /api/* doit être présente.
    expect(sw).toMatch(/pathname\.startsWith\(['"]\/api\/['"]\)/)
    expect(sw).toMatch(/return/) // sort avant toute mise en cache
  })

  it('ne met en cache que les GET même-origine', () => {
    expect(sw).toMatch(/request\.method !== ['"]GET['"]/)
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/)
  })

  it('versionne le cache et purge les anciens à l’activation', () => {
    expect(sw).toMatch(/caches\.delete/)
    expect(sw).toMatch(/VERSION/)
  })

  it('fournit une page hors-ligne', () => {
    expect(sw).toContain('/offline.html')
    expect(fs.existsSync(path.join(root, 'public', 'offline.html'))).toBe(true)
  })
})
