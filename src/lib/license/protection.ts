/**
 * GarageFlow Anti-Debug / Anti-Tamper Protection
 * Electron main-process only (Node.js) — never imported by the renderer
 *
 * Techniques and rationale:
 *
 *  1. Node.js inspector detection
 *     The V8 inspector protocol is the standard way to attach a debugger
 *     (VSCode, Chrome DevTools, --inspect flag). We detect it via the
 *     `inspector` built-in module.
 *
 *  2. Process flag inspection
 *     --inspect, --inspect-brk, --debug flags in process.execArgv indicate
 *     a debugger was attached at launch.
 *
 *  3. Timing-based detection
 *     Debuggers (especially with breakpoints) cause measurable delays in a
 *     tight computation loop. > 100ms for 10k iterations is anomalous.
 *
 *  4. DevTools prevention (Electron BrowserWindow)
 *     We close DevTools if opened in a production build. Developers can
 *     still use them in dev mode (ELECTRON_DEV=1 or NODE_ENV=development).
 *
 *  5. Critical file integrity
 *     Hash verify.ts at startup. If someone patches the compiled bundle to
 *     always return { valid: true }, the hash won't match our reference.
 *     (Reference hashes must be updated after each legitimate build.)
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// ─── 1. Inspector / debugger detection ───────────────────────────────────────
export function isDebuggerAttached(): boolean {
  // Check Node.js inspector URL (non-null = debugger connected)
  try {
    const inspector = require('inspector') as typeof import('inspector')
    if (inspector.url()) return true
  } catch { /* not available */ }

  // Check launch flags
  const flags = process.execArgv.join(' ')
  if (flags.includes('--inspect') || flags.includes('--debug')) return true

  // Check environment variable set by some IDEs
  if (process.env.NODE_INSPECTOR_IPC) return true

  return false
}

// ─── 3. Timing anomaly ────────────────────────────────────────────────────────
/**
 * Run a tight loop and measure elapsed time.
 * Normal execution: < 10ms for 10k iterations.
 * Under a breakpoint-heavy debugger: often > 500ms.
 * We use a conservative 200ms threshold to avoid false positives on
 * very slow / heavily loaded machines.
 */
export function detectTimingAnomaly(): boolean {
  const t0 = Date.now()
  let acc = 0
  for (let i = 0; i < 10_000; i++) acc ^= i * 7 + 3
  void acc // prevent dead-code elimination
  return (Date.now() - t0) > 200
}

// ─── 5. File integrity ────────────────────────────────────────────────────────
/**
 * Compute SHA-256 of a source file.
 * Call at startup and compare against a known-good hash stored at build time.
 * If the hash doesn't match, someone tampered with the file after building.
 */
export function hashFile(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(buf).digest('hex')
  } catch {
    return null
  }
}

// ─── Full startup check ───────────────────────────────────────────────────────
export interface ProtectionReport {
  safe:     boolean
  warnings: string[]
}

/**
 * Run all protection checks.
 * In development (NODE_ENV !== 'production') only warnings are logged;
 * the `safe` flag is always true so you can develop normally.
 */
export function runProtectionCheck(): ProtectionReport {
  const warnings: string[] = []
  const isDev = process.env.NODE_ENV !== 'production' && process.env.ELECTRON_DEV === '1'

  // Check 1: debugger
  if (isDebuggerAttached()) {
    warnings.push('Debugger attached')
    if (!isDev) {
      return { safe: false, warnings }
    }
  }

  // Check 3: timing (non-fatal — too many false positives in the wild)
  if (detectTimingAnomaly()) {
    warnings.push('Timing anomaly detected (possible debugger or very slow machine)')
  }

  // Check 4: unpackaged Electron in production
  if (!isDev) {
    try {
      const electron = require('electron')
      const app = (electron.app ?? electron.default?.app) as { isPackaged: boolean } | undefined
      if (app && !app.isPackaged) {
        warnings.push('Running unpackaged in production mode')
      }
    } catch { /* not in Electron or already handled */ }
  }

  return { safe: true, warnings }
}

// ─── 4. DevTools prevention ───────────────────────────────────────────────────
/**
 * Install DevTools block on an Electron BrowserWindow.
 * Pass the raw `win.webContents` object.
 * No-op in dev mode (ELECTRON_DEV=1).
 */
export function blockDevTools(webContents: {
  on: (event: string, cb: () => void) => void
  closeDevTools?: () => void
}): void {
  const isDev = process.env.NODE_ENV !== 'production' || process.env.ELECTRON_DEV === '1'
  if (isDev) return

  webContents.on('devtools-opened', () => {
    webContents.closeDevTools?.()
  })
}
