/**
 * Tests for the constant-time string comparison used to check API keys / shared
 * secrets (src/lib/secure-compare.ts).
 */
import { describe, it, expect } from 'vitest'
import { constantTimeEqual } from '../secure-compare'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('returns false for different strings of equal length', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false)
    expect(constantTimeEqual('abc123', 'xbc123')).toBe(false)
  })

  it('returns false for strings of different length', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('abcd', 'abc')).toBe(false)
  })

  it('handles realistic 64-char hex keys', () => {
    const key = 'a'.repeat(64)
    expect(constantTimeEqual(key, key)).toBe(true)
    expect(constantTimeEqual(key, 'a'.repeat(63) + 'b')).toBe(false)
  })
})
