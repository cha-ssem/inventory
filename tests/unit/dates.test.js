import { describe, it, expect } from 'vitest'
import { toDateKey, formatDateTime, isSameLocalDay, addDays } from '../../src/domain/dates.js'

describe('dates (Asia/Seoul)', () => {
  it('UTC 시각을 현지 날짜 키로 바꾼다', () => {
    // UTC 15:30 = 한국 시간 다음 날 00:30
    expect(toDateKey('2026-10-03T15:30:00.000Z')).toBe('2026-10-04')
  })

  it('날짜와 시각을 YYYY-MM-DD HH:mm 형식으로 보여준다', () => {
    expect(formatDateTime('2026-10-04T00:05:00.000Z')).toBe('2026-10-04 09:05')
  })

  it('잘못된 값은 빈 문자열로 보여준다', () => {
    expect(formatDateTime('not-a-date')).toBe('')
    expect(toDateKey(undefined)).toBe('')
  })

  it('같은 현지 날짜인지 비교한다', () => {
    expect(isSameLocalDay('2026-10-03T15:30:00.000Z', '2026-10-04T10:00:00.000Z')).toBe(true)
    expect(isSameLocalDay('2026-10-03T14:30:00.000Z', '2026-10-04T10:00:00.000Z')).toBe(false)
  })

  it('날짜에 일수를 더한 날짜 키를 돌려준다', () => {
    expect(addDays('2026-10-04', -7)).toBe('2026-09-27')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
