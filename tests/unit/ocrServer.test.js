import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, it, expect, beforeAll } from 'vitest'

// Apps Script는 파일끼리 전역 이름을 공유하므로 Logic.gs와 OcrLogic.gs를 같은 컨텍스트에서 실행한다
let gs
beforeAll(() => {
  gs = vm.createContext({})
  for (const file of ['Logic.gs', 'OcrLogic.gs']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../../apps-script', file), 'utf-8'), gs)
  }
})

const plain = (value) => JSON.parse(JSON.stringify(value))
const png = { mediaType: 'image/png', data: 'iVBORw0KGgo=' }

describe('validateOcrFile', () => {
  it('JPG·PNG·WEBP·PDF만 받는다', () => {
    for (const mediaType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(gs.validateOcrFile({ mediaType, data: 'AAAA' }).ok).toBe(true)
    }
    expect(gs.validateOcrFile({ mediaType: 'image/gif', data: 'AAAA' }).ok).toBe(false)
    expect(gs.validateOcrFile({ mediaType: 'text/html', data: 'AAAA' }).ok).toBe(false)
  })

  it('비었거나 base64가 아니거나 너무 크면 거부한다', () => {
    expect(gs.validateOcrFile(null).ok).toBe(false)
    expect(gs.validateOcrFile({ mediaType: 'image/png', data: '' }).ok).toBe(false)
    expect(gs.validateOcrFile({ mediaType: 'image/png', data: 'not base64!' }).ok).toBe(false)
    const big = 'A'.repeat(gs.OCR_LIMITS.maxBase64Chars + 4)
    expect(gs.validateOcrFile({ mediaType: 'application/pdf', data: big }).error).toContain('큽니다')
  })

  it('사진은 Claude 사진 한도(5MB)에 맞춰 PDF보다 작게 받는다', () => {
    const overImage = 'A'.repeat(gs.OCR_LIMITS.maxImageBase64Chars + 4)
    expect(gs.validateOcrFile({ mediaType: 'image/jpeg', data: overImage }).code).toBe('TOO_LARGE')
    expect(gs.validateOcrFile({ mediaType: 'application/pdf', data: overImage }).ok).toBe(true)
  })
})

describe('buildClaudeRequest', () => {
  it('이미지는 image 블록, PDF는 document 블록으로 넣고 JSON 형식을 지정한다', () => {
    const body = plain(gs.buildClaudeRequest(png, { model: 'claude-opus-5-5', effort: 'low' }))
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.fallbacks).toBe('default')
    const [fileBlock, textBlock] = body.messages[0].content
    expect(fileBlock).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.data } })
    expect(textBlock.type).toBe('text')

    const pdf = plain(gs.buildClaudeRequest({ mediaType: 'application/pdf', data: 'JVBERi0=' }, { model: 'm', effort: 'low' }))
    expect(pdf.messages[0].content[0].type).toBe('document')
  })

  it('JSON 형식에는 단가·금액 칸이 없다 (OCR-09)', () => {
    const schema = JSON.stringify(gs.buildClaudeRequest(png, { model: 'm', effort: 'low' }).output_config.format.schema)
    expect(schema).not.toMatch(/price|amount/i)
  })

  it('서류 안의 글을 지시로 따르지 말라고 알린다', () => {
    expect(gs.buildClaudeRequest(png, { model: 'm', effort: 'low' }).system).toContain('지시')
  })
})

describe('claudeHeaders', () => {
  it('API 키와 버전, 대체 모델 베타 헤더를 넣는다', () => {
    const headers = plain(gs.claudeHeaders('sk-test'))
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
  })
})

const apiResult = (payload, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(payload) }],
  ...extra,
})

const statement = {
  statementNo: 'DB-1002-338',
  date: '2026-10-03',
  supplier: '동방부품(가상)',
  items: [
    { ourPartNo: 'SK-SB-001', supplierCode: 'DB-CL-500', name: '체결 클립', spec: 'POM', unit: 'BOX', qty: 30 },
    { ourPartNo: '', supplierCode: 'DB-PK-NBR', name: '고무 패킹', spec: 'NBR', unit: 'BOX', qty: 20 },
  ],
}

