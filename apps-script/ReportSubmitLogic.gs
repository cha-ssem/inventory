/**
 * 점검 보고서 제출(시트 기록·메일)의 순수 로직 (Google API를 쓰지 않음). 단위 테스트: tests/unit/reportSubmitServer.test.js
 * ReportLogic.gs의 sanitizeReportInput·sanitizeReportBody, Logic.gs의 cleanText·toCell을 함께 쓴다.
 */

var SHEET_REPORTS = 'reports'
var REPORT_COLUMNS = [
  'reportKey', 'reportId', 'version', 'title', 'period', 'from', 'to', 'sites', 'author', 'aiUsed',
  'completed', 'issue', 'open', 'urgentOpen', 'summary', 'findings', 'actions', 'nextPlan',
  'finalizedAt', 'submittedAt', 'mailTo', 'mailStatus',
]
var REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
var EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/
var MAX_RECIPIENTS = 5
var MAIL_STATUS = { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED', QUOTA: 'QUOTA' }

// 확정한 보고서만 받는다. 보고서 데이터는 AI 초안과 같은 규칙으로 정리하고, 문장·확정 정보를 더한다.
function sanitizeSubmission(raw) {
  var data = raw || {}
  if (typeof data.reportId !== 'string' || !REPORT_ID.test(data.reportId)) return reportFail('BAD_REQUEST', '보고서 ID가 올바르지 않습니다.')
  var version = Number(data.version)
  if (!(version >= 1 && version % 1 === 0)) return reportFail('BAD_REQUEST', '보고서 버전이 올바르지 않습니다.')
  if (!isDateString(data.finalizedAt)) return reportFail('BAD_REQUEST', '확정한 보고서만 제출할 수 있습니다.')
  var input = sanitizeReportInput(data)
  if (!input.ok) return input
  var body = sanitizeReportBody(data.body)
  if (!body.summary) return reportFail('BAD_REQUEST', '요약이 없는 보고서는 제출할 수 없습니다.')
  var value = input.value
  value.key = data.reportId + '|' + version
  value.reportId = data.reportId
  value.version = version
  value.author = clipText(data.author, 50)
  value.aiUsed = data.aiUsed === true
  value.finalizedAt = data.finalizedAt
  value.body = body
  return { ok: true, value: value }
}

// 스크립트 속성 REPORT_RECIPIENTS(쉼표·줄바꿈으로 구분). 비었으면 배포한 본인 주소로만 보낸다.
// 앱이 받는 사람을 정하지 못하게 해서, 토큰이 새도 다른 사람에게 메일을 보내는 데 쓰이지 않도록 한다.
function parseRecipients(raw, fallback) {
  var list = String(raw || '').split(/[,\n;]/).map(function (s) {
    return s.trim()
  }).filter(function (s) {
    return EMAIL.test(s)
  })
  if (list.length === 0 && EMAIL.test(fallback || '')) list = [fallback]
  return list.slice(0, MAX_RECIPIENTS)
}

function reportToRow(sub, submittedAt, mailTo, mailStatus) {
  var values = {
    reportKey: sub.key, reportId: sub.reportId, version: sub.version, title: sub.title, period: sub.period, from: sub.from, to: sub.to,
    sites: sub.siteNames.join(', '), author: sub.author, aiUsed: sub.aiUsed ? 'Y' : '',
    completed: sub.stats.completed, issue: sub.stats.issue, open: sub.stats.open, urgentOpen: sub.stats.urgentOpen,
    summary: sub.body.summary, findings: sub.body.findings, actions: sub.body.actions, nextPlan: sub.body.nextPlan,
    finalizedAt: sub.finalizedAt, submittedAt: submittedAt, mailTo: mailTo.join(', '), mailStatus: mailStatus,
  }
  return REPORT_COLUMNS.map(function (col) {
    return toCell(values[col])
  })
}

// 같은 보고서(ID·버전)를 다시 제출하면 줄을 늘리지 않는다. 메일은 아직 보내지 못한 경우에만 다시 보낸다.
// rows: [{ reportKey, mailStatus }]
function planSubmission(rows, key) {
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].reportKey === key) return { append: false, rowIndex: i, sendMail: rows[i].mailStatus !== MAIL_STATUS.SENT }
  }
  return { append: true, rowIndex: null, sendMail: true }
}

