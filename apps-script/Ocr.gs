/**
 * 서류 사진으로 입고(OCR): 사진을 Claude API에 넘겨 명세서 내용을 받아 온다.
 * API 키는 스크립트 속성 CLAUDE_API_KEY에만 두고 앱(브라우저)으로 보내지 않는다.
 * 스크립트 속성(선택): CLAUDE_MODEL(기본 claude-opus-5-5), CLAUDE_EFFORT(기본 low), OCR_DAILY_LIMIT(기본 50, 0이면 끔)
 */

var SHEET_MAPPINGS = 'mappings'
var CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
var DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
var DEFAULT_CLAUDE_EFFORT = 'low'
var QUOTA_LOCK_MS = 5000

// 읽기에서는 탭을 만들지 않는다 (동시에 만들다 충돌하지 않도록). 탭은 setup()이나 saveMappings가 만든다.
function readMappings() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MAPPINGS)
  if (!sheet) return []
  return readRows(sheet, MAPPING_COLUMNS, 0).rows.map(rowToMapping).filter(function (m) {
    return m.supplier && m.supplierCode && m.partNo
  })
}

function readUsage(props) {
  try {
    return JSON.parse(props.getProperty('OCR_USAGE') || 'null')
  } catch (e) {
    return null
  }
}

function todayInSeoul() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')
}

// 사용 횟수를 바꾸는 동안 잠깐 잠근다 (여러 기기가 동시에 올려도 횟수가 빠지지 않게)
function withQuotaLock(fn) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(QUOTA_LOCK_MS)) return fail('BUSY', '다른 작업이 진행 중입니다. 잠시 후 다시 시도하세요.')
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}

function consumeOcrQuota(props) {
  return withQuotaLock(function () {
    var quota = checkOcrQuota(readUsage(props), todayInSeoul(), parseDailyLimit(props.getProperty('OCR_DAILY_LIMIT')))
    if (quota.ok) props.setProperty('OCR_USAGE', JSON.stringify(quota.next))
    return quota
  })
}

function refundQuota(props) {
  withQuotaLock(function () {
    var usage = refundOcrQuota(readUsage(props), todayInSeoul())
    if (usage) props.setProperty('OCR_USAGE', JSON.stringify(usage))
    return { ok: true }
  })
}

// 대응표를 못 읽어도 이미 사용료를 낸 명세서 결과는 돌려준다
function safeMappingsFor(supplier) {
  try {
    return mappingsForSupplier(readMappings(), supplier)
  } catch (error) {
    console.error('대응표 읽기 실패:', error && error.message ? error.message : error)
    return []
  }
}

function callClaude(apiKey, body) {
  var response = UrlFetchApp.fetch(CLAUDE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: claudeHeaders(apiKey),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  })
  var status = response.getResponseCode()
  var parsed = null
  try {
    parsed = JSON.parse(response.getContentText())
  } catch (e) {
    parsed = null
  }
  return { status: status, body: parsed }
}

function logClaudeResult(result) {
  var body = result.body || {}
  if (result.status !== 200) {
    console.error('Claude API 오류:', result.status, body.error ? body.error.type + ' ' + body.error.message : '')
    return
  }
  var usage = body.usage || {}
  console.log('OCR 완료:', body.model, '입력 토큰', usage.input_tokens, '출력 토큰', usage.output_tokens, '종료', body.stop_reason)
}

function handleOcr(req, props) {
  var apiKey = props.getProperty('CLAUDE_API_KEY')
  if (!apiKey) return fail('OCR_NOT_CONFIGURED', '서류 읽기가 아직 설정되지 않았습니다. 관리자에게 Apps Script에 CLAUDE_API_KEY를 넣어 달라고 하세요.')
  var file = validateOcrFile(req.file)
  if (!file.ok) return file
  var quota = consumeOcrQuota(props)
  if (!quota.ok) return quota

  var body = buildClaudeRequest(file.value, {
    model: props.getProperty('CLAUDE_MODEL') || DEFAULT_CLAUDE_MODEL,
    effort: props.getProperty('CLAUDE_EFFORT') || DEFAULT_CLAUDE_EFFORT,
  })
  var result
  try {
    result = callClaude(apiKey, body)
  } catch (error) {
    console.error('Claude API 연결 실패:', error && error.message ? error.message : error)
    refundQuota(props)
    return fail('OCR_FAILED', 'AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.')
  }
  logClaudeResult(result)
  var parsed = parseClaudeResponse(result.status, result.body)
  if (!parsed.ok) {
    if (isRefundableFailure(result.status)) refundQuota(props)
    return parsed
  }
  return { ok: true, statement: parsed.statement, mappings: safeMappingsFor(parsed.statement.supplier) }
}

// 사람이 직접 고른 "공급사 코드 → 우리 품번"을 저장해서 다음부터 자동으로 연결한다 (OCR-05)
function handleSaveMappings(req) {
  var sheet = getSheet(SHEET_MAPPINGS, MAPPING_COLUMNS)
  var existing = readRows(sheet, MAPPING_COLUMNS, 0).rows.map(rowToMapping)
  var plan = planMappingUpserts(existing, req.mappings || [], new Date().toISOString())
  // 고칠 행은 한 줄씩, 새 행은 한 번에 붙인다 (잠금을 잡고 있는 시간을 줄이기 위해)
  var appends = []
  plan.upserts.forEach(function (u) {
    if (u.rowIndex === null) appends.push(mappingToRow(u.mapping))
    else writeRows(sheet, MAPPING_COLUMNS, u.rowIndex + 2, [mappingToRow(u.mapping)])
  })
  writeRows(sheet, MAPPING_COLUMNS, sheet.getLastRow() + 1, appends)
  return { ok: true, saved: plan.upserts.length, rejected: plan.rejected }
}
