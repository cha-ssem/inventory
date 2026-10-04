export const LIMITS = Object.freeze({
  maxQty: 1_000_000,
  maxSafetyStock: 1_000_000,
  maxText: 100,
  maxMemo: 200,
  maxPartNo: 30,
  maxCsvRows: 1000,
})

// 영문 대문자·숫자로 시작하고, 영문 대문자·숫자·하이픈만 쓴다 (바코드 Code128과 호환)
export const PART_NO_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/

export const normalizePartNo = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '')

export const cleanText = (value) => (value === undefined || value === null ? '' : String(value).trim())

// "1e3", "0x10", "+5" 같은 표기는 받지 않고 숫자만 허용한다
const toInteger = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : NaN
  const text = typeof value === 'string' ? value.trim() : ''
  return /^-?\d+$/.test(text) ? Number(text) : NaN
}

export const validateQty = (value) => {
  const qty = toInteger(value)
  if (Number.isNaN(qty) || qty < 1) return { ok: false, error: '수량은 1 이상의 정수로 입력하세요.' }
  if (qty > LIMITS.maxQty) return { ok: false, error: `수량은 ${LIMITS.maxQty.toLocaleString()} 이하로 입력하세요.` }
  return { ok: true, value: qty }
}

const validatePartNo = (partNo, existingParts, editingPartNo) => {
  if (!partNo) return '품번을 입력하세요.'
  if (partNo.length > LIMITS.maxPartNo) return `품번은 ${LIMITS.maxPartNo}자 이하로 입력하세요.`
  if (!PART_NO_PATTERN.test(partNo)) return '품번은 영문 대문자, 숫자, 하이픈(-)만 쓸 수 있고 영문이나 숫자로 시작해야 합니다.'
  const duplicated = existingParts.some((p) => p.partNo === partNo && p.partNo !== editingPartNo)
  return duplicated ? '이미 등록된 품번입니다.' : null
}

const validateSafetyStock = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return { value: 0 }
  const value = toInteger(raw)
  if (Number.isNaN(value) || value < 0 || value > LIMITS.maxSafetyStock) {
    return { error: '안전재고는 0 이상의 정수로 입력하세요.' }
  }
  return { value }
}

const textLengthError = (label, value) =>
  value.length > LIMITS.maxText ? `${label}은(는) ${LIMITS.maxText}자 이하로 입력하세요.` : null

export const validatePart = (input, existingParts, { editingPartNo } = {}) => {
  const value = {
    partNo: normalizePartNo(input.partNo),
    name: cleanText(input.name),
    spec: cleanText(input.spec),
    unit: cleanText(input.unit),
    location: cleanText(input.location),
  }
  const safety = validateSafetyStock(input.safetyStock)

  const candidates = {
    partNo: validatePartNo(value.partNo, existingParts, editingPartNo),
    name: value.name ? textLengthError('품명', value.name) : '품명을 입력하세요.',
    spec: textLengthError('규격', value.spec),
    unit: value.unit ? textLengthError('단위', value.unit) : '단위를 입력하세요.',
    location: textLengthError('보관 위치', value.location),
    safetyStock: safety.error || null,
  }
  const errors = Object.fromEntries(Object.entries(candidates).filter(([, msg]) => msg))

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      partNo: value.partNo,
      name: value.name,
      spec: value.spec,
      unit: value.unit,
      safetyStock: safety.value,
      location: value.location,
    },
  }
}
