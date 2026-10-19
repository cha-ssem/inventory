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
  var size = checkAiInputSize(input.value)
  if (!size.ok) return size
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
// 스크립트 속성(선택): REPORT_RECIPIENTS(받는 사람, 쉼표로 구분, 최대 5명. 비었으면 배포한 본인),
//                    REPORT_SUBMIT_DAILY_LIMIT(하루 새 제출 수, 기본 10, 0이면 끔). 사용 횟수는 REPORT_SUBMIT_USAGE.
// 잠금은 시트를 읽고 쓰는 동안만 잡는다. PDF 변환·메일은 잠금 밖에서 해서 다른 기기의 저장이 기다리지 않게 한다.
// 메일을 보낸 뒤 결과 기록은 더 오래 기다리며 한 번 더 시도한다. 그래도 못 쓰면 SENDING으로 남아 5분 뒤 다시 보낼 수
// 있으므로, 앱에 경고를 돌려주고 서버 로그에 남긴다.
var MAIL_RECORD_LOCK_WAIT_MS = 25000
var MAIL_RECORD_ATTEMPTS = 2
var MAIL_NOT_RECORDED = '메일은 보냈지만 시트에 메일 상태를 기록하지 못했습니다. 메일이 또 가지 않도록 5분 안에 시트 reports 탭의 mailStatus를 SENT로 고쳐 주세요.'

function withWriteLock(fn, waitMs) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) return fail('BUSY', '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도하세요.')
  try {
    return fn()
  } finally {
    // 시트 쓰기는 모아 두었다가 반영되므로, 잠금을 풀기 전에 반영해야 다음 요청이 최신 시트를 읽는다
    SpreadsheetApp.flush()
    lock.releaseLock()
  }
}

// 중복 확인에 필요한 열(보고서 키·제출 일시·메일 상태·메일 시각)만 읽는다
function readReportIndex(sheet) {
  var total = Math.max(0, sheet.getLastRow() - 1)
  if (total === 0) return []
  var column = function (name) {
    return sheet.getRange(2, REPORT_COLUMNS.indexOf(name) + 1, total, 1).getValues().map(function (r) {
      return fromTextCell(r[0])
    })
  }
  var keys = column('reportKey')
  var submitted = column('submittedAt')
  var status = column('mailStatus')
  var mailAt = column('mailAt')
  return keys.map(function (key, i) {
    return { reportKey: key, submittedAt: submitted[i], mailStatus: status[i], mailAt: mailAt[i] }
  })
}

function readReportRow(sheet, rowNumber) {
  var cells = sheet.getRange(rowNumber, 1, 1, REPORT_COLUMNS.length).getValues()[0]
  var row = {}
  REPORT_COLUMNS.forEach(function (col, i) {
    row[col] = cells[i]
  })
  return row
}

// 예전 줄은 글자 서식이 아닐 수 있어서, 시각이 날짜로 바뀌지 않게 서식을 먼저 건다
function setMailCells(sheet, rowNumber, values) {
  Object.keys(values).forEach(function (col) {
    sheet.getRange(rowNumber, REPORT_COLUMNS.indexOf(col) + 1, 1, 1).setNumberFormat('@').setValues([[toCell(values[col])]])
  })
}

// 메일을 보낸 뒤 결과를 기록한다. 잠금을 못 잡거나 쓰다가 실패하면 한 번 더 시도한다.
function recordMailResult(rowNumber, status) {
  for (var attempt = 1; attempt <= MAIL_RECORD_ATTEMPTS; attempt += 1) {
    try {
      var result = withWriteLock(function () {
        setMailCells(getSheet(SHEET_REPORTS, REPORT_COLUMNS), rowNumber, { mailStatus: status, mailAt: new Date().toISOString() })
        return { ok: true }
      }, MAIL_RECORD_LOCK_WAIT_MS)
      if (result.ok) return true
    } catch (error) {
      console.error('메일 결과 기록 실패:', error && error.message ? error.message : error)
    }
  }
  console.error('메일 결과를 시트에 기록하지 못함: reports 탭', rowNumber, '행, 메일 상태', status)
  return false
}

