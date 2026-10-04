/**
 * 부품 입출고관리 - 구글 시트 연동 서버 (2단계)
 * 설치: 구글 시트 → 확장 프로그램 → Apps Script에 이 폴더의 파일을 붙여넣고 setup()을 한 번 실행한 뒤 웹 앱으로 배포한다.
 * 모든 요청은 POST(본문 JSON)이며, 연결 토큰(스크립트 속성 APP_TOKEN)이 맞아야 처리한다.
 */

var SHEET_TX = 'transactions'
var SHEET_PARTS = 'parts'
var REPLACE_LIMIT = 20000
var LOCK_WAIT_MS = 20000
var NUMBER_COLUMNS = { qty: true, safetyStock: true }
var WRITE_ACTIONS = { push: true, replaceAll: true }

function doGet() {
  return jsonOutput({ ok: true, app: 'samkwang-inventory', message: '이 주소는 입출고관리 앱 전용입니다. 요청은 POST로 보내세요.' })
}

function doPost(e) {
  return jsonOutput(handleRequest(e && e.postData ? e.postData.contents : ''))
}

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)
}

function fail(code, error) {
  return { ok: false, code: code, error: error }
}

function handleRequest(body) {
  var request = parseRequest(body)
  if (!request.ok) return fail('BAD_REQUEST', request.error)
  var props = PropertiesService.getScriptProperties()
  if (!checkToken(request.value.token, props.getProperty('APP_TOKEN'))) return fail('UNAUTHORIZED', '연결 토큰이 맞지 않습니다.')

  var handlers = { ping: handlePing, pull: handlePull, push: handlePush, replaceAll: handleReplaceAll }
  var action = request.value.action
  var handler = handlers[action]
  if (!handler) return fail('BAD_REQUEST', '알 수 없는 요청입니다.')

  // 쓰기만 한 번에 하나씩 처리한다. 읽기는 잠금 없이 바로 처리해서 여러 기기가 동시에 받아도 기다리지 않는다.
  var lock = WRITE_ACTIONS[action] ? LockService.getScriptLock() : null
  if (lock && !lock.tryLock(LOCK_WAIT_MS)) return fail('BUSY', '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.')
  try {
    return handler(request.value, props)
  } catch (error) {
    // 자세한 내용은 서버 로그에만 남기고, 앱에는 일반 메시지만 보낸다
    console.error('요청 처리 실패:', action, error && error.stack ? error.stack : error)
    return fail('SERVER_ERROR', '서버에서 처리하지 못했습니다. 잠시 후 다시 시도하세요.')
  } finally {
    if (lock) lock.releaseLock()
  }
}

function getDataVersion(props) {
  var version = props.getProperty('DATA_VERSION')
  if (!version) {
    version = Utilities.getUuid()
    props.setProperty('DATA_VERSION', version)
  }
  return version
}

// 시트에 무엇이든 쓸 때마다 1씩 오른다. 전체 바꾸기 충돌을 막는 데 쓴다.
function getRevision(props) {
  return Number(props.getProperty('REVISION') || 0)
}

function bumpRevision(props) {
  var next = getRevision(props) + 1
  props.setProperty('REVISION', String(next))
  return next
}

function getSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name)
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold')
    sheet.setFrozenRows(1)
  }
  return sheet
}

// 쓸 범위만큼 행을 늘리고(기본 1000행), 그 범위에 서식을 다시 걸어 품번·일시가 숫자나 날짜로 바뀌지 않게 한다
function writeRows(sheet, columns, startRow, rows) {
  if (rows.length === 0) return
  var lastNeeded = startRow + rows.length - 1
  var maxRows = sheet.getMaxRows()
  if (lastNeeded > maxRows) sheet.insertRowsAfter(maxRows, lastNeeded - maxRows)
  var formats = rows.map(function () {
    return columns.map(function (col) {
      return NUMBER_COLUMNS[col] ? '0' : '@'
    })
  })
  var range = sheet.getRange(startRow, 1, rows.length, columns.length)
  range.setNumberFormats(formats)
  range.setValues(rows)
}

function readRows(sheet, columns, offset) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  var start = Math.min(offset || 0, total)
  if (total - start === 0) return { rows: [], total: total }
  return { rows: sheet.getRange(2 + start, 1, total - start, columns.length).getValues(), total: total }
}

function readParts() {
  return readRows(getSheet(SHEET_PARTS, PART_COLUMNS), PART_COLUMNS, 0).rows.map(rowToPart)
}

// 중복 확인에는 ID·구분·원래 기록 ID만 필요하므로 그 열만 읽는다
function readTxIndex(sheet) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  if (total === 0) return []
  var idType = sheet.getRange(2, TX_COLUMNS.indexOf('id') + 1, total, 2).getValues()
  var refIds = sheet.getRange(2, TX_COLUMNS.indexOf('refId') + 1, total, 1).getValues()
  return idType.map(function (row, i) {
    return { id: fromTextCell(row[0]), type: fromTextCell(row[1]), refId: fromTextCell(refIds[i][0]) || null }
  })
}

function readIdAt(sheet, offset) {
  if (offset <= 0 || offset > sheet.getLastRow() - 1) return null
  return fromTextCell(sheet.getRange(1 + offset, TX_COLUMNS.indexOf('id') + 1).getValue())
}

function lastRowIdOf(sheet) {
  return readIdAt(sheet, sheet.getLastRow() - 1)
}

