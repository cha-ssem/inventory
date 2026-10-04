/**
 * 부품 입출고관리 - 구글 시트 연동 서버 (2단계)
 * 설치: 구글 시트 → 확장 프로그램 → Apps Script에 이 폴더의 파일을 붙여넣고 setup()을 한 번 실행한 뒤 웹 앱으로 배포한다.
 * 모든 요청은 POST(본문 JSON)이며, 연결 토큰(스크립트 속성 APP_TOKEN)이 맞아야 처리한다.
 */

var SHEET_TX = 'transactions'
var SHEET_PARTS = 'parts'
var REPLACE_LIMIT = 20000
var LOCK_WAIT_MS = 20000

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
  var handler = handlers[request.value.action]
  if (!handler) return fail('BAD_REQUEST', '알 수 없는 요청입니다: ' + request.value.action)

  // 쓰기는 한 번에 하나씩 처리해서 동시에 저장해도 행이 겹치지 않게 한다
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(LOCK_WAIT_MS)) return fail('BUSY', '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.')
  try {
    return handler(request.value, props)
  } catch (error) {
    console.error('요청 처리 실패:', error && error.stack ? error.stack : error)
    return fail('SERVER_ERROR', error && error.message ? error.message : '서버에서 처리하지 못했습니다.')
  } finally {
    lock.releaseLock()
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

function getSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name)
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold')
    sheet.setFrozenRows(1)
    // 품번·일시가 숫자나 날짜로 바뀌지 않도록 모든 칸을 글자 형식으로 둔다 (수량·안전재고 제외)
    sheet.getRange('A:Z').setNumberFormat('@')
    var numberCols = columns === TX_COLUMNS ? ['qty'] : ['safetyStock']
    numberCols.forEach(function (col) {
      var index = columns.indexOf(col) + 1
      sheet.getRange(1, index, sheet.getMaxRows(), 1).setNumberFormat('0')
    })
  }
  return sheet
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

function handlePing(req, props) {
  var tx = readRows(getSheet(SHEET_TX, TX_COLUMNS), TX_COLUMNS, 0)
  return { ok: true, dataVersion: getDataVersion(props), parts: readParts().length, transactions: tx.total, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() }
}

// 클라이언트가 가진 기록 수(txOffset) 이후의 행만 돌려준다. 데이터 버전이 다르면 처음부터 전부 돌려준다.
function handlePull(req, props) {
  var version = getDataVersion(props)
  var full = req.dataVersion !== version
  var tx = readRows(getSheet(SHEET_TX, TX_COLUMNS), TX_COLUMNS, full ? 0 : Number(req.txOffset) || 0)
  return { ok: true, dataVersion: version, full: full, parts: readParts(), transactions: tx.rows.map(rowToTx), txTotal: tx.total }
}

function handlePush(req, props) {
  var txSheet = getSheet(SHEET_TX, TX_COLUMNS)
  var partSheet = getSheet(SHEET_PARTS, PART_COLUMNS)
  var existing = { transactions: readRows(txSheet, TX_COLUMNS, 0).rows.map(rowToTx), parts: readParts() }
  var plan = planPush(existing, { parts: req.parts || [], transactions: req.transactions || [] })
  var receivedAt = new Date().toISOString()

  if (plan.appendTransactions.length > 0) {
    var txRows = plan.appendTransactions.map(function (t) {
      return txToRow(t, receivedAt)
    })
    txSheet.getRange(txSheet.getLastRow() + 1, 1, txRows.length, TX_COLUMNS.length).setValues(txRows)
  }
  plan.partUpserts.forEach(function (u) {
    var rowNumber = u.rowIndex === null ? partSheet.getLastRow() + 1 : u.rowIndex + 2
    partSheet.getRange(rowNumber, 1, 1, PART_COLUMNS.length).setValues([partToRow(u.part)])
  })

  return {
    ok: true,
    dataVersion: getDataVersion(props),
    acceptedIds: plan.acceptedIds,
    duplicateIds: plan.duplicateIds,
    rejected: plan.rejected,
    rejectedParts: plan.rejectedParts,
    txTotal: Math.max(0, txSheet.getLastRow() - 1),
  }
}

// 시트 전체를 받은 데이터로 바꾼다 (샘플 데이터 불러오기·백업 복원·초기화). 데이터 버전이 새로 바뀐다.
function handleReplaceAll(req, props) {
  var parts = req.parts || []
  var transactions = req.transactions || []
  if (parts.length > REPLACE_LIMIT || transactions.length > REPLACE_LIMIT) throw new Error('한 번에 ' + REPLACE_LIMIT + '건까지만 바꿀 수 있습니다.')
  var txPlan = planTransactions([], transactions)
  var partPlan = planParts([], parts)
  if (txPlan.rejected.length > 0 || partPlan.rejectedParts.length > 0) {
    return fail('INVALID_DATA', '형식이 맞지 않는 데이터가 있어 바꾸지 않았습니다.')
  }

  var receivedAt = new Date().toISOString()
  writeAll(getSheet(SHEET_TX, TX_COLUMNS), TX_COLUMNS, txPlan.appendTransactions.map(function (t) {
    return txToRow(t, receivedAt)
  }))
  writeAll(getSheet(SHEET_PARTS, PART_COLUMNS), PART_COLUMNS, partPlan.partUpserts.map(function (u) {
    return partToRow(u.part)
  }))
  var version = Utilities.getUuid()
  props.setProperty('DATA_VERSION', version)
  return { ok: true, dataVersion: version, parts: partPlan.partUpserts.length, transactions: txPlan.appendTransactions.length }
}

function writeAll(sheet, columns, rows) {
  var lastRow = sheet.getLastRow()
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, columns.length).clearContent()
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, columns.length).setValues(rows)
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
