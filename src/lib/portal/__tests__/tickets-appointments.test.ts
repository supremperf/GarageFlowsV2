/**
 * Tests for the SAV ticket and appointment pure logic (Phase 2).
 */
import { describe, it, expect } from 'vitest'
import { nextTicketStatus, canReply, isTicketCategory, isTicketPriority } from '../tickets'
import { validateSlot, canModifyAppointment, nextAppointmentStatus } from '../appointments'

describe('ticket status logic', () => {
  it('transitions by action', () => {
    expect(nextTicketStatus('open', 'staff_reply')).toBe('answered')
    expect(nextTicketStatus('answered', 'client_reply')).toBe('pending')
    expect(nextTicketStatus('pending', 'close')).toBe('closed')
    expect(nextTicketStatus('closed', 'reopen')).toBe('open')
  })
  it('blocks replies on closed tickets', () => {
    expect(canReply('open')).toBe(true)
    expect(canReply('closed')).toBe(false)
  })
  it('validates categories and priorities', () => {
    expect(isTicketCategory('repair')).toBe(true)
    expect(isTicketCategory('nope')).toBe(false)
    expect(isTicketPriority('high')).toBe(true)
    expect(isTicketPriority('urgent')).toBe(false)
  })
})

describe('appointment slot validation', () => {
  const base = { date: '2026-08-01', startTime: '10:00', durationMin: 60, workshopStartHour: 8, workshopEndHour: 18, now: new Date('2026-07-27T12:00:00') }

  it('accepts a valid future in-hours slot', () => {
    expect(validateSlot(base).ok).toBe(true)
  })
  it('rejects a past slot', () => {
    expect(validateSlot({ ...base, date: '2026-07-01' }).ok).toBe(false)
  })
  it('rejects before opening / after closing', () => {
    expect(validateSlot({ ...base, startTime: '07:00' }).ok).toBe(false)
    expect(validateSlot({ ...base, startTime: '17:30', durationMin: 60 }).ok).toBe(false) // ends 18:30 > 18:00
  })
  it('rejects malformed inputs', () => {
    expect(validateSlot({ ...base, date: '01/08/2026' }).ok).toBe(false)
    expect(validateSlot({ ...base, startTime: '25:00' }).ok).toBe(false)
    expect(validateSlot({ ...base, durationMin: 0 }).ok).toBe(false)
  })
})

describe('appointment status logic', () => {
  it('confirms only from requested', () => {
    expect(nextAppointmentStatus('requested', 'confirm')).toBe('confirmed')
    expect(nextAppointmentStatus('confirmed', 'confirm')).toBeNull()
  })
  it('cancels from requested/confirmed only', () => {
    expect(nextAppointmentStatus('requested', 'cancel')).toBe('cancelled')
    expect(nextAppointmentStatus('confirmed', 'cancel')).toBe('cancelled')
    expect(nextAppointmentStatus('completed', 'cancel')).toBeNull()
  })
  it('completes only from confirmed', () => {
    expect(nextAppointmentStatus('confirmed', 'complete')).toBe('completed')
    expect(nextAppointmentStatus('requested', 'complete')).toBeNull()
  })
  it('canModifyAppointment reflects the lifecycle', () => {
    expect(canModifyAppointment('requested')).toBe(true)
    expect(canModifyAppointment('cancelled')).toBe(false)
  })
})
