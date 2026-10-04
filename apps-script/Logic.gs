/**
 * 순수 로직 (Google API를 쓰지 않음). 단위 테스트: tests/unit/appsScript.test.js
 * Apps Script는 모듈이 없어서 파일끼리 전역 이름을 공유한다. 상수는 var, 함수는 function 선언으로 쓴다.
 */

var TX_COLUMNS = ['id', 'type', 'partNo', 'qty', 'partner', 'worker', 'memo', 'refId', 'createdAt', 'receivedAt']
var PART_COLUMNS = ['partNo', 'name', 'spec', 'unit', 'safetyStock', 'location', 'active', 'createdAt', 'updatedAt']
var TX_TYPES = { IN: true, OUT: true, CANCEL: true }
var LIMITS = { maxQty: 1000000, maxText: 100, maxMemo: 200, maxPartNo: 30, maxBatch: 500 }
var PART_NO_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/
var FORMULA_PREFIX = /^[=+\-@]/

function parseRequest(body) {
  var data
  try {
    data = JSON.parse(body)
  } catch (e) {
    return { ok: false, error: '요청 형식이 JSON이 아닙니다.' }
  }
  if (!data || typeof data.action !== 'string') return { ok: false, error: 'action이 없습니다.' }
  return { ok: true, value: data }
}

