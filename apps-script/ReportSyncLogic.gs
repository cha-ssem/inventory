/**
 * 점검 보고서 기기 간 동기화의 순수 로직 (Google API를 쓰지 않음). 단위 테스트: tests/unit/reportSyncServer.test.js
 * 확정·제출한 보고서를 report_store 탭에 보고서 하나당 한 줄(JSON)로 둔다. 사람이 읽는 제출 기록은 reports 탭 그대로.
 * ReportSubmitLogic.gs의 REPORT_ID·REPORT_ISO_TIME, ReportLogic.gs의 reportFail, Logic.gs의 toCell·fromTextCell을 함께 쓴다.
 */

var SHEET_REPORT_STORE = 'report_store'
// 셀 하나에 5만 자까지라 JSON을 여러 칸에 나눠 담는다 (8칸 × 45,000자)
var REPORT_STORE_CHUNKS = 8
var REPORT_STORE_CHUNK_SIZE = 45000
var REPORT_STORE_COLUMNS = ['reportId', 'version', 'status', 'mailStatus', 'updatedAt', 'rev'].concat(
  [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
    return 'data' + n
  })
)
var REPORT_STORE_REV_COLUMN = REPORT_STORE_COLUMNS.indexOf('rev')
var MAX_REPORT_PUSH = 20
// 확정본은 내용이 고정이고 제출 상태만 나아간다. 같은 상태면 더 나중에 바뀐 쪽(메일 다시 보내기 결과)을 남긴다.
var REPORT_SYNC_RANK = { FINALIZED: 1, SUBMITTED: 2 }
// 같은 제출 상태면 메일 상태가 나아간 쪽을 먼저 본다 (기기 시계가 어긋나도 "보냄"이 "실패"에 덮이지 않게)
var REPORT_MAIL_RANK = { FAILED: 1, QUOTA: 1, SENDING: 2, SENT: 3 }
// 한 번에 돌려주는 줄 수 (보고서 하나가 수십 KB라 응답과 브라우저 저장이 너무 커지지 않게, 나머지는 이어 받음)
var REPORT_PULL_PAGE = 10
// 칸 앞에 붙이는 글자. JSON 조각이 =, +, - 로 시작해도 시트가 수식이나 숫자로 바꾸지 않게 한다.
var CHUNK_MARK = '~'

function validateStoredReport(raw) {
  var r = raw || {}
  var id = typeof r.reportId === 'string' ? r.reportId : ''
  if (!REPORT_ID.test(id)) return { ok: false, id: id, reason: '보고서 ID가 올바르지 않습니다.' }
  if (!hasOwnKey(REPORT_SYNC_RANK, r.status)) return { ok: false, id: id, reason: '확정하거나 제출한 보고서만 올릴 수 있습니다.' }
  if (!(typeof r.version === 'number' && r.version >= 1 && r.version % 1 === 0)) return { ok: false, id: id, reason: '보고서 버전이 올바르지 않습니다.' }
  if (typeof r.updatedAt !== 'string' || !REPORT_ISO_TIME.test(r.updatedAt)) return { ok: false, id: id, reason: '수정 일시가 올바르지 않습니다.' }
  var json = JSON.stringify(r)
  if (json.length > REPORT_STORE_CHUNKS * REPORT_STORE_CHUNK_SIZE) return { ok: false, id: id, reason: '보고서가 너무 커서 시트에 담을 수 없습니다.' }
  var mailStatus = r.submission && typeof r.submission.mailStatus === 'string' ? r.submission.mailStatus : ''
  return { ok: true, value: { reportId: id, version: r.version, status: r.status, mailStatus: mailStatus, updatedAt: r.updatedAt, json: json } }
}

function hasOwnKey(table, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
}

function rankOf(table, key) {
  return hasOwnKey(table, key) ? table[key] : 0
}

// existing에는 시트 줄의 mailStatus가 있다 (없으면 0)
function isNewerStoredReport(incoming, existing) {
  var diff = rankOf(REPORT_SYNC_RANK, incoming.status) - rankOf(REPORT_SYNC_RANK, existing.status)
  if (diff !== 0) return diff > 0
  var mail = rankOf(REPORT_MAIL_RANK, incoming.mailStatus) - rankOf(REPORT_MAIL_RANK, existing.mailStatus)
  if (mail !== 0) return mail > 0
  return incoming.updatedAt > existing.updatedAt
}