var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
    return HTML_ESCAPES[ch]
  })
}

function htmlText(value) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

var RESULT_LABELS = { OK: '이상 없음', ISSUE: '조치 필요', FAIL: '점검 불가' }
var PRIORITY_LABELS = { HIGH: '긴급', MID: '보통', LOW: '낮음' }
var STATUS_LABELS = { REQUESTED: '요청', ASSIGNED: '배정', IN_PROGRESS: '점검 중' }
var CELL = 'border:1px solid #ccd;padding:4px 6px;text-align:left;vertical-align:top;'

function htmlTable(headers, rows) {
  if (rows.length === 0) return '<p style="color:#666">없음</p>'
  var head = headers.map(function (h) {
    return '<th style="' + CELL + 'background:#eef4f5">' + escapeHtml(h) + '</th>'
  }).join('')
  var body = rows.map(function (cells) {
    return '<tr>' + cells.map(function (c) {
      return '<td style="' + CELL + '">' + escapeHtml(c) + '</td>'
    }).join('') + '</tr>'
  }).join('')
  return '<table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>'
}

function htmlSection(title, inner) {
  return '<h3 style="font-size:14px;border-left:3px solid #0e7c86;padding-left:6px;margin:16px 0 6px">' + escapeHtml(title) + '</h3>' + inner
}

// 메일 본문이자 PDF 첨부의 내용. 모든 글은 escapeHtml을 거친다.
function buildReportHtml(sub, submittedAt) {
  var s = sub.stats
  var meta = [
    '기간: ' + sub.from + (sub.from === sub.to ? '' : ' ~ ' + sub.to),
    '현장: ' + sub.siteNames.join(', '),
    '작성: ' + (sub.author || '-') + ' · 버전 ' + sub.version + (sub.aiUsed ? ' · AI 초안 사용' : ''),
    '확정: ' + sub.finalizedAt + ' · 제출: ' + submittedAt,
  ].map(function (line) {
    return '<div>' + escapeHtml(line) + '</div>'
  }).join('')
  var stats = '완료 ' + s.completed + '건(이상 없음 ' + s.ok + ', 조치 필요 ' + s.issue + ', 점검 불가 ' + s.fail + ') · 새 요청 ' + s.newRequests +
    '건 · 남은 요청 ' + s.open + '건(긴급 ' + s.urgentOpen + ') · 사용 부품 ' + s.partsUsed + '개'
  var completed = htmlTable(['현장', '로봇', '점검', '결과', '사용 부품'], sub.completed.map(function (c) {
    var parts = c.usedParts.map(function (u) {
      return u.partNo + ' ×' + u.qty
    }).join(', ')
    return [c.siteName, c.robotName, c.title, RESULT_LABELS[c.result] || c.result, parts || '-']
  }))
  var open = htmlTable(['우선', '현장', '점검', '상태', '담당', '예정일'], sub.open.map(function (o) {
    return [PRIORITY_LABELS[o.priority] || o.priority, o.siteName, o.title, STATUS_LABELS[o.status] || o.status, o.assignee || '-', o.dueDate || '-']
  }))
  return '<div style="font-family:sans-serif;font-size:13px;line-height:1.55;color:#111">' +
    '<h2 style="font-size:18px;border-bottom:2px solid #0e7c86;padding-bottom:6px">' + escapeHtml(sub.title) + '</h2>' + meta +
    htmlSection('요약 숫자', '<p>' + escapeHtml(stats) + '</p>') +
    htmlSection('요약', '<p>' + htmlText(sub.body.summary) + '</p>') +
    htmlSection('완료한 점검', completed) +
    htmlSection('주요 발견 사항', '<p>' + htmlText(sub.body.findings) + '</p>') +
    htmlSection('조치 사항', '<p>' + htmlText(sub.body.actions) + '</p>') +
    htmlSection('남은 점검 요청', open) +
    htmlSection('다음 계획', '<p>' + htmlText(sub.body.nextPlan) + '</p>') +
    '</div>'
}

function reportMailSubject(sub) {
  return '[점검 보고서] ' + sub.title + ' v' + sub.version
}

function reportFileName(sub) {
  return (sub.title + ' v' + sub.version).replace(/[\\/:*?"<>|]/g, '_') + '.pdf'
}
