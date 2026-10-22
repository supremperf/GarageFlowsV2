import { randomBytes } from 'node:crypto'

export const POSTGRES_SCRATCH_PREFIX = 'gf_gate_check_'

/** Returns a new, non-reused PostgreSQL identifier; callers must never drop it. */
export function temporaryPostgresDatabaseName(entropy = randomBytes(8)) {
  if (!Buffer.isBuffer(entropy) || entropy.length !== 8) {
    throw new TypeError('Exactly 8 bytes of entropy are required for a scratch database name')
  }
  const name = `${POSTGRES_SCRATCH_PREFIX}${entropy.toString('hex')}`
  if (!/^gf_gate_check_[a-f0-9]{16}$/.test(name) || name.length > 63) {
    throw new Error('Unsafe generated PostgreSQL identifier')
  }
  return name
}