function handlePing(req, props) {
  var txSheet = getSheet(SHEET_TX, TX_COLUMNS)
  return {
    ok: true, dataVersion: getDataVersion(props), revision: getRevision(props),
    parts: readParts().length, transactions: Math.max(0, txSheet.getLastRow() - 1), sheet: SpreadsheetApp.getActiveSpreadsheet().getName(),
  }
}

// 클라이언트가 가진 기록 수(txOffset) 이후의 행만 돌려준다. 버전이 다르거나 시트가 직접 바뀌었으면 처음부터 전부 돌려준다.
function handlePull(req, props) {
  var version = getDataVersion(props)
  var revision = getRevision(props)
  var txSheet = getSheet(SHEET_TX, TX_COLUMNS)
  var offset = Number(req.txOffset) || 0
  var full = needsFullPull(req, version, readIdAt(txSheet, offset))
  var tx = readRows(txSheet, TX_COLUMNS, full ? 0 : offset)
  var valid = filterValidRows(tx.rows.map(rowToTx))
  // 읽는 사이에 다른 기기가 행을 추가할 수 있으므로, 마지막 행 ID는 방금 읽은 범위에서 정한다
  var lastRowId = tx.rows.length > 0 ? fromTextCell(tx.rows[tx.rows.length - 1][0]) : readIdAt(txSheet, tx.total)
  return {
    ok: true, dataVersion: version, revision: revision, full: full, parts: readParts(),
    transactions: valid.transactions, invalidCount: valid.invalidCount, txTotal: tx.total, lastRowId: lastRowId,
  }
}

function handlePush(req, props) {
  var txSheet = getSheet(SHEET_TX, TX_COLUMNS)
  var partSheet = getSheet(SHEET_PARTS, PART_COLUMNS)
  var previousRevision = getRevision(props)
  var existing = { transactions: readTxIndex(txSheet), parts: readParts() }
  var plan = planPush(existing, { parts: req.parts || [], transactions: req.transactions || [] })
  var receivedAt = new Date().toISOString()

  writeRows(txSheet, TX_COLUMNS, txSheet.getLastRow() + 1, plan.appendTransactions.map(function (t) {
    return txToRow(t, receivedAt)
  }))
  plan.partUpserts.forEach(function (u) {
    var rowNumber = u.rowIndex === null ? partSheet.getLastRow() + 1 : u.rowIndex + 2
    writeRows(partSheet, PART_COLUMNS, rowNumber, [partToRow(u.part)])
  })
  var changed = plan.appendTransactions.length > 0 || plan.partUpserts.length > 0
  var revision = changed ? bumpRevision(props) : previousRevision

  return {
    ok: true, dataVersion: getDataVersion(props), revision: revision, previousRevision: previousRevision,
    acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rejectedParts: plan.rejectedParts,
    txTotal: Math.max(0, txSheet.getLastRow() - 1),
  }
}

// 시트 전체를 받은 데이터로 바꾼다 (샘플 데이터 불러오기·백업 복원·초기화). 데이터 버전이 새로 바뀐다.
function handleReplaceAll(req, props) {
  var allowed = checkReplaceAllowed(req, getRevision(props))
  if (!allowed.ok) return allowed
  var parts = req.parts || []
  var transactions = req.transactions || []
  if (parts.length > REPLACE_LIMIT || transactions.length > REPLACE_LIMIT) return fail('TOO_LARGE', '한 번에 ' + REPLACE_LIMIT + '건까지만 바꿀 수 있습니다.')
  var txPlan = planTransactions([], transactions)
  var partPlan = planParts([], parts)
  if (txPlan.rejected.length > 0 || partPlan.rejectedParts.length > 0) {
    return fail('INVALID_DATA', '형식이 맞지 않는 데이터가 있어 바꾸지 않았습니다.')
  }

  var receivedAt = new Date().toISOString()
  var txSheet = getSheet(SHEET_TX, TX_COLUMNS)
  replaceRows(txSheet, TX_COLUMNS, txPlan.appendTransactions.map(function (t) {
    return txToRow(t, receivedAt)
  }))
  replaceRows(getSheet(SHEET_PARTS, PART_COLUMNS), PART_COLUMNS, partPlan.partUpserts.map(function (u) {
    return partToRow(u.part)
  }))
  var version = Utilities.getUuid()
  props.setProperty('DATA_VERSION', version)
  return {
    ok: true, dataVersion: version, revision: bumpRevision(props),
    parts: partPlan.partUpserts.length, transactions: txPlan.appendTransactions.length, lastRowId: lastRowIdOf(txSheet),
  }
}

function replaceRows(sheet, columns, rows) {
  var lastRow = sheet.getLastRow()
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, columns.length).clearContent()
  writeRows(sheet, columns, 2, rows)
}

/** 처음 한 번 편집기에서 실행: 시트를 만들고 연결 토큰을 발급한다. 토큰은 실행 로그에 표시된다. */
function setup() {
  getSheet(SHEET_PARTS, PART_COLUMNS)
  getSheet(SHEET_TX, TX_COLUMNS)
  var props = PropertiesService.getScriptProperties()
  if (!props.getProperty('APP_TOKEN')) props.setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, ''))
  getDataVersion(props)
  console.log('설치 완료. 앱 설정 화면에 입력할 연결 토큰: ' + props.getProperty('APP_TOKEN'))
}

/** 토큰이 노출되었을 때 실행: 새 토큰을 발급한다. 모든 기기에서 새 토큰을 다시 입력해야 한다. */
function rotateToken() {
  var props = PropertiesService.getScriptProperties()
  props.setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, ''))
  console.log('새 연결 토큰: ' + props.getProperty('APP_TOKEN'))
}
