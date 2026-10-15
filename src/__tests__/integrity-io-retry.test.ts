/**
 * Intégrité — anti faux-positif « installation corrompue » (Phase 5/7).
 *
 * Cause racine : au démarrage Windows, app.asar peut être VERROUILLÉ un instant
 * par l'antivirus/l'indexeur/la sauvegarde → la lecture jette EBUSY/EACCES →
 * autrefois compté comme « fichier illisible » → blocage « installation
 * corrompue » alors que le fichier est INTACT (intermittent, sans altération).
 *
 * Prouvé ici :
 *  1. un verrou TRANSITOIRE (EBUSY quelques fois puis OK) → vérification PASSE ;
 *  2. une vraie ALTÉRATION (contenu modifié) → BLOQUÉE (`modified`) ;
 *  3. une vraie SUPPRESSION → BLOQUÉE (`missing`) ;
 *  4. une I/O RÉELLEMENT persistante → fail-closed (`unreadable`) ;
 *  5. la classification des codes d'erreur transitoires.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Module Electron (hors alias @/), importé par chemin relatif.
import * as integrity from '../../electron/integrity.js'

const noSleep = () => {}
let dir: string

function makeResources() {
  dir = mkdtempSync(join(tmpdir(), 'gf-integrity-'))
  writeFileSync(join(dir, 'app.asar'), Buffer.from('CODE APPLICATIF EMPAQUETÉ — contenu immuable'))
  mkdirSync(join(dir, 'keys'), { recursive: true })
  writeFileSync(join(dir, 'keys', 'public.pem'), '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n')
  mkdirSync(join(dir, 'prisma'), { recursive: true })
  writeFileSync(join(dir, 'prisma', 'schema.prisma'), 'datasource db { provider = "sqlite" }')
  mkdirSync(join(dir, 'app.asar.unpacked'), { recursive: true })
  writeFileSync(join(dir, 'app.asar.unpacked', 'engine.node'), Buffer.from([1, 2, 3, 4, 5]))
  // Manifeste signé (HMAC réel via secure-key) couvrant ces fichiers.
  ;(integrity as any).writeManifest(dir, '1.0.0')
}

beforeEach(() => makeResources())
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('integrity.verify — verrou transitoire vs altération réelle', () => {
  it('build intègre → OK', () => {
    const r = (integrity as any).verify(dir)
    expect(r.present).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    expect(r.checked).toBeGreaterThanOrEqual(4)
  })

  it('verrou TRANSITOIRE sur app.asar (EBUSY ×2 puis OK) → PASSE (pas de faux positif)', () => {
    let ebusyLeft = 2
    const io = {
      sleep: noSleep,
      baseDelayMs: 0,
      readFile: (p: string) => {
        if (String(p).endsWith('app.asar') && ebusyLeft > 0) {
          ebusyLeft--
          const e: NodeJS.ErrnoException = new Error('locked by antivirus'); e.code = 'EBUSY'; throw e
        }
        return readFileSync(p)
      },
    }
    const r = (integrity as any).verify(dir, { io })
    expect(ebusyLeft).toBe(0)            // les 2 EBUSY ont bien été rencontrés…
    expect(r.ok).toBe(true)              // …puis absorbés par le réessai
    expect(r.violations).toEqual([])
  })

  it('ALTÉRATION réelle (contenu modifié) → BLOQUÉE (modified) malgré le réessai', () => {
    writeFileSync(join(dir, 'app.asar'), Buffer.from('CODE APPLICATIF ALTÉRÉ PAR UN ATTAQUANT'))
    const r = (integrity as any).verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v.startsWith('modified:'))).toBe(true)
  })

  it('SUPPRESSION réelle d’un fichier critique → BLOQUÉE (missing)', () => {
    rmSync(join(dir, 'keys', 'public.pem'))
    const r = (integrity as any).verify(dir)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v === 'missing:keys/public.pem')).toBe(true)
  })

  it('I/O RÉELLEMENT persistante (EBUSY à chaque tentative) → fail-closed (unreadable)', () => {
    const io = {
      sleep: noSleep,
      baseDelayMs: 0,
      readFile: (p: string) => {
        if (String(p).endsWith('app.asar')) { const e: NodeJS.ErrnoException = new Error('locked'); e.code = 'EBUSY'; throw e }
        return readFileSync(p)
      },
    }
    const r = (integrity as any).verify(dir, { io })
    expect(r.ok).toBe(false)
    expect(r.violations.some((v: string) => v === 'unreadable:app.asar')).toBe(true)
  })
})

describe('integrity.readFileWithRetry / isTransientIoError', () => {
  it('réessaie les codes transitoires puis réussit', () => {
    let left = 3
    const buf = Buffer.from('ok')
    const out = (integrity as any).readFileWithRetry('/x', {
      sleep: noSleep, baseDelayMs: 0, retries: 4,
      readFile: () => { if (left-- > 0) { const e: NodeJS.ErrnoException = new Error('busy'); e.code = 'EACCES'; throw e } return buf },
    })
    expect(out).toBe(buf)
  })

  it('propage IMMÉDIATEMENT une erreur non transitoire (ENOENT)', () => {
    let calls = 0
    expect(() => (integrity as any).readFileWithRetry('/x', {
      sleep: noSleep, retries: 4,
      readFile: () => { calls++; const e: NodeJS.ErrnoException = new Error('nope'); e.code = 'ENOENT'; throw e },
    })).toThrow()
    expect(calls).toBe(1) // aucun réessai pour une erreur non transitoire
  })

  it('propage après épuisement des réessais', () => {
    let calls = 0
    expect(() => (integrity as any).readFileWithRetry('/x', {
      sleep: noSleep, baseDelayMs: 0, retries: 2,
      readFile: () => { calls++; const e: NodeJS.ErrnoException = new Error('busy'); e.code = 'EBUSY'; throw e },
    })).toThrow()
    expect(calls).toBe(3) // 1 essai initial + 2 réessais
  })

  it('classe correctement les codes transitoires', () => {
    for (const code of ['EBUSY', 'EACCES', 'EPERM', 'EMFILE', 'ETXTBSY']) {
      expect((integrity as any).isTransientIoError({ code })).toBe(true)
    }
    for (const code of ['ENOENT', 'EISDIR', undefined]) {
      expect((integrity as any).isTransientIoError({ code })).toBe(false)
    }
    expect((integrity as any).isTransientIoError(null)).toBe(false)
  })
})
