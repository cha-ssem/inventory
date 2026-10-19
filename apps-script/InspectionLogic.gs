/**
 * 현장점검(영풍산업) 동기화의 순수 로직 (Google API를 쓰지 않음). 단위 테스트: tests/unit/inspectionServer.test.js
 * Logic.gs의 cleanText·isDateString·toCell·fromTextCell·LIMITS를 함께 쓴다.
 */

var SITE_COLUMNS = ['siteId', 'name', 'sector', 'region', 'contact', 'active', 'createdAt', 'updatedAt']
var ROBOT_COLUMNS = ['robotId', 'model', 'name', 'serial', 'siteId', 'active', 'createdAt', 'updatedAt']
var EVENT_COLUMNS = ['id', 'requestId', 'type', 'at', 'actor', 'payload', 'receivedAt']
var INSP_SECTORS = { DAM: true, PORT: true, NUCLEAR: true, SHIPYARD: true, BRIDGE: true, RIVER: true }
var INSP_MODELS = { V1: true, V2: true, V3: true, V4: true }
var INSP_EVENT_TYPES = { REQUEST: true, ASSIGN: true, START: true, COMPLETE: true, CANCEL: true, RECUR: true }
var INSP_LIMITS = { maxId: 64, maxName: 50, maxText: 100, maxPayload: 4000 }
var SITE_ID = /^ST-\d{2,4}$/
var ROBOT_ID = /^RV-\d{2,4}$/
var EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
// 접을 때 글자 순서로 시각을 비교하므로 ISO 형식(앱이 만드는 toISOString)만 받는다
var ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function isShortText(value, max) {
  return value.length <= max
}

function validateIncomingSite(s) {
  if (!s) return { ok: false, reason: '현장 정보가 없습니다.' }
  var value = {
    siteId: cleanText(s.siteId), name: cleanText(s.name), sector: cleanText(s.sector), region: cleanText(s.region),
    contact: cleanText(s.contact), active: s.active !== false, createdAt: s.createdAt, updatedAt: s.updatedAt,
  }
  if (!SITE_ID.test(value.siteId)) return { ok: false, reason: '현장 ID 형식이 올바르지 않습니다.' }
  if (!value.name || !isShortText(value.name, INSP_LIMITS.maxName)) return { ok: false, reason: '현장 이름이 없거나 너무 깁니다.' }
  if (!INSP_SECTORS[value.sector]) return { ok: false, reason: '알 수 없는 분야입니다.' }
  if (!isShortText(value.region, INSP_LIMITS.maxText) || !isShortText(value.contact, INSP_LIMITS.maxText)) return { ok: false, reason: '글자 수가 너무 깁니다.' }
  if (!isDateString(value.createdAt) || !isDateString(value.updatedAt)) return { ok: false, reason: '등록·수정 일시가 올바르지 않습니다.' }
  return { ok: true, value: value }
}

