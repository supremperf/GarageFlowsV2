/**
 * Centralized application logger.
 *
 * In production, prefixes every line with ISO timestamp + level.
 * In development, uses console directly for readable output.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('Server started')
 *   logger.error('DB connection failed', err)
 */

import { redactValue, redactString } from '@/lib/redact'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const IS_PROD = process.env.NODE_ENV === 'production'

/** Applique la redaction centralisée à chaque argument avant journalisation. */
function scrub(args: unknown[]): unknown[] {
  return args.map((a) => redactValue(a))
}

function format(level: LogLevel, args: unknown[]): string {
  const ts  = new Date().toISOString()
  const msg = scrub(args)
    .map(a => {
      if (a instanceof Error) return redactString(`${a.message}\n${a.stack ?? ''}`)
      if (typeof a === 'object') { try { return JSON.stringify(a) } catch { return String(a) } }
      return String(a)
    })
    .join(' ')
  return `[${ts}] [${level.toUpperCase()}] ${msg}`
}

function write(level: LogLevel, args: unknown[]): void {
  if (!IS_PROD) {
    // Dev: delegate to console for nice formatting (redaction appliquée aussi).
    console[level === 'debug' ? 'log' : level](...scrub(args))
    return
  }
  const line = format(level, args)
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export const logger = {
  debug: (...args: unknown[]) => write('debug', args),
  info:  (...args: unknown[]) => write('info',  args),
  warn:  (...args: unknown[]) => write('warn',  args),
  error: (...args: unknown[]) => write('error', args),
}
