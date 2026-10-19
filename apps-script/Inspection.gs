/**
 * 현장점검(영풍산업) 데이터 동기화: 현장·로봇·점검 이벤트를 시트에 저장한다.
 * 입출고 동기화(push·pull)와 같은 연결 토큰·잠금·서식 규칙을 쓰고, 입출고 시트와 리비전은 건드리지 않는다.
 */

var SHEET_SITES = 'sites'
var SHEET_ROBOTS = 'robots'
var SHEET_INSP_EVENTS = 'insp_events'

function readSites() {
  return readRows(getSheet(SHEET_SITES, SITE_COLUMNS), SITE_COLUMNS, 0).rows.map(rowToSite)
}

function readRobots() {
  return readRows(getSheet(SHEET_ROBOTS, ROBOT_COLUMNS), ROBOT_COLUMNS, 0).rows.map(rowToRobot)
}

// 중복 확인에는 ID 열만 필요하다
function readEventIds(sheet) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  if (total === 0) return []
  return sheet.getRange(2, 1, total, 1).getValues().map(function (row) {
    return fromTextCell(row[0])
  })
}

function readEventIdAt(sheet, offset) {
  if (offset <= 0 || offset > sheet.getLastRow() - 1) return null
  return fromTextCell(sheet.getRange(1 + offset, 1).getValue())
}

function upsertRows(sheet, columns, upserts, toRowFn) {
  upserts.forEach(function (u) {
    var rowNumber = u.rowIndex === null ? sheet.getLastRow() + 1 : u.rowIndex + 2
    writeRows(sheet, columns, rowNumber, [toRowFn(u.item)])
  })
}

function handleInspPush(req) {
  var siteSheet = getSheet(SHEET_SITES, SITE_COLUMNS)
  var robotSheet = getSheet(SHEET_ROBOTS, ROBOT_COLUMNS)
  var eventSheet = getSheet(SHEET_INSP_EVENTS, EVENT_COLUMNS)
  var existing = { sites: readSites(), robots: readRobots(), eventIds: readEventIds(eventSheet) }
  var plan = planInspectionPush(existing, { sites: req.sites, robots: req.robots, events: req.events })
  var receivedAt = new Date().toISOString()

  upsertRows(siteSheet, SITE_COLUMNS, plan.siteUpserts, siteToRow)
  upsertRows(robotSheet, ROBOT_COLUMNS, plan.robotUpserts, robotToRow)
  writeRows(eventSheet, EVENT_COLUMNS, eventSheet.getLastRow() + 1, plan.appendEvents.map(function (e) {
    return eventToRow(e, receivedAt)
  }))
  return {
    ok: true, acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected,
    rejectedMasters: plan.rejectedMasters, total: Math.max(0, eventSheet.getLastRow() - 1),
  }
}

// 클라이언트가 가진 이벤트 수(offset) 이후의 행만 돌려준다. 현장·로봇은 작아서 늘 전부 보낸다.
function handleInspPull(req) {
  var eventSheet = getSheet(SHEET_INSP_EVENTS, EVENT_COLUMNS)
  var offset = Number(req.offset) || 0
  var full = needsFullEventPull(offset, req.lastRowId, readEventIdAt(eventSheet, offset))
  var rows = readRows(eventSheet, EVENT_COLUMNS, full ? 0 : offset)
  var valid = filterValidEvents(rows.rows.map(rowToEvent))
  var lastRowId = rows.rows.length > 0 ? fromTextCell(rows.rows[rows.rows.length - 1][0]) : readEventIdAt(eventSheet, rows.total)
  return {
    ok: true, full: full,
    sites: filterValidMasters(readSites(), validateIncomingSite),
    robots: filterValidMasters(readRobots(), validateIncomingRobot),
    events: valid.events, invalidCount: valid.invalidCount, total: rows.total, lastRowId: lastRowId,
  }
}

function setupInspectionSheets() {
  getSheet(SHEET_SITES, SITE_COLUMNS)
  getSheet(SHEET_ROBOTS, ROBOT_COLUMNS)
  getSheet(SHEET_INSP_EVENTS, EVENT_COLUMNS)
}