function validateIncomingRobot(r) {
  if (!r) return { ok: false, reason: '로봇 정보가 없습니다.' }
  var siteId = cleanText(r.siteId)
  var value = {
    robotId: cleanText(r.robotId), model: cleanText(r.model), name: cleanText(r.name), serial: cleanText(r.serial),
    siteId: siteId || null, active: r.active !== false, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
  if (!ROBOT_ID.test(value.robotId)) return { ok: false, reason: '로봇 ID 형식이 올바르지 않습니다.' }
  if (!INSP_MODELS[value.model]) return { ok: false, reason: '알 수 없는 로봇 모델입니다.' }
  if (!value.name || !isShortText(value.name, INSP_LIMITS.maxName) || !isShortText(value.serial, INSP_LIMITS.maxText)) return { ok: false, reason: '로봇 이름·번호가 없거나 너무 깁니다.' }
  if (value.siteId !== null && !SITE_ID.test(value.siteId)) return { ok: false, reason: '현장 ID 형식이 올바르지 않습니다.' }
  if (!isDateString(value.createdAt) || !isDateString(value.updatedAt)) return { ok: false, reason: '등록·수정 일시가 올바르지 않습니다.' }
  return { ok: true, value: value }
}

function isValidEventId(value) {
  return typeof value === 'string' && EVENT_ID.test(value) && value.length <= INSP_LIMITS.maxId
}

function isPositiveInteger(v) {
  return typeof v === 'number' && v % 1 === 0 && v >= 1
}

// 종류별로 화면이 쓰는 항목이 있는지 본다 (없으면 화면이 그리다 멈춤)
var PAYLOAD_CHECKS = {
  REQUEST: function (p) {
    return Boolean(cleanText(p.siteId) && cleanText(p.robotId) && cleanText(p.title)) || '요청에 현장·로봇·제목이 없습니다.'
  },
  ASSIGN: function (p) {
    return typeof p.assignee === 'string' || '배정에 담당자가 없습니다.'
  },
  START: function () {
    return true
  },
  COMPLETE: function (p) {
    var partsOk = Array.isArray(p.usedParts) && p.usedParts.every(function (u) {
      return u && typeof u.partNo === 'string' && u.partNo && isPositiveInteger(u.qty)
    })
    return (typeof p.result === 'string' && partsOk) || '완료 결과나 사용 부품 형식이 올바르지 않습니다.'
  },
  CANCEL: function (p) {
    return typeof p.reason === 'string' || '취소 사유가 없습니다.'
  },
  RECUR: function (p) {
    return (p.reading !== null && typeof p.reading === 'object') || '재발생 측정값이 없습니다.'
  },
}

// 내용(payload)은 앱이 만든 JSON 객체 그대로 저장한다. 크기와 종류별 필수 항목을 확인한다.
function validateIncomingEvent(e) {
  if (!e) return { ok: false, reason: '이벤트가 없습니다.' }
  if (!isValidEventId(e.id) || !isValidEventId(e.requestId)) return { ok: false, reason: 'ID 형식이 올바르지 않습니다.' }
  if (!INSP_EVENT_TYPES[e.type]) return { ok: false, reason: '알 수 없는 구분입니다.' }
  if (typeof e.at !== 'string' || !ISO_TIME.test(e.at)) return { ok: false, reason: '일시가 올바르지 않습니다.' }
  var actor = cleanText(e.actor)
  if (!isShortText(actor, INSP_LIMITS.maxName)) return { ok: false, reason: '작성자 이름이 너무 깁니다.' }
  var p = e.payload
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: '내용 형식이 올바르지 않습니다.' }
  if (JSON.stringify(p).length > INSP_LIMITS.maxPayload) return { ok: false, reason: '내용이 너무 깁니다.' }
  var check = PAYLOAD_CHECKS[e.type](p)
  if (check !== true) return { ok: false, reason: check }
  return { ok: true, value: { id: e.id, requestId: e.requestId, type: e.type, at: e.at, actor: actor, payload: p } }
}

// 현장·로봇은 수정일시가 더 최신인 쪽을 남긴다 (rowIndex: 기존 행 위치, 새 항목이면 null)
function planMasters(existing, incoming, key, validate) {
  var current = {}
  existing.forEach(function (item, index) {
    current[item[key]] = { item: item, rowIndex: index }
  })
  var upserts = {}
  var rejected = []
  ;(incoming || []).forEach(function (raw) {
    var result = validate(raw)
    if (!result.ok) return rejected.push({ id: raw && raw[key], reason: result.reason })
    var item = result.value
    var base = upserts[item[key]] || current[item[key]]
    if (base && base.item.updatedAt >= item.updatedAt) return
    upserts[item[key]] = { item: item, rowIndex: current[item[key]] ? current[item[key]].rowIndex : null }
  })
  return {
    upserts: Object.keys(upserts).map(function (k) {
      return upserts[k]
    }),
    rejected: rejected,
  }
}

// 이벤트는 지우지 않고 추가만 하므로, 처음 보는 ID만 덧붙인다
function planEvents(existingIds, incoming) {
  var seen = {}
  existingIds.forEach(function (id) {
    seen[id] = true
  })
  var plan = { append: [], acceptedIds: [], duplicateIds: [], rejected: [] }
  ;(incoming || []).forEach(function (raw) {
    var result = validateIncomingEvent(raw)
    if (!result.ok) return plan.rejected.push({ id: raw && raw.id, reason: result.reason })
    if (seen[result.value.id]) return plan.duplicateIds.push(result.value.id)
    seen[result.value.id] = true
    plan.append.push(result.value)
    plan.acceptedIds.push(result.value.id)
  })
  return plan
}

