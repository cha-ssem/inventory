import { describe, it, expect } from 'vitest'
import { loadAppsScript } from '../support/fakeGoogle.js'

const TOKEN = 'servertoken01234567'
const file = { mediaType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' }
const statement = {
  statementNo: 'DS-2610-0012',
  date: '2026-10-02',
  supplier: '대한수지(가상)',
  items: [{ ourPartNo: 'SK-RM-001', supplierCode: 'DH-PP-25', name: 'PP 수지', spec: '25kg/포', unit: 'BAG', qty: 40 }],
}
const okResponse = () => ({
  status: 200,
  body: { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify(statement) }] },
})

const setup = ({ properties = {}, fetchResponse = okResponse } = {}) =>
  loadAppsScript({ properties: { APP_TOKEN: TOKEN, CLAUDE_API_KEY: 'sk-ant-test', ...properties }, fetchResponse })

describe('ocr 요청', () => {
  it('Claude API를 불러 명세서와 대응표를 돌려준다', () => {
    const gas = setup()
    const result = gas.post({ action: 'ocr', token: TOKEN, file })
    expect(result.ok).toBe(true)
    expect(result.statement.items[0].qty).toBe(40)
    expect(result.mappings).toEqual([])

    const [call] = gas.fetches
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call.options.headers['x-api-key']).toBe('sk-ant-test')
    expect(call.options.muteHttpExceptions).toBe(true)
    const payload = JSON.parse(call.options.payload)
    expect(payload.model).toBe('claude-opus-5-5')
    expect(payload.output_config.effort).toBe('low')
  })

  it('스크립트 속성으로 모델과 effort를 바꿀 수 있다', () => {
    const gas = setup({ properties: { CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_EFFORT: 'medium' } })
    gas.post({ action: 'ocr', token: TOKEN, file })
    const payload = JSON.parse(gas.fetches[0].options.payload)
    expect(payload.model).toBe('claude-sonnet-5-5')
    expect(payload.output_config.effort).toBe('medium')
  })

  it('토큰이 틀리면 AI를 부르지 않는다', () => {
    const gas = setup()
    expect(gas.post({ action: 'ocr', token: 'wrongtoken000000000', file }).code).toBe('UNAUTHORIZED')
    expect(gas.fetches).toHaveLength(0)
  })

  it('API 키가 없으면 설정 안내를 돌려준다', () => {
    const gas = setup({ properties: { CLAUDE_API_KEY: '' } })
    expect(gas.post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_NOT_CONFIGURED')
    expect(gas.fetches).toHaveLength(0)
  })

  it('잘못된 파일은 AI를 부르지 않고 거부한다', () => {
    const gas = setup()
    expect(gas.post({ action: 'ocr', token: TOKEN, file: { mediaType: 'image/gif', data: 'AAAA' } }).ok).toBe(false)
    expect(gas.fetches).toHaveLength(0)
  })

  it('하루 한도를 넘으면 거부하고 횟수를 저장한다', () => {
    const gas = setup({ properties: { OCR_DAILY_LIMIT: '2' } })
    expect(gas.post({ action: 'ocr', token: TOKEN, file }).ok).toBe(true)
    expect(gas.post({ action: 'ocr', token: TOKEN, file }).ok).toBe(true)
    expect(gas.post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_QUOTA')
    expect(gas.fetches).toHaveLength(2)
    expect(JSON.parse(gas.props.OCR_USAGE).count).toBe(2)
  })

  it('한도를 0으로 두면 서류 읽기를 끈다', () => {
    const gas = setup({ properties: { OCR_DAILY_LIMIT: '0' } })
    expect(gas.post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_DISABLED')
    expect(gas.fetches).toHaveLength(0)
  })

  it('AI 서버 사정으로 실패하면 사용 횟수를 되돌리고, 키 오류는 되돌리지 않는다', () => {
    const busy = setup({ fetchResponse: () => ({ status: 529, body: { type: 'error' } }) })
    expect(busy.post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_BUSY')
    expect(JSON.parse(busy.props.OCR_USAGE).count).toBe(0)
    const down = setup({ fetchResponse: () => ({ throws: 'timeout' }) })
    down.post({ action: 'ocr', token: TOKEN, file })
    expect(JSON.parse(down.props.OCR_USAGE).count).toBe(0)
    const auth = setup({ fetchResponse: () => ({ status: 401, body: { type: 'error' } }) })
    auth.post({ action: 'ocr', token: TOKEN, file })
    expect(JSON.parse(auth.props.OCR_USAGE).count).toBe(1)
  })

  it('대응표 탭이 없어도 만들지 않고, 읽기에 실패해도 읽은 명세서는 돌려준다', () => {
    const gas = setup()
    const result = gas.post({ action: 'ocr', token: TOKEN, file })
    expect(result.ok).toBe(true)
    expect(gas.sheets.mappings).toBeUndefined()

    gas.post({ action: 'saveMappings', token: TOKEN, mappings: [{ supplier: '대한수지', supplierCode: 'X', partNo: 'SK-1' }] })
    gas.sheets.mappings.getRange = () => {
      throw new Error('Service Spreadsheets failed')
    }
    const again = gas.post({ action: 'ocr', token: TOKEN, file })
    expect(again.ok).toBe(true)
    expect(again.mappings).toEqual([])
  })

  it('AI 오류는 서버 로그에만 자세히 남기고 앱에는 일반 메시지를 보낸다', () => {
    const gas = setup({ fetchResponse: () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }) })
    const result = gas.post({ action: 'ocr', token: TOKEN, file })
    expect(result.code).toBe('OCR_AUTH')
    expect(JSON.stringify(result)).not.toContain('invalid x-api-key')
    expect(gas.logs.join('\n')).toContain('authentication_error')
  })

  it('연결이 끊기거나 응답이 JSON이 아니어도 멈추지 않는다', () => {
    expect(setup({ fetchResponse: () => ({ throws: 'timeout' }) }).post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_FAILED')
    expect(setup({ fetchResponse: () => ({ status: 502, body: '<html>' }) }).post({ action: 'ocr', token: TOKEN, file }).code).toBe('OCR_FAILED')
  })
})

describe('saveMappings 요청', () => {
  const mapping = { supplier: '동방부품(가상)', supplierCode: 'DB-PK-NBR', partNo: 'SK-SB-002' }

  it('대응표를 시트에 저장하고, 같은 공급자의 다음 ocr 응답에 담는다', () => {
    const gas = setup()
    const resin = { supplier: '대한수지', supplierCode: 'DH-PP-25', partNo: 'SK-RM-001' }
    expect(gas.post({ action: 'saveMappings', token: TOKEN, mappings: [mapping, resin] })).toMatchObject({ ok: true, saved: 2, rejected: 0 })
    expect(gas.post({ action: 'saveMappings', token: TOKEN, mappings: [{ ...resin, partNo: 'SK-RM-009' }, { ...resin, supplierCode: 'DH-ABS-25' }] }).saved).toBe(2)
    expect(gas.sheets.mappings.getLastRow()).toBe(4)
    const result = gas.post({ action: 'ocr', token: TOKEN, file })
    expect(result.mappings.map((m) => [m.supplierCode, m.partNo])).toEqual([['DH-PP-25', 'SK-RM-009'], ['DH-ABS-25', 'SK-RM-001']])
  })

  it('대응표를 저장해도 입출고 데이터 리비전은 그대로다', () => {
    const gas = setup()
    gas.post({ action: 'saveMappings', token: TOKEN, mappings: [mapping] })
    expect(gas.post({ action: 'ping', token: TOKEN }).revision).toBe(0)
  })
})

describe('checkClaudeKey (편집기에서 실행하는 키 점검)', () => {
  it('키 모양과 API 응답을 로그에 남기고, 키 값은 남기지 않는다', () => {
    const gas = setup({
      properties: { CLAUDE_API_KEY: ' sk-ant-api03-secretvalue\n' },
      fetchResponse: () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }),
    })
    gas.context.checkClaudeKey()
    const log = gas.logs.join('\n')
    expect(log).toContain('앞뒤에 공백')
    expect(log).toContain('401')
    expect(log).toContain('authentication_error')
    expect(log).not.toContain('secretvalue')
    expect(gas.fetches[0].options.headers['x-api-key']).toBe('sk-ant-api03-secretvalue')
  })

  it('Admin 키와 빈 키를 알려 준다', () => {
    const admin = setup({ properties: { CLAUDE_API_KEY: 'sk-ant-admin01-x' }, fetchResponse: okResponse })
    admin.context.checkClaudeKey()
    expect(admin.logs.join('\n')).toContain('Admin 키')
    const empty = setup({ properties: { CLAUDE_API_KEY: '' } })
    empty.context.checkClaudeKey()
    expect(empty.logs.join('\n')).toContain('CLAUDE_API_KEY가 없습니다')
    expect(empty.fetches).toHaveLength(0)
  })

  it('정상이면 성공을 알린다', () => {
    const gas = setup()
    gas.context.checkClaudeKey()
    expect(gas.logs.join('\n')).toContain('정상')
  })
})
