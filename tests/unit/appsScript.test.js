import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, it, expect, beforeAll } from 'vitest'

// Apps Script는 모듈이 없으므로 Logic.gs를 격리된 컨텍스트에서 실행해 함수를 꺼낸다
let gs
beforeAll(() => {
  const code = readFileSync(resolve(__dirname, '../../apps-script/Logic.gs'), 'utf-8')
  gs = vm.createContext({})
  vm.runInContext(code, gs)
})

const NOW = '2026-10-05T01:00:00.000Z'
const part = { partNo: 'SK-AD-001', name: '덕트', spec: '', unit: 'EA', safetyStock: 10, location: '', active: true, createdAt: NOW, updatedAt: NOW }
const tx = (id, extra = {}) => ({ id, type: 'IN', partNo: 'SK-AD-001', qty: 5, partner: '', worker: '', memo: '', refId: null, createdAt: NOW, ...extra })

describe('parseRequest', () => {
  it('JSON 본문을 읽는다', () => {
    expect(gs.parseRequest('{"action":"ping","token":"t"}')).toEqual({ ok: true, value: { action: 'ping', token: 't' } })
  })

  it('JSON이 아니거나 action이 없으면 거부한다', () => {
    expect(gs.parseRequest('nope').ok).toBe(false)
    expect(gs.parseRequest('{"token":"t"}').ok).toBe(false)
    expect(gs.parseRequest('').ok).toBe(false)
  })
})

describe('checkToken', () => {
  it('설정된 토큰과 같을 때만 통과한다', () => {
    expect(gs.checkToken('secret-123', 'secret-123')).toBe(true)
    expect(gs.checkToken('secret-124', 'secret-123')).toBe(false)
    expect(gs.checkToken('', 'secret-123')).toBe(false)
  })

  it('서버에 토큰이 설정되지 않았으면 모두 거부한다', () => {
    expect(gs.checkToken('anything', '')).toBe(false)
    expect(gs.checkToken('anything', null)).toBe(false)
  })
})

describe('validateIncomingTransaction', () => {
  it('올바른 기록은 정리된 값으로 통과한다', () => {
    const result = gs.validateIncomingTransaction({ ...tx('t1'), partner: ' 대한수지 ' })
    expect(result.ok).toBe(true)
    expect(result.value.partner).toBe('대한수지')
  })

  it.each([
    ['구분', { type: 'MOVE' }],
    ['수량 0', { qty: 0 }],
    ['수량 소수', { qty: 1.5 }],
    ['품번 형식', { partNo: 'sk ad' }],
    ['일시', { createdAt: 'yesterday' }],
    ['ID 없음', { id: '' }],
    ['메모 길이', { memo: 'x'.repeat(201) }],
  ])('%s 이(가) 잘못되면 거부한다', (_, extra) => {
    expect(gs.validateIncomingTransaction(tx('t1', extra)).ok).toBe(false)
  })

  it('취소 기록은 refId가 있어야 한다', () => {
    expect(gs.validateIncomingTransaction(tx('c1', { type: 'CANCEL', refId: null })).ok).toBe(false)
    expect(gs.validateIncomingTransaction(tx('c1', { type: 'CANCEL', refId: 't1' })).ok).toBe(true)
  })
})

describe('validateIncomingPart', () => {
  it('올바른 부품은 통과한다', () => {
    expect(gs.validateIncomingPart(part).ok).toBe(true)
  })

  it('품번·품명·단위·안전재고·수정일시가 잘못되면 거부한다', () => {
    expect(gs.validateIncomingPart({ ...part, partNo: '' }).ok).toBe(false)
    expect(gs.validateIncomingPart({ ...part, name: '' }).ok).toBe(false)
    expect(gs.validateIncomingPart({ ...part, unit: '' }).ok).toBe(false)
    expect(gs.validateIncomingPart({ ...part, safetyStock: -1 }).ok).toBe(false)
    expect(gs.validateIncomingPart({ ...part, updatedAt: 'x' }).ok).toBe(false)
  })
})

describe('planPush', () => {
  const existing = { transactions: [tx('t1')], parts: [part] }

  it('새 기록은 추가하고, 이미 있는 ID는 중복으로 알린다 (다시 보내도 안전)', () => {
    const plan = gs.planPush(existing, { parts: [], transactions: [tx('t1'), tx('t2')] })
    expect(plan.appendTransactions.map((t) => t.id)).toEqual(['t2'])
    expect(plan.duplicateIds).toEqual(['t1'])
    expect(plan.acceptedIds).toEqual(['t2'])
  })

  it('같은 요청 안에서 ID가 겹쳐도 한 번만 추가한다', () => {
    const plan = gs.planPush(existing, { parts: [], transactions: [tx('t3'), tx('t3')] })
    expect(plan.appendTransactions).toHaveLength(1)
    expect(plan.duplicateIds).toEqual(['t3'])
  })

  it('잘못된 기록은 이유와 함께 거부한다', () => {
    const plan = gs.planPush(existing, { parts: [], transactions: [tx('bad', { qty: -1 })] })
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0].id).toBe('bad')
    expect(plan.appendTransactions).toHaveLength(0)
  })

  it('취소 기록은 시트나 같은 요청에 원래 기록이 있어야 한다', () => {
    const ok = gs.planPush(existing, { parts: [], transactions: [tx('c1', { type: 'CANCEL', refId: 't1' })] })
    expect(ok.acceptedIds).toEqual(['c1'])
    const sameBatch = gs.planPush(existing, { parts: [], transactions: [tx('t9'), tx('c9', { type: 'CANCEL', refId: 't9' })] })
    expect(sameBatch.acceptedIds).toEqual(['t9', 'c9'])
    const missing = gs.planPush(existing, { parts: [], transactions: [tx('c2', { type: 'CANCEL', refId: 'zzz' })] })
    expect(missing.rejected[0].id).toBe('c2')
  })

  it('이미 취소된 기록을 다시 취소하면 거부한다', () => {
    const withCancel = { ...existing, transactions: [tx('t1'), tx('c1', { type: 'CANCEL', refId: 't1' })] }
    const plan = gs.planPush(withCancel, { parts: [], transactions: [tx('c2', { type: 'CANCEL', refId: 't1' })] })
    expect(plan.rejected[0].id).toBe('c2')
  })

  it('부품은 새로 추가하거나, 수정일시가 더 최신일 때만 바꾼다', () => {
    const newer = { ...part, name: '덕트 센터', updatedAt: '2026-10-06T00:00:00.000Z' }
    const older = { ...part, name: '옛 이름', updatedAt: '2026-10-01T00:00:00.000Z' }
    const fresh = { ...part, partNo: 'SK-AD-002' }
    const plan = gs.planPush(existing, { parts: [newer, fresh], transactions: [] })
    expect(plan.partUpserts.map((u) => [u.part.partNo, u.rowIndex])).toEqual([
      ['SK-AD-001', 0],
      ['SK-AD-002', null],
    ])
    expect(gs.planPush(existing, { parts: [older], transactions: [] }).partUpserts).toHaveLength(0)
  })

  it('한 번에 보낼 수 있는 양을 넘으면 거부한다', () => {
    const many = Array.from({ length: 501 }, (_, i) => tx(`m${i}`))
    expect(() => gs.planPush(existing, { parts: [], transactions: many })).toThrow(/500/)
  })
})

