import { describe, it, expect } from 'vitest'
import { CATEGORY_LABELS, nextPartNo, suggestPartNo } from '../../src/domain/partNo.js'

const NOW = '2026-10-05T01:00:00.000Z'
const part = (partNo, name) => ({ partNo, name, spec: '', unit: 'EA', safetyStock: 0, location: '', active: true, createdAt: NOW, updatedAt: NOW })
const parts = [
  part('SK-AD-001', '에어벤트 덕트 센터'),
  part('SK-PD-001', '액셀 페달 하우징'),
  part('SK-PD-012', '페달 스토퍼'),
  part('SK-CS-001', '컨트롤 박스 케이스'),
  part('SK-RM-001', 'PP 수지'),
  part('SK-SB-001', '체결 클립'),
  part('SK-SB-005', '완충 패드'),
  part('TEMP-1', '임시'),
]
const tx = (partNo, partner) => ({ id: partNo + partner, type: 'IN', partNo, qty: 1, partner, worker: '', memo: '', refId: null, createdAt: NOW })
const item = (extra = {}) => ({ ourPartNo: '', supplierCode: '', name: '', spec: '', unit: 'EA', qty: 1, ...extra })

describe('nextPartNo', () => {
  it('분류의 가장 큰 번호 다음을 세 자리로 만든다', () => {
    expect(nextPartNo(parts, 'SB')).toBe('SK-SB-006')
    expect(nextPartNo(parts, 'PD')).toBe('SK-PD-013')
  })

  it('처음 쓰는 분류는 001부터 시작한다', () => {
    expect(nextPartNo(parts, 'ZZ')).toBe('SK-ZZ-001')
    expect(nextPartNo([], 'SB')).toBe('SK-SB-001')
  })

  it('번호가 999를 넘으면 자리를 늘린다', () => {
    expect(nextPartNo([part('SK-SB-999', 'x')], 'SB')).toBe('SK-SB-1000')
  })
})

describe('suggestPartNo', () => {
  it('서류의 귀사 품번이 형식에 맞고 아직 없으면 그대로 쓴다', () => {
    const result = suggestPartNo({ item: item({ ourPartNo: 'SK-SB-020', name: '테이프' }), supplier: '세진포장', parts, transactions: [], siblingPartNos: [] })
    expect(result).toMatchObject({ partNo: 'SK-SB-020', reason: '서류에 적힌 귀사 품번입니다.' })
  })

  it('같은 명세서의 다른 품목 분류를 가장 먼저 따른다', () => {
    const result = suggestPartNo({ item: item({ name: '포장 테이프' }), supplier: '세진포장', parts, transactions: [], siblingPartNos: ['SK-SB-001', 'SK-SB-005'] })
    expect(result.partNo).toBe('SK-SB-006')
    expect(result.category).toBe('SB')
    expect(result.reason).toContain('같은 명세서')
  })

  it('같은 공급사에서 받은 부품 분류를 따른다 (상호 표기 차이 무시)', () => {
    const transactions = [tx('SK-RM-001', '대한수지'), tx('SK-RM-001', '대한수지'), tx('SK-SB-001', '동방부품')]
    const result = suggestPartNo({ item: item({ name: '신규 원료' }), supplier: '대한수지(가상)', parts, transactions, siblingPartNos: [] })
    expect(result.partNo).toBe('SK-RM-002')
    expect(result.reason).toContain('대한수지(가상)')
  })

  it('다른 단서가 없으면 품명의 낱말로 분류를 고른다', () => {
    expect(suggestPartNo({ item: item({ name: '센서 커버' }), supplier: '', parts, transactions: [], siblingPartNos: [] })).toMatchObject({ partNo: 'SK-CS-002', category: 'CS' })
    const tape = suggestPartNo({ item: item({ name: '포장 테이프' }), supplier: '', parts, transactions: [], siblingPartNos: [] })
    expect(tape.partNo).toBe('SK-SB-006')
    expect(tape.reason).toContain('테이프')
  })

  it('단서가 없으면 제안하지 않는다', () => {
    expect(suggestPartNo({ item: item({ name: '알 수 없는 것' }), supplier: '', parts, transactions: [], siblingPartNos: [] })).toBeNull()
  })

  it('다른 분류도 후보로 함께 준다 (점수 순, 첫 제안 제외)', () => {
    const result = suggestPartNo({ item: item({ name: '페달 커버' }), supplier: '', parts, transactions: [], siblingPartNos: ['SK-CS-001'] })
    expect(result.category).toBe('CS')
    expect(result.alternatives.map((a) => a.partNo)).toEqual(['SK-PD-013'])
  })

  it('공급사 이력은 기록 수가 아니라 부품 종류 수로 센다 (입고가 많은 부품 하나가 이기지 않게)', () => {
    const transactions = [...Array.from({ length: 10 }, () => tx('SK-AD-001', '세진포장')), tx('SK-SB-001', '세진포장'), tx('SK-SB-005', '세진포장')]
    const result = suggestPartNo({ item: item({ name: '신규' }), supplier: '세진포장', parts, transactions, siblingPartNos: [] })
    expect(result.category).toBe('SB')
  })

  it('공급사 이력만 있는 분류는 다른 후보로 내지 않는다 (근거가 약해서)', () => {
    const transactions = [tx('SK-AD-001', '세진포장'), tx('SK-CS-001', '세진포장')]
    const result = suggestPartNo({ item: item({ name: '포장 테이프' }), supplier: '세진포장', parts, transactions, siblingPartNos: ['SK-SB-001'] })
    expect(result.category).toBe('SB')
    expect(result.alternatives).toEqual([])
  })

  it('이미 있는 귀사 품번이나 형식이 틀린 귀사 품번은 쓰지 않는다', () => {
    const existing = suggestPartNo({ item: item({ ourPartNo: 'SK-SB-001', name: '클립' }), supplier: '', parts, transactions: [], siblingPartNos: [] })
    expect(existing.partNo).toBe('SK-SB-006')
    const bad = suggestPartNo({ item: item({ ourPartNo: 'sk sb', name: '클립' }), supplier: '', parts, transactions: [], siblingPartNos: [] })
    expect(bad.partNo).toBe('SK-SB-006')
  })

  it('분류 이름을 알려 준다', () => {
    expect(CATEGORY_LABELS.SB).toBe('부자재')
  })
})