// 길이가 같으면 끝까지 비교해서 응답 시간으로 토큰을 추측하기 어렵게 한다
function checkToken(provided, expected) {
  if (!expected || typeof provided !== 'string' || provided.length !== String(expected).length) return false
  var diff = 0
  for (var i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ String(expected).charCodeAt(i)
  return diff === 0
}

function cleanText(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function isDateString(value) {
  return typeof value === 'string' && !isNaN(Date.parse(value))
}

function textTooLong(values, max) {
  return values.some(function (v) {
    return v.length > max
  })
}

function validateIncomingTransaction(tx) {
  if (!tx || typeof tx.id !== 'string' || !tx.id) return { ok: false, reason: 'ID가 없습니다.' }
  if (!TX_TYPES[tx.type]) return { ok: false, reason: '알 수 없는 구분입니다.' }
  var partNo = cleanText(tx.partNo)
  if (!PART_NO_PATTERN.test(partNo) || partNo.length > LIMITS.maxPartNo) return { ok: false, reason: '품번 형식이 올바르지 않습니다.' }
  if (typeof tx.qty !== 'number' || tx.qty % 1 !== 0 || tx.qty < 1 || tx.qty > LIMITS.maxQty) return { ok: false, reason: '수량이 올바르지 않습니다.' }
  if (!isDateString(tx.createdAt)) return { ok: false, reason: '일시가 올바르지 않습니다.' }
  var partner = cleanText(tx.partner)
  var worker = cleanText(tx.worker)
  var memo = cleanText(tx.memo)
  if (textTooLong([partner, worker], LIMITS.maxText) || memo.length > LIMITS.maxMemo) return { ok: false, reason: '글자 수가 너무 깁니다.' }
  var refId = tx.refId ? String(tx.refId) : null
  if (tx.type === 'CANCEL' && !refId) return { ok: false, reason: '취소 기록에 원래 기록 ID가 없습니다.' }
  return {
    ok: true,
    value: { id: tx.id, type: tx.type, partNo: partNo, qty: tx.qty, partner: partner, worker: worker, memo: memo, refId: refId, createdAt: tx.createdAt },
  }
}

function validateIncomingPart(p) {
  if (!p) return { ok: false, reason: '부품 정보가 없습니다.' }
  var value = {
    partNo: cleanText(p.partNo),
    name: cleanText(p.name),
    spec: cleanText(p.spec),
    unit: cleanText(p.unit),
    safetyStock: p.safetyStock,
    location: cleanText(p.location),
    active: p.active !== false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
  if (!PART_NO_PATTERN.test(value.partNo) || value.partNo.length > LIMITS.maxPartNo) return { ok: false, reason: '품번 형식이 올바르지 않습니다.' }
  if (!value.name || !value.unit) return { ok: false, reason: '품명과 단위는 꼭 있어야 합니다.' }
  if (textTooLong([value.name, value.spec, value.unit, value.location], LIMITS.maxText)) return { ok: false, reason: '글자 수가 너무 깁니다.' }
  if (typeof value.safetyStock !== 'number' || value.safetyStock % 1 !== 0 || value.safetyStock < 0) return { ok: false, reason: '안전재고가 올바르지 않습니다.' }
  if (!isDateString(value.createdAt) || !isDateString(value.updatedAt)) return { ok: false, reason: '등록·수정 일시가 올바르지 않습니다.' }
  return { ok: true, value: value }
}

function planTransactions(existingTransactions, incoming) {
  var byId = {}
  var cancelled = {}
  existingTransactions.forEach(function (t) {
    byId[t.id] = t
    if (t.type === 'CANCEL' && t.refId) cancelled[t.refId] = true
  })
  var plan = { appendTransactions: [], acceptedIds: [], duplicateIds: [], rejected: [] }

  incoming.forEach(function (raw) {
    var result = validateIncomingTransaction(raw)
    if (!result.ok) return plan.rejected.push({ id: raw && raw.id, reason: result.reason })
    var tx = result.value
    if (byId[tx.id]) return plan.duplicateIds.push(tx.id)
    if (tx.type === 'CANCEL') {
      var target = byId[tx.refId]
      if (!target || target.type === 'CANCEL') return plan.rejected.push({ id: tx.id, reason: '취소할 원래 기록이 없습니다.' })
      if (cancelled[tx.refId]) return plan.rejected.push({ id: tx.id, reason: '이미 취소된 기록입니다.' })
      cancelled[tx.refId] = true
    }
    byId[tx.id] = tx
    plan.appendTransactions.push(tx)
    plan.acceptedIds.push(tx.id)
  })
  return plan
}

// 부품은 수정일시가 더 최신인 쪽을 남긴다 (rowIndex: 기존 행 위치, 새 부품이면 null)
function planParts(existingParts, incoming) {
  var current = {}
  existingParts.forEach(function (p, index) {
    current[p.partNo] = { part: p, rowIndex: index }
  })
  var upserts = {}
  var rejectedParts = []
  incoming.forEach(function (raw) {
    var result = validateIncomingPart(raw)
    if (!result.ok) return rejectedParts.push({ partNo: raw && raw.partNo, reason: result.reason })
    var part = result.value
    var base = upserts[part.partNo] || current[part.partNo]
    if (base && base.part.updatedAt >= part.updatedAt) return
    upserts[part.partNo] = { part: part, rowIndex: current[part.partNo] ? current[part.partNo].rowIndex : null }
  })
  return {
    partUpserts: Object.keys(upserts).map(function (k) {
      return upserts[k]
    }),
    rejectedParts: rejectedParts,
  }
}

function planPush(existing, incoming) {
  var transactions = incoming.transactions || []
  var parts = incoming.parts || []
  if (transactions.length > LIMITS.maxBatch || parts.length > LIMITS.maxBatch) {
    throw new Error('한 번에 ' + LIMITS.maxBatch + '건까지만 보낼 수 있습니다.')
  }
  var txPlan = planTransactions(existing.transactions, transactions)
  var partPlan = planParts(existing.parts, parts)
  return {
    appendTransactions: txPlan.appendTransactions,
    acceptedIds: txPlan.acceptedIds,
    duplicateIds: txPlan.duplicateIds,
    rejected: txPlan.rejected,
    partUpserts: partPlan.partUpserts,
    rejectedParts: partPlan.rejectedParts,
  }
}

// 시트가 수식으로 실행하지 않도록 작은따옴표를 붙여 저장한다
function toCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' && FORMULA_PREFIX.test(value)) return "'" + value
  return value
}

function fromTextCell(value) {
  if (value === null || value === undefined) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString()
  var text = String(value)
  return text.charAt(0) === "'" && FORMULA_PREFIX.test(text.slice(1)) ? text.slice(1) : text
}

function fromNumberCell(value) {
  return typeof value === 'number' ? value : Number(value)
}

function txToRow(tx, receivedAt) {
  return TX_COLUMNS.map(function (col) {
    return col === 'receivedAt' ? receivedAt : toCell(tx[col])
  })
}

function rowToTx(row) {
  var get = function (col) {
    return row[TX_COLUMNS.indexOf(col)]
  }
  var refId = fromTextCell(get('refId'))
  return {
    id: fromTextCell(get('id')),
    type: fromTextCell(get('type')),
    partNo: fromTextCell(get('partNo')),
    qty: fromNumberCell(get('qty')),
    partner: fromTextCell(get('partner')),
    worker: fromTextCell(get('worker')),
    memo: fromTextCell(get('memo')),
    refId: refId || null,
    createdAt: fromTextCell(get('createdAt')),
  }
}

function partToRow(part) {
  return PART_COLUMNS.map(function (col) {
    return toCell(part[col])
  })
}

function rowToPart(row) {
  var get = function (col) {
    return row[PART_COLUMNS.indexOf(col)]
  }
  var active = get('active')
  return {
    partNo: fromTextCell(get('partNo')),
    name: fromTextCell(get('name')),
    spec: fromTextCell(get('spec')),
    unit: fromTextCell(get('unit')),
    safetyStock: fromNumberCell(get('safetyStock')),
    location: fromTextCell(get('location')),
    active: !(active === false || String(active).toUpperCase() === 'FALSE'),
    createdAt: fromTextCell(get('createdAt')),
    updatedAt: fromTextCell(get('updatedAt')),
  }
}
