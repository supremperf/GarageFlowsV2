/**
 * Brute-force lockout state machine for portal login.
 *
 * Pure and side-effect-free: it maps the persisted counters
 * (`failedCount`, `lockedUntil`) plus the current time to a decision and a new
 * state, which the caller stores on the PortalUser row. Progressive lockout: the
 * account locks for `lockoutMs` once `maxAttempts` consecutive failures occur.
 */

export interface LockoutState {
  failedCount: number
  /** Epoch ms until which login is blocked, or null when not locked. */
  lockedUntil: number | null
}

export interface LockoutPolicy {
  maxAttempts: number
  lockoutMs: number
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: 5,
  lockoutMs: 15 * 60 * 1000, // 15 minutes
}

/** Whether the account is currently locked. */
export function isLocked(state: LockoutState, nowMs: number = Date.now()): boolean {
  return state.lockedUntil != null && state.lockedUntil > nowMs
}

/** Seconds remaining on an active lock (0 when not locked). */
export function lockRemainingSec(state: LockoutState, nowMs: number = Date.now()): number {
  if (!isLocked(state, nowMs)) return 0
  return Math.ceil(((state.lockedUntil as number) - nowMs) / 1000)
}

/**
 * Register a failed attempt. When the threshold is reached the account locks and
 * the failure counter resets (so the next window starts clean after the lock).
 */
export function registerFailure(
  state: LockoutState,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
  nowMs: number = Date.now(),
): LockoutState {
  // If a previous lock has already expired, the failure window starts fresh.
  const prevCount = state.lockedUntil != null && state.lockedUntil <= nowMs ? 0 : state.failedCount
  const failedCount = prevCount + 1
  if (failedCount >= policy.maxAttempts) {
    return { failedCount: 0, lockedUntil: nowMs + policy.lockoutMs }
  }
  return { failedCount, lockedUntil: null }
}

/** Reset after a successful login. */
export function registerSuccess(): LockoutState {
  return { failedCount: 0, lockedUntil: null }
}
