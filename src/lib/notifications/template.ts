/**
 * Lightweight, safe template engine for notification bodies.
 *
 * Syntax:  {{ path.to.value }}  with optional piped filters:
 *          {{ amount | currency }}   {{ name | upper }}   {{ date | date }}
 *          {{ note | default:"—" }}
 *
 * Unknown variables render as empty strings and are reported in `missingVars`
 * (so the UI can warn), never throwing. This is intentionally NOT a general
 * expression evaluator — no code execution, no property access beyond plain
 * dot-walking — which keeps it injection-safe.
 */
import type { NotificationContext } from './types'

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g

type Filter = (value: unknown, arg?: string) => string

function formatCurrency(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `${n.toFixed(2).replace('.', ',')} €`
}

function formatDate(v: unknown): string {
  const s = String(v ?? '')
  // Accept ISO date/datetime; fall back to the raw string.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return s
}

const FILTERS: Record<string, Filter> = {
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  currency: (v) => formatCurrency(v),
  date: (v) => formatDate(v),
  default: (v, arg) => {
    const s = v === null || v === undefined || v === '' ? '' : String(v)
    return s.length ? s : stripQuotes(arg ?? '')
  },
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function resolvePath(ctx: NotificationContext, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, ctx)
}

/** Render a template string against a context. Never throws. */
export function renderTemplate(
  template: string,
  ctx: NotificationContext,
): { text: string; missingVars: string[] } {
  const missing = new Set<string>()

  const text = template.replace(TOKEN, (_full, expr: string) => {
    const [rawPath, ...filterParts] = expr.split('|')
    const path = rawPath.trim()
    let value = resolvePath(ctx, path)

    const hasDefault = filterParts.some((f) => f.trim().startsWith('default'))
    if ((value === undefined || value === null) && !hasDefault) {
      missing.add(path)
    }

    for (const raw of filterParts) {
      const [name, ...argParts] = raw.trim().split(':')
      const filter = FILTERS[name.trim()]
      if (filter) value = filter(value, argParts.join(':'))
    }

    return value === undefined || value === null ? '' : String(value)
  })

  return { text, missingVars: Array.from(missing) }
}

/** Extract the `{{ variable }}` names referenced by a template. */
export function extractVariables(template: string): string[] {
  const vars = new Set<string>()
  for (const m of Array.from(template.matchAll(TOKEN))) {
    const path = m[1].split('|')[0].trim()
    if (path) vars.add(path)
  }
  return Array.from(vars)
}
