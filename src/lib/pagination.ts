/** Reject malformed/overflowing pagination before passing integers to Prisma. */
function positiveInteger(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
const MAX_PRISMA_OFFSET = 2_147_483_647
export function parsePagination(query: URLSearchParams, defaultLimit: number, maxLimit = 100): { page: number; limit: number; skip: number } | null {
  const page = positiveInteger(query.get('page'), 1)
  const requested = positiveInteger(query.get('limit'), defaultLimit)
  if (page === null || requested === null) return null
  const limit = Math.min(maxLimit, requested)
  const skip = (page - 1) * limit
  if (!Number.isSafeInteger(skip) || skip > MAX_PRISMA_OFFSET) return null
  return { page, limit, skip }
}