describe('행 변환', () => {
  it('기록을 시트 행으로 바꾸고 다시 읽으면 같은 값이 나온다', () => {
    const t = tx('t1', { refId: null, memo: '메모' })
    const row = gs.txToRow(t, NOW)
    expect(row[row.length - 1]).toBe(NOW)
    expect(gs.rowToTx(row)).toEqual(t)
  })

  it('부품을 시트 행으로 바꾸고 다시 읽으면 같은 값이 나온다', () => {
    expect(gs.rowToPart(gs.partToRow(part))).toEqual(part)
  })

  it('시트가 숫자·날짜 칸을 다른 형식으로 돌려줘도 읽는다', () => {
    const row = gs.partToRow(part)
    row[gs.PART_COLUMNS.indexOf('safetyStock')] = '10'
    row[gs.PART_COLUMNS.indexOf('active')] = 'TRUE'
    expect(gs.rowToPart(row)).toMatchObject({ safetyStock: 10, active: true })
  })

  it('수식으로 해석될 수 있는 글자는 작은따옴표를 붙여 저장하고 읽을 때 지운다', () => {
    const t = tx('t1', { memo: '=HYPERLINK("x")' })
    const row = gs.txToRow(t, NOW)
    expect(row[gs.TX_COLUMNS.indexOf('memo')]).toBe('\'=HYPERLINK("x")')
    expect(gs.rowToTx(row).memo).toBe('=HYPERLINK("x")')
  })
})

describe('리뷰 반영: 서버 판단 로직', () => {
  it('전체 바꾸기는 마지막으로 본 리비전이 서버와 같을 때만 허용한다', () => {
    expect(gs.checkReplaceAllowed({ expectedRevision: 3 }, 3).ok).toBe(true)
    expect(gs.checkReplaceAllowed({ expectedRevision: 2 }, 3)).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it('사용자가 덮어쓰기를 직접 고르면(force) 리비전이 달라도 허용한다', () => {
    expect(gs.checkReplaceAllowed({ expectedRevision: 2, force: true }, 3).ok).toBe(true)
  })

  it('리비전 없이 보내면 force일 때만 허용한다 (처음 연결하며 이 기기로 덮어쓰기)', () => {
    expect(gs.checkReplaceAllowed({ expectedRevision: null, force: true }, 7).ok).toBe(true)
    expect(gs.checkReplaceAllowed({ expectedRevision: null }, 7).ok).toBe(false)
    expect(gs.checkReplaceAllowed({}, 0).ok).toBe(false)
  })

  it('받기 위치 직전 행의 ID가 클라이언트가 아는 것과 다르면 전체를 다시 보낸다', () => {
    expect(gs.needsFullPull({ dataVersion: 'v1', txOffset: 0 }, 'v1', null)).toBe(false)
    expect(gs.needsFullPull({ dataVersion: 'v1', txOffset: 2, lastRowId: 't2' }, 'v1', 't2')).toBe(false)
    expect(gs.needsFullPull({ dataVersion: 'v1', txOffset: 2, lastRowId: 't2' }, 'v1', 'tX')).toBe(true)
    expect(gs.needsFullPull({ dataVersion: 'v0', txOffset: 2, lastRowId: 't2' }, 'v1', 't2')).toBe(true)
    expect(gs.needsFullPull({ dataVersion: 'v1', txOffset: 5, lastRowId: 't5' }, 'v1', null)).toBe(true)
  })

  it('시트에서 읽은 행 중 형식이 잘못된 것은 걸러서 따로 센다', () => {
    const good = tx('t1')
    const bad = { ...tx('t2'), qty: NaN }
    const result = gs.filterValidRows([good, bad])
    expect(result.transactions.map((t) => t.id)).toEqual(['t1'])
    expect(result.invalidCount).toBe(1)
  })

  it('탭·줄바꿈으로 시작하는 값도 수식 방지 처리한다', () => {
    const row = gs.txToRow(tx('t1', { memo: '\t=1+1' }), NOW)
    expect(row[gs.TX_COLUMNS.indexOf('memo')].charAt(0)).toBe("'")
  })
})
