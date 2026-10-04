import { describe, it, expect } from 'vitest'
import { serializeBackup, parseBackup } from '../../src/domain/backup.js'

const state = {
  parts: [{ partNo: 'A1', name: '부품', unit: 'EA', safetyStock: 0, active: true }],
  transactions: [{ id: 't1', type: 'IN', partNo: 'A1', qty: 3, createdAt: '2026-10-04T00:00:00.000Z' }],
}

describe('backup', () => {
  it('저장한 백업을 다시 읽으면 같은 데이터가 나온다', () => {
    const text = serializeBackup(state, '2026-10-04T01:00:00.000Z')
    const result = parseBackup(text)
    expect(result).toEqual({ ok: true, value: state })
    expect(JSON.parse(text)).toMatchObject({ app: 'samkwang-inventory', version: 1 })
  })

  it('JSON이 아니면 거부한다', () => {
    expect(parseBackup('{oops').ok).toBe(false)
  })

  it('다른 앱의 파일이면 거부한다', () => {
    expect(parseBackup(JSON.stringify({ app: 'other', version: 1, parts: [], transactions: [] })).ok).toBe(false)
  })

  it('부품이나 기록 형식이 맞지 않으면 거부한다', () => {
    const bad = (extra) => JSON.stringify({ app: 'samkwang-inventory', version: 1, parts: [], transactions: [], ...extra })
    expect(parseBackup(bad({ parts: 'x' })).ok).toBe(false)
    expect(parseBackup(bad({ parts: [{ name: '품번 없음' }] })).ok).toBe(false)
    expect(parseBackup(bad({ transactions: [{ id: 't', type: 'BAD', partNo: 'A', qty: 1 }] })).ok).toBe(false)
    expect(parseBackup(bad({ transactions: [{ id: 't', type: 'IN', partNo: 'A', qty: -1 }] })).ok).toBe(false)
  })
})

describe('isValidState (데이터 무결성)', () => {
  const part = { partNo: 'A1', name: '부품', unit: 'EA', safetyStock: 0, active: true }
  const inTx = { id: 't1', type: 'IN', partNo: 'A1', qty: 3, createdAt: '2026-10-04T00:00:00.000Z' }
  const wrap = (extra) => JSON.stringify({ app: 'samkwang-inventory', version: 1, parts: [part], transactions: [inTx], ...extra })

  it('일시가 없거나 잘못된 기록은 거부한다', () => {
    expect(parseBackup(wrap({ transactions: [{ ...inTx, createdAt: undefined }] })).ok).toBe(false)
    expect(parseBackup(wrap({ transactions: [{ ...inTx, createdAt: 'yesterday' }] })).ok).toBe(false)
  })

  it('기록 ID가 겹치면 거부한다', () => {
    expect(parseBackup(wrap({ transactions: [inTx, { ...inTx }] })).ok).toBe(false)
  })

  it('취소 기록은 존재하는 입고·출고 기록을 가리켜야 한다', () => {
    const cancel = { id: 'c1', type: 'CANCEL', partNo: 'A1', qty: 3, createdAt: inTx.createdAt, refId: 't1' }
    expect(parseBackup(wrap({ transactions: [inTx, cancel] })).ok).toBe(true)
    expect(parseBackup(wrap({ transactions: [inTx, { ...cancel, refId: null }] })).ok).toBe(false)
    expect(parseBackup(wrap({ transactions: [inTx, { ...cancel, refId: 'nope' }] })).ok).toBe(false)
    const cancel2 = { ...cancel, id: 'c2', refId: 'c1' }
    expect(parseBackup(wrap({ transactions: [inTx, cancel, cancel2] })).ok).toBe(false)
  })

  it('부품 품번 형식, 중복, 안전재고, 단위를 확인한다', () => {
    expect(parseBackup(wrap({ parts: [{ ...part, partNo: 'a 1' }] })).ok).toBe(false)
    expect(parseBackup(wrap({ parts: [part, { ...part }] })).ok).toBe(false)
    expect(parseBackup(wrap({ parts: [{ ...part, safetyStock: -1 }] })).ok).toBe(false)
    expect(parseBackup(wrap({ parts: [{ ...part, unit: 3 }] })).ok).toBe(false)
  })
})