function planInspectionPush(existing, incoming) {
  var lists = [incoming.sites || [], incoming.robots || [], incoming.events || []]
  if (!lists.every(Array.isArray)) throw new Error('보낸 목록의 형식이 올바르지 않습니다.')
  if (lists.some(function (list) { return list.length > LIMITS.maxBatch })) {
    throw new Error('한 번에 ' + LIMITS.maxBatch + '건까지만 보낼 수 있습니다.')
  }
  var sites = planMasters(existing.sites, lists[0], 'siteId', validateIncomingSite)
  var robots = planMasters(existing.robots, lists[1], 'robotId', validateIncomingRobot)
  var events = planEvents(existing.eventIds, lists[2])
  return {
    siteUpserts: sites.upserts,
    robotUpserts: robots.upserts,
    rejectedMasters: sites.rejected.concat(robots.rejected),
    appendEvents: events.append,
    acceptedIds: events.acceptedIds,
    duplicateIds: events.duplicateIds,
    rejected: events.rejected,
  }
}

function toRow(columns, item) {
  return columns.map(function (col) {
    return toCell(item[col])
  })
}

function readActive(value) {
  return !(value === false || String(value).toUpperCase() === 'FALSE')
}

function fromRow(columns, row) {
  var item = {}
  columns.forEach(function (col, i) {
    item[col] = fromTextCell(row[i])
  })
  return item
}

function siteToRow(site) {
  return toRow(SITE_COLUMNS, site)
}

function rowToSite(row) {
  var site = fromRow(SITE_COLUMNS, row)
  site.active = readActive(row[SITE_COLUMNS.indexOf('active')])
  return site
}

function robotToRow(robot) {
  return toRow(ROBOT_COLUMNS, robot)
}

function rowToRobot(row) {
  var robot = fromRow(ROBOT_COLUMNS, row)
  robot.siteId = robot.siteId || null
  robot.active = readActive(row[ROBOT_COLUMNS.indexOf('active')])
  return robot
}

function eventToRow(event, receivedAt) {
  return EVENT_COLUMNS.map(function (col) {
    if (col === 'receivedAt') return receivedAt
    if (col === 'payload') return JSON.stringify(event.payload)
    return toCell(event[col])
  })
}

function rowToEvent(row) {
  var get = function (col) {
    return row[EVENT_COLUMNS.indexOf(col)]
  }
  var payload = null
  try {
    payload = JSON.parse(String(get('payload')))
  } catch (e) {
    payload = null
  }
  return {
    id: fromTextCell(get('id')), requestId: fromTextCell(get('requestId')), type: fromTextCell(get('type')),
    at: fromTextCell(get('at')), actor: fromTextCell(get('actor')), payload: payload,
  }
}

// 사람이 시트를 직접 고쳐 형식이 깨진 행이나, 복사해서 ID가 겹친 행은 보내지 않고 개수만 알린다
function filterValidEvents(events) {
  var valid = []
  var seen = {}
  var invalidCount = 0
  events.forEach(function (event) {
    var result = validateIncomingEvent(event)
    if (result.ok && !seen[result.value.id]) {
      seen[result.value.id] = true
      valid.push(result.value)
    } else {
      invalidCount += 1
    }
  })
  return { events: valid, invalidCount: invalidCount }
}

function filterValidMasters(items, validate) {
  return items.filter(function (item) {
    return validate(item).ok
  })
}

// 처음 받거나, 받기 위치 직전 행의 ID가 클라이언트가 아는 것과 다르면(행 삭제·정렬) 전체를 다시 보낸다
function needsFullEventPull(offset, lastRowId, idBeforeOffset) {
  if (!offset) return true
  return !lastRowId || idBeforeOffset !== lastRowId
}
