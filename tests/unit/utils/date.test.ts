import { describe, it, expect } from 'vitest'
import { nowISO, dateToSessionId, isoToDate, minutesBetween, isOlderThanDays } from '../../../src/utils/date.js'

describe('nowISO', () => {
  it('returns a valid ISO string', () => {
    const iso = nowISO()
    expect(() => new Date(iso)).not.toThrow()
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('dateToSessionId', () => {
  it('formats date as YYYY-MM-DD-HH', () => {
    const d = new Date('2026-04-08T14:30:00Z')
    const id = dateToSessionId(d)
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/)
  })
})

describe('isoToDate', () => {
  it('extracts date part from ISO string', () => {
    expect(isoToDate('2026-04-08T14:30:00.000Z')).toBe('2026-04-08')
  })
})

describe('minutesBetween', () => {
  it('calculates minutes between two ISO timestamps', () => {
    const start = '2026-04-08T10:00:00.000Z'
    const end = '2026-04-08T10:45:00.000Z'
    expect(minutesBetween(start, end)).toBe(45)
  })
})

describe('isOlderThanDays', () => {
  it('returns true for very old dates', () => {
    expect(isOlderThanDays('2020-01-01T00:00:00.000Z', 30)).toBe(true)
  })

  it('returns false for recent dates', () => {
    expect(isOlderThanDays(nowISO(), 30)).toBe(false)
  })
})
