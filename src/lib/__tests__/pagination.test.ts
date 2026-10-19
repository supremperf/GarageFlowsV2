import { it, expect } from 'vitest'
import { parsePagination } from '@/lib/pagination'
it('pagination defaults and bounded valid integers preserve API contracts', () => {
  expect(parsePagination(new URLSearchParams(), 15)).toEqual({ page: 1, limit: 15, skip: 0 })
  expect(parsePagination(new URLSearchParams('page=2&limit=200'), 20)).toEqual({ page: 2, limit: 100, skip: 100 })
  expect(parsePagination(new URLSearchParams('page=2'), 500, 500)).toEqual({ page: 2, limit: 500, skip: 500 })
})
it.each(['abc', 'Infinity', 'NaN', '-1', '0', '1.1', '1abc', '', '9007199254740992'])('rejects page/limit=%s instead of NaN, partial parsing or overflow', v => {
  for (const name of ['page', 'limit']) expect(parsePagination(new URLSearchParams({ [name]: v }), 20)).toBeNull()
})
it('rejects a safe-integer page whose offset overflows Prisma integer range', () => {
  expect(parsePagination(new URLSearchParams('page=1000000000'), 500, 500)).toBeNull()
})
