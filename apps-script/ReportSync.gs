/**
 * 점검 보고서 기기 간 동기화: 확정·제출한 보고서를 report_store 탭에 저장하고 다른 기기에 돌려준다.
 * 줄을 쓸 때마다 rev(스크립트 속성 REPORT_STORE_REV)를 1씩 올려 줄에 적고, 앱은 받은 rev 이후의 줄만 받는다.
 * reportPush는 Code.gs의 쓰기 잠금 안에서 처리한다.
 */

function getReportStoreSheet() {
  var sheet = getSheet(SHEET_REPORT_STORE, REPORT_STORE_COLUMNS)
  fillMissingHeaders(sheet, REPORT_STORE_COLUMNS)
  return sheet
}

function readReportStoreRev(props) {
  return Number(props.getProperty('REPORT_STORE_REV') || 0)
}

// 중복 확인에 필요한 앞 칸(ID·버전·상태·메일 상태·수정 일시·rev)만 읽는다
function readReportStoreIndex(sheet) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  if (total === 0) return []
  return sheet.getRange(2, 1, total, REPORT_STORE_REV_COLUMN + 1).getValues().map(function (row) {
    return {
      reportId: fromTextCell(row[0]), status: fromTextCell(row[2]), mailStatus: fromTextCell(row[3]), updatedAt: fromTextCell(row[4]),
      rev: Number(row[REPORT_STORE_REV_COLUMN]) || 0,
    }
  })
}

function handleReportPush(req, props) {
  var sheet = getReportStoreSheet()
  var index = readReportStoreIndex(sheet)
  var plan = planReportPush(index, req.reports)
  var rev = nextReportRevBase(index, readReportStoreRev(props))
  var appended = []
  plan.writes.forEach(function (w) {
    rev += 1
    var row = storedReportToRow(w.value, rev)
    if (w.rowIndex === null) appended.push(row)
    else writeRows(sheet, REPORT_STORE_COLUMNS, w.rowIndex + 2, [row])
  })
  // 새 줄은 한 번에 붙인다 (시트 API 호출을 줄임)
  writeRows(sheet, REPORT_STORE_COLUMNS, sheet.getLastRow() + 1, appended)
  if (plan.writes.length > 0) {
    // 줄을 시트에 반영한 뒤에 rev를 올린다 (다른 기기는 속성에 올라간 rev까지만 받는다)
    SpreadsheetApp.flush()
    props.setProperty('REPORT_STORE_REV', String(rev))
  }
  return { ok: true, acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rev: rev }
}

// 한 쪽은 몇 줄뿐이라 한 줄씩 읽는다 (다른 줄의 큰 본문까지 읽지 않도록)
function readReportStoreRows(sheet, rowIndexes) {
  return rowIndexes.map(function (i) {
    return sheet.getRange(i + 2, 1, 1, REPORT_STORE_COLUMNS.length).getValues()[0]
  })
}

// 받은 위치(sinceRev) 이후에 쓴 줄을 한 쪽씩 돌려준다. more면 앱이 돌려준 rev로 이어 받는다.
function handleReportPull(req, props) {
  var currentRev = readReportStoreRev(props)
  var since = reportPullStart(req.sinceRev, currentRev)
  if (since === currentRev) return { ok: true, full: false, more: false, reports: [], invalidCount: 0, rev: currentRev }
  var sheet = getReportStoreSheet()
  var index = readReportStoreIndex(sheet)
  var picked = selectReportPullRows(index, since, currentRev)
  var reports = []
  var invalidCount = 0
  readReportStoreRows(sheet, picked.rowIndexes).forEach(function (cells) {
    var report = rowToStoredReport(cells)
    if (report) reports.push(report)
    else invalidCount += 1
  })
  return { ok: true, full: since === 0, more: picked.more, reports: reports, invalidCount: invalidCount, rev: picked.rev }
}
