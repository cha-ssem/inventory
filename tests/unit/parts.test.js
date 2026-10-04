import { describe, it, expect } from 'vitest'
import { createPart, updatePart, upsertPart, findPart, setPartActive } from '../../src/domain/parts.js'

const NOW = '2026-10-04T01:00:00.000Z'
const LATER = '2026-10-05T01:00:00.000Z'
const input = { partNo: 'SK-AD-001', name: '덕트', spec: '', unit: 'EA', safetyStock: 10, location: '' }

describe('createPart', () => {
  it('사용 중 상태와 등록 일시를 붙여서 만든다', () => {
    expect(createPart(input, NOW)).toEqual({ ...input, active: true, createdAt: NOW, updatedAt: NOW })
  })
})

describe('updatePart', () => {
  it('새 객체를 돌려주고 원본은 그대로 둔다', () => {
    const part = createPart(input, NOW)
    const updated = updatePart(part, { name: '덕트 센터', safetyStock: 20 }, LATER)
    expect(updated).toMatchObject({ name: '덕트 센터', safetyStock: 20, updatedAt: LATER, createdAt: NOW })
    expect(part.name).toBe('덕트')
  })

  it('품번은 바꿀 수 없다', () => {
    const part = createPart(input, NOW)
    expect(updatePart(part, { partNo: 'OTHER' }, LATER).partNo).toBe('SK-AD-001')
  })
})

describe('upsertPart / findPart', () => {
  it('없으면 추가하고 있으면 교체한다 (원본 배열 불변)', () => {
    const a = createPart(input, NOW)
    const list1 = upsertPart([], a)
    const list2 = upsertPart(list1, { ...a, name: '변경' })
    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('덕트')
    expect(list2).toHaveLength(1)
    expect(findPart(list2, 'sk-ad-001').name).toBe('변경')
  })

  it('없는 품번은 undefined를 돌려준다', () => {
    expect(findPart([], 'X')).toBeUndefined()
  })
})

describe('setPartActive', () => {
  it('사용 여부를 바꾼 새 객체를 돌려준다', () => {
    const part = createPart(input, NOW)
    const off = setPartActive(part, false, LATER)
    expect(off.active).toBe(false)
    expect(part.active).toBe(true)
  })
})
