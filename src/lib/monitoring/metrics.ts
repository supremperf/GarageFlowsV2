/**
 * Phase 1 — Infrastructure monitoring.
 *
 * Collects real host + process + database metrics (CPU load, memory, disk,
 * uptime, DB latency) and grades them against thresholds. The grading logic
 * ({@link statusForValue}, {@link overallStatus}) is pure and unit-tested; the
 * collectors read Node's `os`/`process`/`fs` and Prisma. Nothing is simulated —
 * an unavailable metric (e.g. disk stats on some platforms) is reported as null.
 */

import os from 'os'
import fs from 'fs'

export type HealthStatus = 'ok' | 'warning' | 'critical'

export interface Threshold {
  warn: number
  crit: number
}

export interface MonitoringThresholds {
  cpu: Threshold
  memory: Threshold
  disk: Threshold
  dbLatencyMs: Threshold
}

export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  cpu: { warn: 75, crit: 90 },
  memory: { warn: 80, crit: 92 },
  disk: { warn: 80, crit: 92 },
  dbLatencyMs: { warn: 200, crit: 1000 },
}

/** Grade a value against warn/crit thresholds (higher = worse). */
export function statusForValue(value: number, t: Threshold): HealthStatus {
  if (value >= t.crit) return 'critical'
  if (value >= t.warn) return 'warning'
  return 'ok'
}

/** Combine component statuses into an overall status (worst wins). */
export function overallStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('critical')) return 'critical'
  if (statuses.includes('warning')) return 'warning'
  return 'ok'
}

const round1 = (n: number): number => Math.round(n * 10) / 10
const toMB = (bytes: number): number => Math.round(bytes / (1024 * 1024))

export interface CpuMetrics {
  cores: number
  /** 1-minute load average as a % of core count (can exceed 100). */
  loadPct: number
  loadAvg: [number, number, number]
}

export interface MemoryMetrics {
  totalMB: number
  freeMB: number
  usedMB: number
  usedPct: number
}

export interface DiskMetrics {
  totalMB: number
  freeMB: number
  usedMB: number
  usedPct: number
}

export interface SystemMetrics {
  platform: string
  uptimeSec: number
  cpu: CpuMetrics
  memory: MemoryMetrics
  /** null when the platform does not expose filesystem stats. */
  disk: DiskMetrics | null
}

/** Read host CPU / memory / disk / uptime metrics. */
export function collectSystemMetrics(mountPath = '.'): SystemMetrics {
  const cores = os.cpus().length || 1
  const load = os.loadavg() as [number, number, number]
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  let disk: DiskMetrics | null = null
  try {
    // fs.statfsSync is available on Node ≥ 18.15; guard for older/edge runtimes.
    const statfs = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync
    if (statfs) {
      const s = statfs(mountPath)
      const total = s.bsize * s.blocks
      const free = s.bsize * s.bavail
      disk = { totalMB: toMB(total), freeMB: toMB(free), usedMB: toMB(total - free), usedPct: total > 0 ? round1(((total - free) / total) * 100) : 0 }
    }
  } catch {
    disk = null
  }

  return {
    platform: `${os.type()} ${os.release()}`,
    uptimeSec: Math.round(os.uptime()),
    cpu: { cores, loadPct: round1((load[0] / cores) * 100), loadAvg: [round1(load[0]), round1(load[1]), round1(load[2])] },
    memory: { totalMB: toMB(totalMem), freeMB: toMB(freeMem), usedMB: toMB(totalMem - freeMem), usedPct: round1(((totalMem - freeMem) / totalMem) * 100) },
    disk,
  }
}

export interface ProcessMetrics {
  uptimeSec: number
  rssMB: number
  heapUsedMB: number
  heapTotalMB: number
  nodeVersion: string
}

/** Read the current Node process metrics. */
export function collectProcessMetrics(): ProcessMetrics {
  const mem = process.memoryUsage()
  return {
    uptimeSec: Math.round(process.uptime()),
    rssMB: toMB(mem.rss),
    heapUsedMB: toMB(mem.heapUsed),
    heapTotalMB: toMB(mem.heapTotal),
    nodeVersion: process.version,
  }
}

/** Grade a full metrics bundle; returns per-component statuses + overall. */
export function gradeMetrics(
  system: SystemMetrics,
  dbLatencyMs: number | null,
  t: MonitoringThresholds = DEFAULT_THRESHOLDS,
): { statuses: Record<string, HealthStatus>; overall: HealthStatus } {
  const statuses: Record<string, HealthStatus> = {
    cpu: statusForValue(system.cpu.loadPct, t.cpu),
    memory: statusForValue(system.memory.usedPct, t.memory),
  }
  if (system.disk) statuses.disk = statusForValue(system.disk.usedPct, t.disk)
  statuses.database = dbLatencyMs == null ? 'critical' : statusForValue(dbLatencyMs, t.dbLatencyMs)
  return { statuses, overall: overallStatus(Object.values(statuses)) }
}
