/**
 * 점검 보고서 AI 초안: 앱이 보낸 보고서 데이터(글만)로 Claude가 네 문단을 써서 돌려준다.
 * Ocr.gs의 API 키·모델 설정(CLAUDE_API_KEY, CLAUDE_MODEL, CLAUDE_EFFORT)과 callClaude·withQuotaLock을 함께 쓴다.
 * 스크립트 속성(선택): REPORT_DAILY_LIMIT(기본 20, 0이면 끔). 사용 횟수는 REPORT_USAGE에 서류 읽기와 따로 센다.
 */

function readReportUsage(props) {
  try {
    return JSON.parse(props.getProperty('REPORT_USAGE') || 'null')
  } catch (e) {
    return null
  }
}

function consumeReportQuota(props) {
  return withQuotaLock(function () {
    var quota = checkReportQuota(readReportUsage(props), todayInSeoul(), parseReportLimit(props.getProperty('REPORT_DAILY_LIMIT')))
    if (quota.ok) props.setProperty('REPORT_USAGE', JSON.stringify(quota.next))
    return quota
  })
}

function refundReportQuota(props) {
  withQuotaLock(function () {
    var usage = refundOcrQuota(readReportUsage(props), todayInSeoul())
    if (usage) props.setProperty('REPORT_USAGE', JSON.stringify(usage))
    return { ok: true }
  })
}

function logReportResult(result) {
  var body = result.body || {}
  if (result.status !== 200) {
    console.error('Claude API 오류(보고서):', result.status, body.error ? body.error.type + ' ' + body.error.message : '')
    return
  }
  var usage = body.usage || {}
  console.log('보고서 초안 완료:', body.model, '입력 토큰', usage.input_tokens, '출력 토큰', usage.output_tokens, '종료', body.stop_reason)
}

function handleReportDraft(req, props) {
  var apiKey = readApiKey(props)
  if (!apiKey) return fail('REPORT_NOT_CONFIGURED', 'AI 초안이 아직 설정되지 않았습니다. 관리자에게 Apps Script에 CLAUDE_API_KEY를 넣어 달라고 하세요.')
  var input = sanitizeReportInput(req.report)
  if (!input.ok) return input
  var quota = consumeReportQuota(props)
  if (!quota.ok) return quota

  var body = buildReportRequest(input.value, {
    model: props.getProperty('CLAUDE_MODEL') || DEFAULT_CLAUDE_MODEL,
    effort: props.getProperty('CLAUDE_EFFORT') || DEFAULT_CLAUDE_EFFORT,
  })
  var result
  try {
    result = callClaude(apiKey, body)
  } catch (error) {
    console.error('Claude API 연결 실패(보고서):', error && error.message ? error.message : error)
    refundReportQuota(props)
    return fail('REPORT_FAILED', 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
  logReportResult(result)
  var parsed = parseReportResponse(result.status, result.body)
  if (!parsed.ok && isRefundableFailure(result.status)) refundReportQuota(props)
  return parsed
}

// ── 보고서 제출: reports 시트에 기록하고 PDF를 붙여 메일로 보낸다 ──
// 스크립트 속성(선택): REPORT_RECIPIENTS(받는 사람, 쉼표로 구분, 최대 5명). 비었으면 배포한 본인 계정으로 보낸다.

// 중복 확인에 필요한 열(보고서 키·제출 일시·메일 상태)만 읽는다
function readReportIndex(sheet) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  if (total === 0) return []
  var rows = sheet.getRange(2, 1, total, REPORT_COLUMNS.length).getValues()
  var at = function (row, col) {
    return fromTextCell(row[REPORT_COLUMNS.indexOf(col)])
  }
  return rows.map(function (row) {
    return { reportKey: at(row, 'reportKey'), submittedAt: at(row, 'submittedAt'), mailStatus: at(row, 'mailStatus') }
  })
}

function setMailStatus(sheet, rowNumber, status) {
  sheet.getRange(rowNumber, REPORT_COLUMNS.indexOf('mailStatus') + 1, 1, 1).setValues([[status]])
}

function sendReportMail(sub, submittedAt, recipients) {
  if (recipients.length === 0) return { status: MAIL_STATUS.FAILED, warning: '받는 사람 주소가 없습니다. 스크립트 속성 REPORT_RECIPIENTS를 확인하세요.' }
  if (MailApp.getRemainingDailyQuota() < recipients.length) {
    return { status: MAIL_STATUS.QUOTA, warning: '오늘 보낼 수 있는 메일 수를 다 썼습니다. 내일 [메일 다시 보내기]를 누르세요.' }
  }
  try {
    var html = buildReportHtml(sub, submittedAt)
    var pdf = Utilities.newBlob(html, 'text/html', 'report.html').getAs('application/pdf').setName(reportFileName(sub))
    MailApp.sendEmail({ to: recipients.join(','), subject: reportMailSubject(sub), htmlBody: html, attachments: [pdf], name: '현장점검 보고서' })
    return { status: MAIL_STATUS.SENT, warning: '' }
  } catch (error) {
    console.error('보고서 메일 발송 실패:', error && error.message ? error.message : error)
    return { status: MAIL_STATUS.FAILED, warning: '시트에는 기록했지만 메일을 보내지 못했습니다. 잠시 후 [메일 다시 보내기]를 누르세요.' }
  }
}

function handleSubmitReport(req, props) {
  var sub = sanitizeSubmission(req.report)
  if (!sub.ok) return sub
  var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS)
  var index = readReportIndex(sheet)
  var plan = planSubmission(index, sub.value.key)
  var recipients = parseRecipients(props.getProperty('REPORT_RECIPIENTS'), Session.getEffectiveUser().getEmail())
  var submittedAt = plan.append ? new Date().toISOString() : index[plan.rowIndex].submittedAt
  var rowNumber = plan.append ? sheet.getLastRow() + 1 : plan.rowIndex + 2
  // 시트에 먼저 기록한다 (메일이 실패해도 제출 기록은 남고, 다시 누르면 메일만 다시 보낸다)
  if (plan.append) writeRows(sheet, REPORT_COLUMNS, rowNumber, [reportToRow(sub.value, submittedAt, recipients, MAIL_STATUS.PENDING)])
  var mail = { status: index[plan.rowIndex] ? index[plan.rowIndex].mailStatus : MAIL_STATUS.PENDING, warning: '' }
  if (plan.sendMail) {
    mail = sendReportMail(sub.value, submittedAt, recipients)
    setMailStatus(sheet, rowNumber, mail.status)
  }
  return {
    ok: true, duplicate: !plan.append, submittedAt: submittedAt, mailStatus: mail.status, recipients: recipients.length,
    warning: mail.warning || undefined,
  }
}
