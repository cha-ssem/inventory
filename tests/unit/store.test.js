import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from '../../src/data/store.js'
import { serializeBackup } from '../../src/domain/backup.js'

const NOW = '2026-10-04T05:00:00.000Z'

const fakeStorage = (initial = null) => {
  let saved = initial
  return {
    load: () => saved,
    save: vi.fn((s) => {
      saved = s
      return true
    }),
    clear: vi.fn(() => {
      saved = null
      return true
    }),
    peek: () => saved,
  }
}

const makeStore = (initial) => {
  let n = 0
  const storage = fakeStorage(initial)
  const store = createStore({ storage, now: () => NOW, makeId: () => `id-${++n}` })
  return { store, storage }
}

const partInput = { partNo: 'SK-AD-001', name: '덕트', unit: 'EA', safetyStock: 5 }

describe('createStore', () => {
  let store
  let storage

  beforeEach(() => {
    ;({ store, storage } = makeStore())
  })

  it('저장된 데이터가 없으면 빈 상태로 시작한다', () => {
    expect(store.getState()).toEqual({ parts: [], transactions: [] })
  })

  it('저장된 데이터가 있으면 불러온다', () => {
    const initial = { parts: [{ partNo: 'A' }], transactions: [] }
    expect(makeStore(initial).store.getState()).toEqual(initial)
  })

  describe('부품', () => {
    it('부품을 등록하면 저장하고 구독자에게 알린다', () => {
      const listener = vi.fn()
      store.subscribe(listener)
      const result = store.addPart(partInput)
      expect(result.ok).toBe(true)
      expect(store.getState().parts[0]).toMatchObject({ partNo: 'SK-AD-001', active: true })
      expect(storage.save).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('검증에 실패하면 상태를 바꾸지 않는다', () => {
      const result = store.addPart({ partNo: '', name: '', unit: '' })
      expect(result.ok).toBe(false)
      expect(result.errors.partNo).toBeTruthy()
      expect(store.getState().parts).toHaveLength(0)
      expect(storage.save).not.toHaveBeenCalled()
    })

    it('부품을 수정한다', () => {
      store.addPart(partInput)
      const result = store.editPart('SK-AD-001', { ...partInput, name: '덕트 센터' })
      expect(result.ok).toBe(true)
      expect(store.getState().parts[0].name).toBe('덕트 센터')
    })

    it('없는 부품은 수정할 수 없다', () => {
      expect(store.editPart('NOPE', partInput).ok).toBe(false)
    })

    it('부품 사용 여부를 바꾼다', () => {
      store.addPart(partInput)
      expect(store.setPartActive('SK-AD-001', false).ok).toBe(true)
      expect(store.getState().parts[0].active).toBe(false)
      expect(store.setPartActive('NOPE', false).ok).toBe(false)
    })

    it('CSV로 부품을 한꺼번에 등록하고 오류 줄을 알려준다', () => {
      const result = store.importParts('품번,품명,단위\nA1,부품,EA\n,빈품번,EA')
      expect(result.ok).toBe(true)
      expect(result.added).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(store.getState().parts).toHaveLength(1)
    })

    it('CSV에 등록할 부품이 하나도 없으면 실패로 알린다', () => {
      const result = store.importParts('품번,품명,단위\n,빈품번,EA')
      expect(result.ok).toBe(false)
      expect(storage.save).not.toHaveBeenCalled()
    })
  })

  describe('입고·출고', () => {
    beforeEach(() => {
      store.addPart(partInput)
    })

    it('입고를 기록한다', () => {
      const result = store.recordInbound({ partNo: 'sk-ad-001', qty: 10, partner: '대한수지' })
      expect(result.ok).toBe(true)
      expect(result.after).toBe(10)
      expect(store.getState().transactions).toHaveLength(1)
    })

    it('등록되지 않은 품번은 입고할 수 없고 미등록임을 알린다', () => {
      const result = store.recordInbound({ partNo: 'NEW-01', qty: 1 })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('UNKNOWN_PART')
    })

    it('사용 중지된 부품은 입고할 수 없다', () => {
      store.setPartActive('SK-AD-001', false)
      const result = store.recordInbound({ partNo: 'SK-AD-001', qty: 1 })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INACTIVE_PART')
    })

    it('수량이 잘못되면 입고할 수 없다', () => {
      expect(store.recordInbound({ partNo: 'SK-AD-001', qty: 0 }).ok).toBe(false)
    })

    it('출고하면 재고가 줄고, 안전재고 아래로 떨어지면 low를 알려준다', () => {
      store.recordInbound({ partNo: 'SK-AD-001', qty: 10 })
      const result = store.recordOutbound({ partNo: 'SK-AD-001', qty: 7, partner: '1라인', worker: '김자재' })
      expect(result).toMatchObject({ ok: true, after: 3, low: true })
      expect(store.getState().transactions[1]).toMatchObject({ type: 'OUT', worker: '김자재' })
    })

    it('현재고보다 많이 출고할 수 없다', () => {
      store.recordInbound({ partNo: 'SK-AD-001', qty: 2 })
      const result = store.recordOutbound({ partNo: 'SK-AD-001', qty: 3 })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('INSUFFICIENT_STOCK')
      expect(store.getState().transactions).toHaveLength(1)
    })

    it('기록을 취소하면 취소 기록이 추가되고 재고가 되돌아간다', () => {
      store.recordInbound({ partNo: 'SK-AD-001', qty: 10 })
      const out = store.recordOutbound({ partNo: 'SK-AD-001', qty: 4 })
      const result = store.cancelTransaction(out.value.id, { memo: '착오' })
      expect(result.ok).toBe(true)
      expect(store.getState().transactions).toHaveLength(3)
      expect(store.getStockMap().get('SK-AD-001')).toBe(10)
    })

    it('없는 기록은 취소할 수 없다', () => {
      expect(store.cancelTransaction('nope').ok).toBe(false)
    })

    it('취소 규칙을 어기면 거부한다', () => {
      const inbound = store.recordInbound({ partNo: 'SK-AD-001', qty: 10 })
      store.recordOutbound({ partNo: 'SK-AD-001', qty: 8 })
      expect(store.cancelTransaction(inbound.value.id).ok).toBe(false)
    })
  })

  describe('데이터 관리', () => {
    it('샘플 데이터를 불러온다', () => {
      store.loadSample()
      expect(store.getState().parts.length).toBe(25)
      expect(store.getState().transactions.length).toBeGreaterThan(50)
    })

    it('전체 초기화한다', () => {
      store.addPart(partInput)
      store.resetAll()
      expect(store.getState()).toEqual({ parts: [], transactions: [] })
      expect(storage.clear).toHaveBeenCalled()
    })

    it('백업 파일로 복원한다', () => {
      const backup = serializeBackup({ parts: [{ partNo: 'Z1', name: '복원', unit: 'EA', safetyStock: 0, active: true }], transactions: [] }, NOW)
      expect(store.restoreBackup(backup).ok).toBe(true)
      expect(store.getState().parts[0].partNo).toBe('Z1')
    })

    it('잘못된 백업 파일은 거부하고 상태를 유지한다', () => {
      store.addPart(partInput)
      expect(store.restoreBackup('nope').ok).toBe(false)
      expect(store.getState().parts).toHaveLength(1)
    })

    it('저장에 실패하면 결과에 경고를 담는다', () => {
      const storage2 = { load: () => null, save: () => false, clear: () => false }
      const s = createStore({ storage: storage2, now: () => NOW, makeId: () => 'x' })
      const result = s.addPart(partInput)
      expect(result.ok).toBe(true)
      expect(result.warning).toMatch(/저장/)
    })

    it('구독을 해제하면 더 이상 알림을 받지 않는다', () => {
      const listener = vi.fn()
      const unsubscribe = store.subscribe(listener)
      unsubscribe()
      store.addPart(partInput)
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

describe('여러 탭에서 같은 저장소를 쓸 때', () => {
  const sharedStorage = () => {
    let saved = null
    return {
      load: () => (saved ? JSON.parse(saved) : null),
      save: (s) => {
        saved = JSON.stringify(s)
        return true
      },
      clear: () => {
        saved = null
        return true
      },
    }
  }

  it('다른 탭이 저장한 기록을 지우지 않는다', () => {
    const storage = sharedStorage()
    let n = 0
    const makeId = () => `id-${++n}`
    const tabA = createStore({ storage, now: () => NOW, makeId })
    tabA.addPart(partInput)
    const tabB = createStore({ storage, now: () => NOW, makeId })

    tabA.recordInbound({ partNo: 'SK-AD-001', qty: 10 })
    const out = tabB.recordOutbound({ partNo: 'SK-AD-001', qty: 4 })

    expect(out.ok).toBe(true)
    expect(out.after).toBe(6)
    expect(storage.load().transactions).toHaveLength(2)
  })

  it('reload는 저장소의 최신 상태를 읽고 구독자에게 알린다', () => {
    const storage = sharedStorage()
    const tabA = createStore({ storage, now: () => NOW, makeId: () => 'a' })
    const tabB = createStore({ storage, now: () => NOW, makeId: () => 'b' })
    const listener = vi.fn()
    tabB.subscribe(listener)
    tabA.addPart(partInput)
    tabB.reload()
    expect(tabB.getState().parts).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('addCatalog (다른 회사 부품 묶음 추가)', () => {
  const catalogPart = { partNo: 'YP-RV-001', name: '추진기 모듈', spec: '', unit: 'EA', safetyStock: 2, location: 'Y-01', active: true, createdAt: NOW, updatedAt: NOW }
  const openingTx = { id: 'YP-OPEN-001', type: 'IN', partNo: 'YP-RV-001', qty: 6, partner: '', worker: '', memo: '', refId: null, createdAt: NOW }

  it('없는 부품과 그 첫 입고 기록을 더하고, 동기화 보낼 목록에 알린다', () => {
    const onLocalChange = vi.fn()
    const store = createStore({ storage: fakeStorage(), now: () => NOW, onLocalChange })
    store.addPart(partInput)
    onLocalChange.mockClear()
    const result = store.addCatalog({ parts: [catalogPart], transactions: [openingTx] })
    expect(result).toEqual({ ok: true, added: 1 })
    expect(store.getState().parts.map((p) => p.partNo)).toEqual(['SK-AD-001', 'YP-RV-001'])
    expect(store.getStockMap().get('YP-RV-001')).toBe(6)
    expect(onLocalChange).toHaveBeenCalledWith({ parts: [catalogPart], transactions: [openingTx] })
  })

  it('이미 있는 부품은 건드리지 않고, 그 부품의 기록도 더하지 않는다', () => {
    const store = createStore({ storage: fakeStorage(), now: () => NOW })
    store.addCatalog({ parts: [catalogPart], transactions: [openingTx] })
    const again = store.addCatalog({ parts: [{ ...catalogPart, name: '바뀐 이름' }], transactions: [{ ...openingTx, id: 'other' }] })
    expect(again).toEqual({ ok: true, added: 0 })
    expect(store.getState().parts[0].name).toBe('추진기 모듈')
    expect(store.getState().transactions).toHaveLength(1)
  })

  it('이미 있는 기록 ID는 다시 더하지 않는다', () => {
    const store = createStore({ storage: fakeStorage(), now: () => NOW })
    store.addCatalog({ parts: [], transactions: [openingTx] })
    expect(store.getState().transactions).toHaveLength(0)
  })
})

describe('recordOutboundBatch (점검에 쓴 부품 한 번에 출고)', () => {
  const setup = () => {
    let n = 0
    const onLocalChange = vi.fn()
    const store = createStore({ storage: fakeStorage(), now: () => NOW, makeId: () => `id-${++n}`, onLocalChange })
    store.addPart({ partNo: 'YP-SP-001', name: '실링 키트', unit: 'SET', safetyStock: 2 })
    store.addPart({ partNo: 'YP-RV-001', name: '추진기', unit: 'EA', safetyStock: 1 })
    store.recordInbound({ partNo: 'YP-SP-001', qty: 3 })
    store.recordInbound({ partNo: 'YP-RV-001', qty: 1 })
    onLocalChange.mockClear()
    return { store, onLocalChange }
  }

  it('모두 재고가 있으면 한 번에 출고하고 낮아진 품목을 알려 준다', () => {
    const { store, onLocalChange } = setup()
    const result = store.recordOutboundBatch([
      { partNo: 'yp-sp-001', qty: 2, memo: '점검 R-1' },
      { partNo: 'YP-RV-001', qty: 1, memo: '점검 R-1' },
    ])
    expect(result.ok).toBe(true)
    expect(result.value).toHaveLength(2)
    expect(result.low).toEqual(['YP-SP-001', 'YP-RV-001'])
    expect(store.getStockMap().get('YP-SP-001')).toBe(1)
    expect(onLocalChange).toHaveBeenCalledTimes(1)
  })

  it('하나라도 재고가 모자라면 아무것도 출고하지 않는다', () => {
    const { store } = setup()
    const result = store.recordOutboundBatch([
      { partNo: 'YP-SP-001', qty: 1 },
      { partNo: 'YP-RV-001', qty: 2 },
    ])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([{ index: 1, error: expect.stringMatching(/재고/) }])
    expect(store.getStockMap().get('YP-SP-001')).toBe(3)
  })

  it('등록되지 않은 부품이면 거부한다', () => {
    const { store } = setup()
    expect(store.recordOutboundBatch([{ partNo: 'NOPE', qty: 1 }])).toMatchObject({ ok: false, errors: [{ index: 0 }] })
  })

  it('빈 목록은 거부한다', () => {
    const { store } = setup()
    expect(store.recordOutboundBatch([])).toMatchObject({ ok: false })
  })
})

describe('recordOutboundBatch idPrefix', () => {
  it('기록 ID를 접두어로 만들고, 이미 있는 ID면 다시 출고하지 않는다', () => {
    let n = 0
    const store = createStore({ storage: fakeStorage(), now: () => NOW, makeId: () => `id-${++n}` })
    store.addPart({ partNo: 'YP-SP-001', name: '실링 키트', unit: 'SET', safetyStock: 0 })
    store.recordInbound({ partNo: 'YP-SP-001', qty: 5 })
    expect(store.recordOutboundBatch([{ partNo: 'YP-SP-001', qty: 1 }], { idPrefix: 'E-9' }).value[0].id).toBe('E-9-OUT-1')
    expect(store.recordOutboundBatch([{ partNo: 'YP-SP-001', qty: 1 }], { idPrefix: 'E-9' })).toMatchObject({ ok: false })
    expect(store.getStockMap().get('YP-SP-001')).toBe(4)
  })
})
