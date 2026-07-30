/**
 * Tests for the repair-tracking timeline derivation (Phase 2).
 */
import { describe, it, expect } from 'vitest'
import { repairTimeline, stageIndexForStatus } from '../repair-timeline'

describe('stageIndexForStatus', () => {
  it('maps known statuses to the reached stage', () => {
    expect(stageIndexForStatus('scheduled')).toBe(0)
    expect(stageIndexForStatus('in_progress')).toBe(3)
    expect(stageIndexForStatus('completed')).toBe(5)
    expect(stageIndexForStatus('delivered')).toBe(6)
  })
  it('defaults unknown statuses to the first stage', () => {
    expect(stageIndexForStatus('whatever')).toBe(0)
  })
})

describe('repairTimeline', () => {
  it('marks done / current / pending around the reached stage', () => {
    const t = repairTimeline('in_progress') // index 3
    expect(t.currentIndex).toBe(3)
    expect(t.stages).toHaveLength(7)
    expect(t.stages[0].state).toBe('done')
    expect(t.stages[2].state).toBe('done')
    expect(t.stages[3].state).toBe('current')
    expect(t.stages[4].state).toBe('pending')
    expect(t.stages[6].state).toBe('pending')
  })

  it('marks the final stage current when delivered', () => {
    const t = repairTimeline('delivered')
    expect(t.currentIndex).toBe(6)
    expect(t.stages[6].state).toBe('current')
    expect(t.stages.slice(0, 6).every(s => s.state === 'done')).toBe(true)
  })

  it('flags a cancelled job distinctly', () => {
    const t = repairTimeline('cancelled')
    expect(t.cancelled).toBe(true)
    expect(t.currentIndex).toBe(-1)
    expect(t.stages.every(s => s.state === 'cancelled')).toBe(true)
  })
})