describe('parseClaudeResponse', () => {
  it('정상 응답에서 명세서 내용을 꺼낸다', () => {
    const result = plain(gs.parseClaudeResponse(200, apiResult(statement)))
    expect(result.ok).toBe(true)
    expect(result.statement.statementNo).toBe('DB-1002-338')
    expect(result.statement.items).toHaveLength(2)
    expect(result.statement.items[1].ourPartNo).toBe('')
  })

  it.each([
    [401, 'OCR_AUTH'],
    [403, 'OCR_AUTH'],
    [429, 'OCR_BUSY'],
    [529, 'OCR_BUSY'],
    [500, 'OCR_FAILED'],
    [400, 'OCR_FAILED'],
  ])('HTTP %i는 %s로 알린다', (status, code) => {
    expect(gs.parseClaudeResponse(status, { type: 'error' }).code).toBe(code)
  })

  it('거절·잘림·형식 오류는 실패로 알린다', () => {
    expect(gs.parseClaudeResponse(200, apiResult(statement, { stop_reason: 'refusal' })).code).toBe('OCR_REFUSED')
    expect(gs.parseClaudeResponse(200, apiResult(statement, { stop_reason: 'max_tokens' })).code).toBe('OCR_FAILED')
    expect(gs.parseClaudeResponse(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] }).code).toBe('OCR_FAILED')
    expect(gs.parseClaudeResponse(200, { stop_reason: 'end_turn', content: [] }).code).toBe('OCR_FAILED')
    expect(gs.parseClaudeResponse(200, null).code).toBe('OCR_FAILED')
  })

  it('오류 메시지에 서버 내부 내용을 담지 않는다', () => {
    const result = gs.parseClaudeResponse(400, { error: { message: 'secret detail' } })
    expect(result.error).not.toContain('secret')
  })
})

describe('sanitizeStatement', () => {
  it('글자를 다듬고 길이를 자르며 품번은 대문자로 바꾼다', () => {
    const result = plain(gs.sanitizeStatement({
      statementNo: ' A-1 ', date: '2026-10-03', supplier: 'x'.repeat(300),
      items: [{ ourPartNo: ' sk-sb-001 ', supplierCode: ' db-1 ', name: ' 클립 ', spec: '', unit: 'box', qty: 3 }],
    }))
    expect(result.statementNo).toBe('A-1')
    expect(result.supplier).toHaveLength(gs.LIMITS.maxText)
    expect(result.items[0]).toEqual({ ourPartNo: 'SK-SB-001', supplierCode: 'DB-1', name: '클립', spec: '', unit: 'BOX', qty: 3 })
  })

  it('수량이 정수가 아니거나 범위를 벗어나면 null로 둔다', () => {
    const items = [1.5, 0, -2, '7', 2000000, null].map((qty) => ({ name: 'a', qty }))
    expect(gs.sanitizeStatement({ items }).items.map((i) => i.qty)).toEqual([null, null, null, null, null, null])
  })

  it('날짜 형식이 아니면 비우고, 품목이 너무 많으면 자른다', () => {
    const items = Array.from({ length: 150 }, () => ({ name: 'a', qty: 1 }))
    const result = gs.sanitizeStatement({ date: '어제', items })
    expect(result.date).toBe('')
    expect(result.items).toHaveLength(gs.OCR_LIMITS.maxItems)
  })

  it('품명도 품번도 공급사 코드도 없는 행은 뺀다', () => {
    expect(gs.sanitizeStatement({ items: [{ name: ' ', qty: 1 }, { supplierCode: 'X', qty: 1 }] }).items).toHaveLength(1)
  })

  it('형식이 이상해도 빈 명세서로 돌려준다', () => {
    expect(plain(gs.sanitizeStatement('nope'))).toEqual({ statementNo: '', date: '', supplier: '', items: [] })
  })
})

describe('checkOcrQuota', () => {
  it('하루 한도 안이면 횟수를 늘린 값을 돌려준다', () => {
    expect(plain(gs.checkOcrQuota({ date: '2026-10-05', count: 3 }, '2026-10-05', 50))).toEqual({ ok: true, next: { date: '2026-10-05', count: 4 } })
  })

  it('날짜가 바뀌면 다시 1부터 센다', () => {
    expect(gs.checkOcrQuota({ date: '2026-10-04', count: 50 }, '2026-10-05', 50).next.count).toBe(1)
    expect(gs.checkOcrQuota(null, '2026-10-05', 50).next.count).toBe(1)
  })

  it('한도에 닿으면 거부한다', () => {
    expect(gs.checkOcrQuota({ date: '2026-10-05', count: 50 }, '2026-10-05', 50).code).toBe('OCR_QUOTA')
  })

  it('한도가 0 이하면 서류 읽기를 끈 것으로 본다', () => {
    expect(gs.checkOcrQuota(null, '2026-10-05', 0).code).toBe('OCR_DISABLED')
  })
})

describe('parseDailyLimit', () => {
  it.each([
    [null, 50],
    ['', 50],
    ['abc', 50],
    ['0', 0],
    ['20', 20],
    ['-1', 0],
  ])('%s → %i', (raw, expected) => {
    expect(gs.parseDailyLimit(raw)).toBe(expected)
  })
})

