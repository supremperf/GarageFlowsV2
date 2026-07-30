/**
 * Hardware Fingerprint (HWID) — Node.js / Electron only
 *
 * Security rationale:
 *  - Binding a license to hardware prevents easy sharing: you can't simply
 *    copy a license file to another machine and have it work.
 *  - We use 4 independent OS-level components. An attacker would need to
 *    spoof ALL of them simultaneously, which is non-trivial.
 *  - We HASH the combination (SHA-256) so individual hardware identifiers
 *    (MAC address, etc.) are never stored or transmitted — only their digest.
 *  - Binding is verified with a STRICT, exact, constant-time comparison
 *    (see verify.ts:verifyHwid). No partial/tolerant matching: a SHA-256
 *    digest changes entirely on any hardware change, so tolerance would only
 *    weaken the binding. A hardware change requires a re-activation.
 *
 * Returns null in browser context (window exists, process doesn't).
 */

import crypto from 'crypto'

/**
 * Generate a SHA-256 hardware fingerprint from:
 *  1. CPU model of the first logical processor
 *  2. First non-loopback, non-virtual MAC address
 *  3. OS platform + architecture (e.g. "win32-x64")
 *  4. A stable partial hash of the hostname (not the raw hostname — privacy)
 *  5. Windows disk serial number (when available — strongest unique identifier)
 */
export function generateHwid(): string | null {
  // Guard: browser context has no OS access
  if (typeof window !== 'undefined' && typeof (globalThis as any).process === 'undefined') {
    return null
  }

  try {
    const os = require('os') as typeof import('os')

    // 1. CPU model — stable across reboots
    const cpu = (os.cpus()?.[0]?.model ?? 'unknown-cpu').trim()

    // 2. First stable non-loopback MAC address
    let mac = 'unknown-mac'
    outer: for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const net of ifaces ?? []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          mac = net.mac.toLowerCase()
          break outer
        }
      }
    }

    // 3. Platform + arch
    const platform = `${os.platform()}-${os.arch()}`

    // 4. Hostname — hashed for privacy
    const hostnameHash = crypto
      .createHash('sha256')
      .update(os.hostname())
      .digest('hex')
      .slice(0, 16)

    // 5. Windows disk serial — most stable unique identifier, survives NIC changes
    let diskSerial = 'unknown-disk'
    if (os.platform() === 'win32') {
      try {
        const { execSync } = require('child_process') as typeof import('child_process')
        const out = execSync('wmic diskdrive get serialnumber /format:list', {
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString()
        const line = out.split(/\r?\n/).find(l => l.startsWith('SerialNumber='))
        const serial = line?.replace('SerialNumber=', '').trim()
        if (serial && serial.length > 0) diskSerial = serial
      } catch {
        // wmic unavailable (Win 11 22H2+ deprecates it) — fall back gracefully
      }
    }

    const combined = [cpu, mac, platform, hostnameHash, diskSerial].join('||GF2-HWID-SALT||')
    return crypto.createHash('sha256').update(combined).digest('hex')
  } catch {
    return null
  }
}

/**
 * Heuristic VM / sandbox detection.
 *
 * Returns a suspicion score 0–100. The app can choose how to react:
 *  - score > 80: block or strongly warn
 *  - score > 40: log telemetry
 *  - score ≤ 40: allow normally
 *
 * This is intentionally non-exhaustive — sophisticated VMs can bypass it.
 * The goal is to raise the bar for automated cracking farms, not to build
 * an unbreakable sandbox detector.
 */
export function vmSuspicionScore(): number {
  try {
    const os = require('os') as typeof import('os')
    let score = 0

    // Fewer than 2 logical CPUs is common in lightweight VMs
    const cpuCount = os.cpus()?.length ?? 1
    if (cpuCount < 2) score += 20

    // VM-specific strings in CPU model name
    const cpuModel = (os.cpus()?.[0]?.model ?? '').toLowerCase()
    const vmMarkers = ['vmware', 'virtualbox', 'qemu', 'xen', 'hyper-v', 'kvm', 'virtual cpu']
    if (vmMarkers.some(m => cpuModel.includes(m))) score += 40

    // Very low RAM — typical of sandbox VMs (< 2 GB)
    const ramGiB = os.totalmem() / (1024 ** 3)
    if (ramGiB < 2) score += 20

    // Sandbox environment variables (Sandboxie, Wine, compat shims)
    const sandboxVars = ['SANDBOXIE_NT_TIMEOUT', 'WINE_SYSDIR', '__COMPAT_LAYER', 'SANDBOXIE']
    if (sandboxVars.some(v => process.env[v] !== undefined)) score += 30

    return Math.min(score, 100)
  } catch {
    return 0
  }
}
