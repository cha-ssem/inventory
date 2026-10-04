import { describe, it, expect } from 'vitest'
import { validateSyncConfig } from '../../src/sync/config.js'
import { EMPTY_OUTBOX, enqueueChange, takeBatch, ackBatch, outboxSize } from '../../src/sync/outbox.js'
import { mergeRemote } from '../../src/sync/merge.js'

const URL = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec'
const T = (n) => `2026-10-05T0${n}:00:00.000Z`
const part = (partNo, updatedAt = T(1), extra = {}) => ({ partNo, name: partNo, unit: 'EA', safetyStock: 0, active: true, createdAt: T(1), updatedAt, ...extra })
const tx = (id, partNo = 'A1') => ({ id, type: 'IN', partNo, qty: 1, createdAt: T(1) })

describe('validateSyncConfig', () => {
  it('Apps Script 웹 앱 주소와 토큰을 정리해서 통과시킨다', () => {
    expect(validateSyncConfig({ url: ` ${URL} `, token: ' abcdef0123456789 ' })).toEqual({
      ok: true,
      value: { url: URL, token: 'abcdef0123456789' },
    })
  })

  it.each([
    'http://script.google.com/macros/s/x/exec',
    'https://evil.example.com/macros/s/x/exec',
    'https://script.google.com/macros/s/x/dev',
    '',
  ])('Apps Script 웹 앱 주소가 아니면 거부한다: %s', (url) => {
    expect(validateSyncConfig({ url, token: 'abcdef0123456789' }).errors.url).toBeTruthy()
  })

  it('토큰은 영문·숫자 16~64자여야 한다', () => {
    expect(validateSyncConfig({ url: URL, token: 'short' }).errors.token).toBeTruthy()
    expect(validateSyncConfig({ url: URL, token: 'has space 0123456789' }).errors.token).toBeTruthy()
  })
})

describe('outbox', () => {
  it('바뀐 기록과 부품을 쌓고, 같은 부품은 최신 것만 남긴다', () => {
    const a = enqueueChange(EMPTY_OUTBOX, { parts: [part('A1', T(1))], transactions: [tx('t1')] })
    const b = enqueueChange(a, { parts: [part('A1', T(2))], transactions: [tx('t2')] })
    expect(outboxSize(b)).toBe(3)
    expect(b.parts).toEqual([part('A1', T(2))])
    expect(a.parts[0].updatedAt).toBe(T(1))
  })

  it('같은 기록 ID는 한 번만 쌓는다', () => {
    const a = enqueueChange(EMPTY_OUTBOX, { transactions: [tx('t1')] })
    expect(enqueueChange(a, { transactions: [tx('t1')] }).transactions).toHaveLength(1)
  })

  it('정해진 개수만큼 꺼내고, 서버가 받은 것만 지운다', () => {
    const box = enqueueChange(EMPTY_OUTBOX, { parts: [part('A1')], transactions: [tx('t1'), tx('t2'), tx('t3')] })
    const batch = takeBatch(box, 2)
    expect(batch.transactions.map((t) => t.id)).toEqual(['t1', 't2'])
    const after = ackBatch(box, { txIds: ['t1', 't2'], partNos: ['A1'] })
    expect(after.transactions.map((t) => t.id)).toEqual(['t3'])
    expect(after.parts).toEqual([])
  })

  it('보낸 뒤 다시 수정된 부품은 지우지 않는다', () => {
    const box = enqueueChange(EMPTY_OUTBOX, { parts: [part('A1', T(1))] })
    const batch = takeBatch(box, 10)
    const edited = enqueueChange(box, { parts: [part('A1', T(3))] })
    const after = ackBatch(edited, { txIds: [], partNos: batch.parts.map((p) => p.partNo), sentParts: batch.parts })
    expect(after.parts).toEqual([part('A1', T(3))])
  })
})

describe('mergeRemote', () => {
  const local = { parts: [part('A1', T(2), { name: '로컬' })], transactions: [tx('t1')] }

  it('새 기록은 더하고 이미 있는 기록은 그대로 둔다', () => {
    const { state, changed } = mergeRemote(local, { full: false, parts: [], transactions: [tx('t1'), tx('t2')] }, EMPTY_OUTBOX)
    expect(state.transactions.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(changed).toBe(true)
  })

  it('부품은 수정일시가 더 최신인 쪽을 남긴다', () => {
    const remote = { full: false, parts: [part('A1', T(1), { name: '옛것' }), part('B1', T(1))], transactions: [] }
    const { state } = mergeRemote(local, remote, EMPTY_OUTBOX)
    expect(state.parts.find((p) => p.partNo === 'A1').name).toBe('로컬')
    expect(state.parts.map((p) => p.partNo).sort()).toEqual(['A1', 'B1'])
    const newer = mergeRemote(local, { full: false, parts: [part('A1', T(3), { name: '서버' })], transactions: [] }, EMPTY_OUTBOX)
    expect(newer.state.parts[0].name).toBe('서버')
  })

  it('바뀐 것이 없으면 changed가 false이고 같은 객체를 돌려준다', () => {
    const { state, changed } = mergeRemote(local, { full: false, parts: [part('A1', T(1))], transactions: [tx('t1')] }, EMPTY_OUTBOX)
    expect(changed).toBe(false)
    expect(state).toBe(local)
  })

  it('전체 받기(full)면 서버 데이터로 바꾸되, 아직 못 보낸 내 기록은 남긴다', () => {
    const outbox = enqueueChange(EMPTY_OUTBOX, { transactions: [tx('mine')] })
    const remote = { full: true, parts: [part('Z1')], transactions: [tx('s1', 'Z1')] }
    const { state } = mergeRemote({ ...local, transactions: [tx('t1'), tx('mine')] }, remote, outbox)
    expect(state.transactions.map((t) => t.id)).toEqual(['s1', 'mine'])
    expect(state.parts.map((p) => p.partNo)).toEqual(['Z1'])
  })
})
