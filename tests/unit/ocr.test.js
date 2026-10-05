import { describe, it, expect } from 'vitest'
import {
  buildReviewRows,
  findDuplicateStatement,
  mappingsToSave,
  countPdfPages,
  normalizeSupplier,
  parseQtyInput,
  reviewSummary,
  rowStatus,
  toInboundInputs,
  updateRow,
} from '../../src/domain/ocr.js'

const NOW = '2026-10-05T01:00:00.000Z'
const part = (partNo, name, extra = {}) => ({ partNo, name, spec: '', unit: 'EA', safetyStock: 0, location: '', active: true, createdAt: NOW, updatedAt: NOW, ...extra })
const parts = [
  part('SK-SB-001', '체결 클립'),
  part('SK-SB-002', '고무 패킹'),
  part('SK-PD-003', '페달 암 브래킷'),
  part('SK-PD-004', '페달 스토퍼', { active: false }),
  part('SK-AD-002', '덕트'),
  part('SK-AD-003', '덕트'),
]
const item = (extra = {}) => ({ ourPartNo: '', supplierCode: '', name: '', spec: '', unit: 'EA', qty: 1, ...extra })
const statement = (items, extra = {}) => ({ statementNo: 'DB-1002-338', date: '2026-10-03', supplier: '동방부품(가상)', items, ...extra })

describe('normalizeSupplier (서버와 같은 규칙)', () => {
  it.each([
    ['대한수지(가상)', '대한수지'],
    ['(주) 대한 수지', '대한수지'],
    ['㈜대한수지', '대한수지'],
    ['주식회사 대한수지', '대한수지'],
    ['Daehan Resin', 'DAEHANRESIN'],
    ['（주）대한수지', '대한수지'],
    ['(유)대한수지', '대한수지'],
    ['유한회사 대한수지', '대한수지'],
    [null, ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSupplier(input)).toBe(expected)
  })
})