// index: 시트에 있는 줄 [{ reportId, status, mailStatus, updatedAt }] (줄 순서대로)
// 결과 writes의 rowIndex가 null이면 새 줄. 같은 묶음에 같은 보고서가 두 번 와도 한 줄만 쓴다.
function planReportPush(index, reports) {
  var rowOf = {}
  index.forEach(function (row, i) {
    rowOf[row.reportId] = i
  })
  var latest = {}
  var writes = []
  var plan = { writes: writes, acceptedIds: [], duplicateIds: [], rejected: [] }
  ;(Array.isArray(reports) ? reports.slice(0, MAX_REPORT_PUSH) : []).forEach(function (raw) {
    var checked = validateStoredReport(raw)
    if (!checked.ok) {
      plan.rejected.push({ id: checked.id, reason: checked.reason })
      return
    }
    var value = checked.value
    var known = latest[value.reportId] || (rowOf[value.reportId] === undefined ? null : index[rowOf[value.reportId]])
    if (known && !isNewerStoredReport(value, known)) {
      plan.duplicateIds.push(value.reportId)
      return
    }
    latest[value.reportId] = value
    writes.push({ rowIndex: rowOf[value.reportId] === undefined ? null : rowOf[value.reportId], value: value })
    plan.acceptedIds.push(value.reportId)
  })
  // 같은 보고서를 두 번 쓰지 않도록 마지막 것만 남긴다
  plan.writes = writes.filter(function (w) {
    return latest[w.value.reportId] === w.value
  })
  return plan
}

function splitReportJson(json) {
  var cells = []
  for (var i = 0; i < REPORT_STORE_CHUNKS; i += 1) {
    var piece = json.slice(i * REPORT_STORE_CHUNK_SIZE, (i + 1) * REPORT_STORE_CHUNK_SIZE)
    cells.push(piece ? CHUNK_MARK + piece : '')
  }
  return cells
}

function joinReportJson(cells) {
  return cells.map(function (cell) {
    var text = fromTextCell(cell)
    return text.charAt(0) === CHUNK_MARK ? text.slice(1) : text
  }).join('')
}

function storedReportToRow(value, rev) {
  return [toCell(value.reportId), value.version, toCell(value.status), toCell(value.mailStatus), toCell(value.updatedAt), rev].concat(splitReportJson(value.json))
}

// 새 rev의 시작점: 스크립트 속성과 시트에 적힌 가장 큰 rev 중 큰 쪽.
// 쓰다가 실패해 줄은 남고 속성은 못 올렸어도, 같은 rev를 다시 쓰지 않는다 (다른 기기가 줄을 놓치지 않도록).
function nextReportRevBase(index, storedRev) {
  return index.reduce(function (max, row) {
    return Math.max(max, row.rev)
  }, storedRev)
}

// 받을 줄 고르기: since 뒤, 속성에 올라간 rev(currentRev)까지만 (아직 끝나지 않은 쓰기는 다음에).
// rev 순서로 한 쪽(page)만 고르고, 남았으면 more. 돌려주는 rev는 고른 줄의 마지막 rev(없으면 currentRev).
function selectReportPullRows(index, since, currentRev, page) {
  var picked = []
  index.forEach(function (row, i) {
    if (row.rev > since && row.rev <= currentRev) picked.push(i)
  })
  picked.sort(function (a, b) {
    return index[a].rev - index[b].rev
  })
  var size = page || REPORT_PULL_PAGE
  var more = picked.length > size
  var rows = picked.slice(0, size)
  return { rowIndexes: rows, more: more, rev: more ? index[rows[rows.length - 1]].rev : currentRev }
}

// 시트 줄을 보고서로. 손으로 고쳐서 깨진 줄은 null (앱이 받지 않음)
function rowToStoredReport(row) {
  try {
    var report = JSON.parse(joinReportJson(row.slice(REPORT_STORE_REV_COLUMN + 1)))
    var checked = validateStoredReport(report)
    return checked.ok && checked.value.reportId === fromTextCell(row[0]) ? report : null
  } catch (e) {
    return null
  }
}

// 앱이 받은 위치가 시트보다 앞서 있으면(스크립트 속성을 지웠거나 다른 시트에 다시 연결) 처음부터 다시 준다
function reportPullStart(sinceRev, currentRev) {
  var since = Number(sinceRev)
  if (!(since >= 0 && since % 1 === 0) || since > currentRev) return 0
  return since
}
