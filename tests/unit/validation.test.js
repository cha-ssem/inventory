import { describe, it, expect } from 'vitest'
import { normalizePartNo, validatePart, validateQty, LIMITS } from '../../src/domain/validation.js'

describe('normalizePartNo', () => {
  it('앞뒤 공백을 지우고 대문자로 바꾼다', () => {
    expect(normalizePartNo('  sk-ad-001 ')).toBe('SK-AD-001')
  })

  it('문자열이 아니면 빈 문자열을 돌려준다', () => {
    expect(normalizePartNo(undefined)).toBe('')
    expect(normalizePartNo(null)).toBe('')
  })
})

describe('validateQty', () => {
  it('1 이상의 정수는 통과한다', () => {
    expect(validateQty(1)).toEqual({ ok: true, value: 1 })
    expect(validateQty('25')).toEqual({ ok: true, value: 25 })
  })

  it.each([0, -3, 1.5, 'abc', '', null, LIMITS.maxQty + 1])('%s 는 거부한다', (qty) => {
    const result = validateQty(qty)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('validatePart', () => {
  const valid = {
    partNo: 'sk-ad-001',
    name: '에어벤트 덕트 센터',
    spec: 'PP 사출',
    unit: 'EA',
    safetyStock: '50',
    location: 'A-01-01',
  }

  it('올바른 입력은 정규화된 값과 함께 통과한다', () => {
    const result = validatePart(valid, [])
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({
      partNo: 'SK-AD-001',
      name: '에어벤트 덕트 센터',
      spec: 'PP 사출',
      unit: 'EA',
      safetyStock: 50,
      location: 'A-01-01',
    })
  })

  it('필수 항목이 비어 있으면 항목별 오류를 돌려준다', () => {
    const result = validatePart({ partNo: '', name: ' ', unit: '', safetyStock: '' }, [])
    expect(result.ok).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual(['name', 'partNo', 'unit'])
  })

  it('안전재고가 비어 있으면 0으로 본다', () => {
    const result = validatePart({ ...valid, safetyStock: '' }, [])
    expect(result.value.safetyStock).toBe(0)
  })

  it('안전재고가 음수이거나 정수가 아니면 거부한다', () => {
    expect(validatePart({ ...valid, safetyStock: -1 }, []).errors.safetyStock).toBeTruthy()
    expect(validatePart({ ...valid, safetyStock: 2.5 }, []).errors.safetyStock).toBeTruthy()
  })

  it('품번 형식이 맞지 않으면 거부한다', () => {
    expect(validatePart({ ...valid, partNo: 'SK AD 001' }, []).errors.partNo).toBeTruthy()
    expect(validatePart({ ...valid, partNo: '한글품번' }, []).errors.partNo).toBeTruthy()
    expect(validatePart({ ...valid, partNo: '-SK' }, []).errors.partNo).toBeTruthy()
  })

  it('이미 있는 품번은 거부한다', () => {
    const result = validatePart(valid, [{ partNo: 'SK-AD-001' }])
    expect(result.errors.partNo).toMatch(/이미/)
  })

  it('수정할 때는 자기 자신의 품번과 겹쳐도 통과한다', () => {
    const result = validatePart(valid, [{ partNo: 'SK-AD-001' }], { editingPartNo: 'SK-AD-001' })
    expect(result.ok).toBe(true)
  })

  it('글자 수 제한을 넘으면 거부한다', () => {
    const longName = '가'.repeat(LIMITS.maxText + 1)
    expect(validatePart({ ...valid, name: longName }, []).errors.name).toBeTruthy()
  })
})

describe('validateQty 숫자 형식', () => {
  it.each(['1e3', '0x10', ' 1 0 ', '+5'])('%s 같은 표기는 거부한다', (qty) => {
    expect(validateQty(qty).ok).toBe(false)
  })

  it('앞뒤 공백은 허용한다', () => {
    expect(validateQty(' 7 ')).toEqual({ ok: true, value: 7 })
  })
})
