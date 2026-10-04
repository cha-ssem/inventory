import { describe, it, expect } from 'vitest'
import {
  TX_TYPES,
  createTransaction,
  checkOutbound,
  createCancel,
  getCancelledIds,
} from '../../src/domain/transactions.js'

const NOW = '2026-10-04T01:00:00.000Z'
const idGen = (() => {
  let n = 0
  return () => `id-${++n}`
})()

describe('createTransaction', () => {
  it('입력을 정리해서 새 기록을 만든다', () => {
    const result = createTransaction(
      { type: 'IN', partNo: ' sk-ad-001 ', qty: '5', partner: ' 대한수지 ', worker: '', memo: '' },
      { now: NOW, makeId: () => 'x1' },
    )
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'x1',
        type: 'IN',
        partNo: 'SK-AD-001',
        qty: 5,
        partner: '대한수지',
        worker: '',
        memo: '',
        refId: null,
        createdAt: NOW,
      },
    })
  })

  it('알 수 없는 구분은 거부한다', () => {
    expect(createTransaction({ type: 'MOVE', partNo: 'A1', qty: 1 }, { now: NOW, makeId: idGen }).ok).toBe(false)
  })

  it('수량이 잘못되면 거부한다', () => {
    const result = createTransaction({ type: 'IN', partNo: 'A1', qty: 0 }, { now: NOW, makeId: idGen })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/수량/)
  })

  it('품번이 비어 있으면 거부한다', () => {
    expect(createTransaction({ type: 'OUT', partNo: '', qty: 1 }, { now: NOW, makeId: idGen }).ok).toBe(false)
  })

  it('메모가 너무 길면 거부한다', () => {
    const result = createTransaction(
      { type: 'IN', partNo: 'A1', qty: 1, memo: 'x'.repeat(201) },
      { now: NOW, makeId: idGen },
    )
    expect(result.ok).toBe(false)
  })
})

describe('checkOutbound', () => {
  const stock = new Map([['A1', 10]])

  it('현재고 이내면 통과하고 출고 후 재고를 알려준다', () => {
    expect(checkOutbound(stock, 'A1', 4, 5)).toEqual({ ok: true, after: 6, low: false })
  })

  it('출고 후 안전재고 아래로 떨어지면 경고를 함께 준다', () => {
    expect(checkOutbound(stock, 'A1', 8, 5)).toEqual({ ok: true, after: 2, low: true })
  })

  it('현재고보다 많으면 거부한다', () => {
    const result = checkOutbound(stock, 'A1', 11, 5)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/현재고/)
  })

  it('기록이 없는 부품은 현재고 0으로 본다', () => {
    expect(checkOutbound(stock, 'B1', 1, 0).ok).toBe(false)
  })
})

describe('getCancelledIds', () => {
  it('취소 기록이 가리키는 원래 기록 ID를 모은다', () => {
    const ids = getCancelledIds([
      { id: '1', type: 'IN' },
      { id: '2', type: 'CANCEL', refId: '1' },
    ])
    expect([...ids]).toEqual(['1'])
  })
})

describe('createCancel', () => {
  const inTx = { id: 't1', type: TX_TYPES.IN, partNo: 'A1', qty: 10, createdAt: NOW }
  const outTx = { id: 't2', type: TX_TYPES.OUT, partNo: 'A1', qty: 4, createdAt: NOW }

  it('출고를 취소하면 같은 품번·수량의 취소 기록을 만든다', () => {
    const result = createCancel(outTx, [inTx, outTx], { now: NOW, makeId: () => 'c1', memo: '수량 착오' })
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ id: 'c1', type: 'CANCEL', partNo: 'A1', qty: 4, refId: 't2', memo: '수량 착오' })
  })

  it('이미 취소된 기록은 다시 취소할 수 없다', () => {
    const cancel = { id: 'c0', type: 'CANCEL', partNo: 'A1', qty: 4, refId: 't2' }
    const result = createCancel(outTx, [inTx, outTx, cancel], { now: NOW, makeId: idGen })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/이미/)
  })

  it('취소 기록 자체는 취소할 수 없다', () => {
    const cancel = { id: 'c0', type: 'CANCEL', partNo: 'A1', qty: 4, refId: 't2' }
    expect(createCancel(cancel, [inTx, outTx, cancel], { now: NOW, makeId: idGen }).ok).toBe(false)
  })

  it('입고를 취소해서 재고가 음수가 되면 거부한다', () => {
    const result = createCancel(inTx, [inTx, outTx], { now: NOW, makeId: idGen })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/재고/)
  })

  it('입고 취소 후에도 재고가 0 이상이면 허용한다', () => {
    const in2 = { id: 't3', type: 'IN', partNo: 'A1', qty: 5, createdAt: NOW }
    expect(createCancel(in2, [inTx, outTx, in2], { now: NOW, makeId: idGen }).ok).toBe(true)
  })
})