// 같은 버전 재제출의 내용 비교용. 시트가 글자를 바꿔 저장해도(앞 작은따옴표 등) 비교가 깨지지 않게 해시를 따로 둔다.
function submissionHash(sub) {
  var text = JSON.stringify([sub.title].concat(BODY_KEYS.map(function (k) {
    return sub.body[k]
  })))
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2)
  }).join('')
}

function readSubmitUsage(props) {
  try {
    return JSON.parse(props.getProperty('REPORT_SUBMIT_USAGE') || 'null')
  } catch (e) {
    return null
  }
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

// 1단계(잠금 안): 중복·내용·한도를 확인하고, 새 줄을 쓰거나 기존 줄을 "보내는 중"으로 표시한다
function reserveSubmission(sub, props, recipients) {
  var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS)
  fillMissingHeaders(sheet, REPORT_COLUMNS)
  var index = readReportIndex(sheet)
  var now = new Date()
  var plan = planSubmission(index, sub.key, now.getTime())
  if (!plan.append) {
    var rowNumber = plan.rowIndex + 2
    if (!sameSubmission(readReportRow(sheet, rowNumber), sub)) {
      return fail('CONFLICT', '이미 제출한 같은 버전의 보고서와 내용이 다릅니다. 수정본을 만들어 제출하세요.')
    }
    if (plan.sendMail) setMailCells(sheet, rowNumber, { mailStatus: MAIL_STATUS.SENDING, mailAt: now.toISOString(), mailTo: recipients.join(', ') })
    return { ok: true, rowNumber: rowNumber, duplicate: true, sendMail: plan.sendMail, submittedAt: index[plan.rowIndex].submittedAt, mailStatus: index[plan.rowIndex].mailStatus }
  }
  var quota = checkSubmitQuota(readSubmitUsage(props), todayInSeoul(), parseSubmitLimit(props.getProperty('REPORT_SUBMIT_DAILY_LIMIT')))
  if (!quota.ok) return quota
  var row = sheet.getLastRow() + 1
  writeRows(sheet, REPORT_COLUMNS, row, [reportToRow(sub, now.toISOString(), recipients, MAIL_STATUS.SENDING, now.toISOString())])
  // 줄을 쓴 뒤에 센다 (쓰기가 실패했는데 한도만 줄지 않도록)
  props.setProperty('REPORT_SUBMIT_USAGE', JSON.stringify(quota.next))
  return { ok: true, rowNumber: row, duplicate: false, sendMail: true, submittedAt: now.toISOString(), mailStatus: MAIL_STATUS.SENDING }
}

function handleSubmitReport(req, props) {
  var checked = sanitizeSubmission(req.report)
  if (!checked.ok) return checked
  var sub = withContentHash(checked.value, submissionHash(checked.value))
  var recipients = parseRecipients(props.getProperty('REPORT_RECIPIENTS'), Session.getEffectiveUser().getEmail())
  var reserved = withWriteLock(function () {
    return reserveSubmission(sub, props, recipients)
  })
  if (!reserved.ok) return reserved
  var mail = { status: reserved.mailStatus, warning: '' }
  if (reserved.sendMail) {
    mail = sendReportMail(sub, reserved.submittedAt, recipients)
    // 2단계(잠금 안): 메일 결과를 기록한다
    if (!recordMailResult(reserved.rowNumber, mail.status) && mail.status === MAIL_STATUS.SENT) {
      mail = { status: mail.status, warning: MAIL_NOT_RECORDED }
    }
  }
  return {
    ok: true, duplicate: reserved.duplicate, submittedAt: reserved.submittedAt, mailStatus: mail.status, recipients: recipients.length,
    warning: mail.warning || (mail.status === MAIL_STATUS.SENDING ? '다른 요청이 메일을 보내는 중입니다. 잠시 뒤 상태를 확인하세요.' : undefined),
  }
}
