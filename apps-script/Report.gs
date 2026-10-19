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