describe('buildReviewRows (OCR-04 품번 맞추기)', () => {
  it('① 귀사 품번이 마스터에 있으면 바로 연결한다', () => {
    const [row] = buildReviewRows(statement([item({ ourPartNo: 'SK-SB-001', qty: 30 })]), parts, [])
    expect(row).toMatchObject({ key: 0, partNo: 'SK-SB-001', source: 'partNo', qty: 30, include: true })
  })

  it('② 귀사 품번이 없으면 공급사+공급사 코드 대응표로 연결한다 (상호 표기 차이는 무시)', () => {
    const mappings = [{ supplier: '동방부품', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002' }]
    const [row] = buildReviewRows(statement([item({ supplierCode: 'db-pk-nbr', name: '패킹' })]), parts, mappings)
    expect(row).toMatchObject({ partNo: 'SK-SB-002', source: 'mapping' })
  })

  it('다른 공급사의 대응이나 없어진 부품을 가리키는 대응은 쓰지 않는다', () => {
    const mappings = [
      { supplier: '세진포장', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002' },
      { supplier: '동방부품', supplierCode: 'DB-X', partNo: 'SK-ZZ-999' },
    ]
    const rows = buildReviewRows(statement([item({ supplierCode: 'DB-PK-NBR' }), item({ supplierCode: 'DB-X' })]), parts, mappings)
    expect(rows.map((r) => r.partNo)).toEqual([null, null])
  })

  it('③ 품명이 하나의 부품과 똑같으면 후보로 연결하고, 여럿이면 비워 둔다', () => {
    const rows = buildReviewRows(statement([item({ name: '고무  패킹' }), item({ name: '덕트' })]), parts, [])
    expect(rows[0]).toMatchObject({ partNo: 'SK-SB-002', source: 'name' })
    expect(rows[1]).toMatchObject({ partNo: null, source: null })
  })

  it('귀사 품번이 마스터에 없으면 다른 방법으로 찾는다', () => {
    const [row] = buildReviewRows(statement([item({ ourPartNo: 'SK-NO-999', name: '체결 클립' })]), parts, [])
    expect(row).toMatchObject({ partNo: 'SK-SB-001', source: 'name' })
  })
})

describe('rowStatus (OCR-06)', () => {
  const byNo = new Map(parts.map((p) => [p.partNo, p]))
  it.each([
    [{ partNo: 'SK-SB-001', qty: 3 }, 'ok'],
    [{ partNo: null, qty: 3 }, 'unmatched'],
    [{ partNo: 'SK-ZZ-999', qty: 3 }, 'unmatched'],
    [{ partNo: 'SK-PD-004', qty: 3 }, 'inactive'],
    [{ partNo: 'SK-SB-001', qty: null }, 'badQty'],
    [{ partNo: 'SK-SB-001', qty: 0 }, 'badQty'],
    [{ partNo: 'SK-SB-001', qty: 1.5 }, 'badQty'],
    [{ partNo: 'SK-SB-001', qty: 2_000_000 }, 'badQty'],
  ])('%o → %s', (row, expected) => {
    expect(rowStatus(row, byNo)).toBe(expected)
  })
})

describe('updateRow', () => {
  const rows = buildReviewRows(statement([item({ ourPartNo: 'SK-SB-001' }), item({ name: '없는 품목' })]), parts, [])

  it('부품을 직접 고르면 manual로 표시하고 원래 배열은 바꾸지 않는다', () => {
    const next = updateRow(rows, 1, { partNo: 'SK-PD-003' })
    expect(next[1]).toMatchObject({ partNo: 'SK-PD-003', source: 'manual' })
    expect(rows[1].partNo).toBeNull()
    expect(next[0]).toBe(rows[0])
  })

  it('수량·포함 여부는 출처를 바꾸지 않는다', () => {
    const next = updateRow(rows, 0, { qty: 7, include: false })
    expect(next[0]).toMatchObject({ qty: 7, include: false, source: 'partNo' })
  })
})

describe('reviewSummary', () => {
  it('넣을 행, 문제 행, 뺀 행을 센다', () => {
    let rows = buildReviewRows(statement([item({ ourPartNo: 'SK-SB-001' }), item({ name: '없는 품목' }), item({ ourPartNo: 'SK-SB-002', qty: null })]), parts, [])
    expect(reviewSummary(rows, parts)).toEqual({ ready: 1, problems: 2, excluded: 0 })
    rows = updateRow(rows, 1, { include: false })
    expect(reviewSummary(rows, parts)).toEqual({ ready: 1, problems: 1, excluded: 1 })
  })
})

describe('toInboundInputs (OCR-08)', () => {
  it('포함한 정상 행만 거래처=공급자, 메모=명세서 번호로 만든다', () => {
    const rows = buildReviewRows(statement([item({ ourPartNo: 'SK-SB-001', qty: 30 }), item({ name: '없는 품목' })]), parts, [])
    expect(toInboundInputs(rows, parts, { supplier: ' 동방부품(가상) ', statementNo: 'DB-1002-338', worker: '김자재' })).toEqual([
      { partNo: 'SK-SB-001', qty: 30, partner: '동방부품(가상)', worker: '김자재', memo: 'DB-1002-338' },
    ])
  })

  it('뺀 행과 문제 있는 행은 넣지 않는다', () => {
    const rows = updateRow(buildReviewRows(statement([item({ ourPartNo: 'SK-SB-001' })]), parts, []), 0, { include: false })
    expect(toInboundInputs(rows, parts, { supplier: 'a', statementNo: '', worker: '' })).toEqual([])
  })
})

describe('mappingsToSave (OCR-05)', () => {
  it('사람이 직접 고르거나 [맞음]으로 확인한 행 중 공급사 코드가 있는 것만 저장한다', () => {
    let rows = buildReviewRows(
      statement([
        item({ ourPartNo: 'SK-SB-001', supplierCode: 'DB-CL-500' }),
        item({ supplierCode: 'DB-PK-NBR', name: '고무 패킹' }),
        item({ supplierCode: 'DB-BR-16', name: '브래킷' }),
        item({ name: '코드 없는 품목' }),
        item({ supplierCode: 'DB-OFF', name: '뺄 품목' }),
      ]),
      parts,
      [],
    )
    rows = updateRow(rows, 1, { source: 'manual' })
    rows = updateRow(rows, 2, { partNo: 'SK-PD-003' })
    rows = updateRow(rows, 3, { partNo: 'SK-SB-001' })
    rows = updateRow(updateRow(rows, 4, { partNo: 'SK-SB-001' }), 4, { include: false })
    expect(mappingsToSave(rows, parts, ' 동방부품(가상) ')).toEqual([
      { supplier: '동방부품(가상)', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002' },
      { supplier: '동방부품(가상)', supplierCode: 'DB-BR-16', partNo: 'SK-PD-003' },
    ])
  })

  it('품명으로 맞추기만 하고 확인하지 않은 행은 저장하지 않는다 (잘못된 추측이 굳지 않게)', () => {
    const rows = buildReviewRows(statement([item({ supplierCode: 'DB-PK-NBR', name: '고무 패킹' })]), parts, [])
    expect(rows[0].source).toBe('name')
    expect(mappingsToSave(rows, parts, '동방부품')).toEqual([])
  })

  it('공급자 상호가 비었으면 저장하지 않는다', () => {
    const rows = updateRow(buildReviewRows(statement([item({ supplierCode: 'X' })]), parts, []), 0, { partNo: 'SK-SB-001' })
    expect(mappingsToSave(rows, parts, ' ')).toEqual([])
  })
})

describe('findDuplicateStatement (OCR-07)', () => {
  const tx = (id, extra = {}) => ({ id, type: 'IN', partNo: 'SK-SB-001', qty: 1, partner: '동방부품', worker: '', memo: 'DB-1002-338', refId: null, createdAt: NOW, ...extra })

  it('같은 공급자의 같은 명세서 번호로 입고한 기록을 찾는다', () => {
    const txs = [tx('a'), tx('b', { partner: '세진포장' }), tx('c', { memo: 'OTHER' }), tx('d', { type: 'OUT' })]
    expect(findDuplicateStatement(txs, '동방부품(가상)', 'DB-1002-338').map((t) => t.id)).toEqual(['a'])
  })

  it('취소한 입고는 빼고, 명세서 번호가 비었으면 찾지 않는다', () => {
    const txs = [tx('a'), tx('x', { type: 'CANCEL', refId: 'a' })]
    expect(findDuplicateStatement(txs, '동방부품', 'DB-1002-338')).toEqual([])
    expect(findDuplicateStatement([tx('a', { memo: '' })], '동방부품', ' ')).toEqual([])
  })
})

describe('parseQtyInput', () => {
  it.each([
    ['30', 30],
    [' 7 ', 7],
    ['', null],
    ['1e3', NaN],
    ['2.5', NaN],
    ['-3', NaN],
  ])('%s → %s', (input, expected) => {
    expect(parseQtyInput(input)).toBe(expected)
  })
})

describe('countPdfPages', () => {
  const pdf = (pages) =>
    new TextEncoder().encode(['%PDF-1.4', '1 0 obj << /Type /Pages /Kids [] /Count 2 >>', ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 1 0 R >>'), '%%EOF'].join('\n'))

  it('/Type /Page 개수를 센다 (/Pages는 빼고)', () => {
    expect(countPdfPages(pdf(1))).toBe(1)
    expect(countPdfPages(pdf(4))).toBe(4)
    expect(countPdfPages(new TextEncoder().encode('<< /Type/Page >>'))).toBe(1)
  })
})