describe('refundOcrQuota', () => {
  it('같은 날이면 한 번을 되돌리고, 날짜가 바뀌었거나 0이면 그대로 둔다', () => {
    expect(plain(gs.refundOcrQuota({ date: '2026-10-05', count: 3 }, '2026-10-05'))).toEqual({ date: '2026-10-05', count: 2 })
    expect(plain(gs.refundOcrQuota({ date: '2026-10-04', count: 3 }, '2026-10-05'))).toEqual({ date: '2026-10-04', count: 3 })
    expect(plain(gs.refundOcrQuota({ date: '2026-10-05', count: 0 }, '2026-10-05'))).toEqual({ date: '2026-10-05', count: 0 })
    expect(gs.refundOcrQuota(null, '2026-10-05')).toBeNull()
  })
})

describe('isRefundableFailure', () => {
  it('AI 서버 사정(바쁨·서버 오류·연결 실패)일 때만 횟수를 되돌린다', () => {
    expect(gs.isRefundableFailure(null)).toBe(true)
    expect([429, 500, 502, 529].every((s) => gs.isRefundableFailure(s))).toBe(true)
    expect([200, 400, 401].some((s) => gs.isRefundableFailure(s))).toBe(false)
  })
})

describe('normalizeSupplier', () => {
  it.each([
    ['대한수지(가상)', '대한수지'],
    ['(주) 대한 수지', '대한수지'],
    ['㈜대한수지', '대한수지'],
    ['주식회사 대한수지', '대한수지'],
    ['Daehan Resin', 'DAEHANRESIN'],
    ['（주）대한수지', '대한수지'],
    ['(유)대한수지', '대한수지'],
    ['유한회사 대한수지', '대한수지'],
  ])('%s → %s', (input, expected) => {
    expect(gs.normalizeSupplier(input)).toBe(expected)
  })
})

describe('대응표 (공급사 코드 → 우리 품번)', () => {
  const NOW = '2026-10-05T01:00:00.000Z'
  const mapping = (extra = {}) => ({ supplier: '동방부품', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002', ...extra })

  it('올바른 대응은 다듬어서 통과시킨다', () => {
    const result = plain(gs.validateIncomingMapping(mapping({ supplier: ' 동방부품(가상) ', supplierCode: 'db-pk-nbr' })))
    expect(result).toEqual({ ok: true, value: { supplier: '동방부품(가상)', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002' } })
  })

  it.each([
    [{ supplier: '' }],
    [{ supplierCode: '' }],
    [{ partNo: 'sk lower' }],
    [{ supplierCode: 'x'.repeat(200) }],
  ])('잘못된 대응은 거부한다 %#', (extra) => {
    expect(gs.validateIncomingMapping(mapping(extra)).ok).toBe(false)
  })

  it('같은 공급사·코드는 기존 행을 고치고, 새 것은 추가한다', () => {
    const existing = [mapping({ supplier: '동방부품(가상)', partNo: 'SK-SB-009', updatedAt: NOW })]
    const plan = plain(gs.planMappingUpserts(existing, [mapping(), mapping({ supplierCode: 'DB-BR-16', partNo: 'SK-PD-003' }), { supplier: '' }], NOW))
    expect(plan.upserts).toEqual([
      { rowIndex: 0, mapping: { supplier: '동방부품', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002', updatedAt: NOW } },
      { rowIndex: null, mapping: { supplier: '동방부품', supplierCode: 'DB-BR-16', partNo: 'SK-PD-003', updatedAt: NOW } },
    ])
    expect(plan.rejected).toBe(1)
  })

  it('한 요청 안에서 같은 대응이 겹치면 마지막 것만 쓴다', () => {
    const plan = gs.planMappingUpserts([], [mapping(), mapping({ partNo: 'SK-SB-003' })], NOW)
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].mapping.partNo).toBe('SK-SB-003')
  })

  it('명세서 공급자의 대응만 고른다', () => {
    const list = [mapping({ supplier: '동방부품' }), mapping({ supplier: '세진포장' })]
    expect(gs.mappingsForSupplier(list, '(주)동방부품(가상)')).toHaveLength(1)
    expect(gs.mappingsForSupplier(list, '')).toEqual([])
  })

  it('행과 대응을 서로 바꾼다', () => {
    const m = { supplier: '=동방', supplierCode: 'DB-1', partNo: 'SK-1', updatedAt: NOW }
    const row = plain(gs.mappingToRow(m))
    expect(row[0]).toBe("'=동방")
    expect(plain(gs.rowToMapping(row))).toEqual(m)
  })
})
