import { describe, it, expect } from 'vitest'
import { loadAppsScript } from '../support/fakeGoogle.js'

// 실제 Code.gs·Report.gs를 가짜 Google 서비스 위에서 실행한다
const TOKEN = 'servertoken01234567'
const report = {
  title: '일간 점검 보고서 (2026-10-19)', period: 'DAILY', from: '2026-10-19', to: '2026-10-19', siteNames: ['청솔댐 취수탑'],
  stats: { completed: 1, ok: 1, issue: 0, fail: 0, newRequests: 1, open: 0, urgentOpen: 0, partsUsed: 0 },
  completed: [{ siteName: '청솔댐 취수탑', robotName: 'V1', title: '정기 점검', result: 'OK', findings: '이상 없음', actions: '', usedParts: [] }],
  open: [],
}
const draft = { summary: '점검 1건을 마쳤습니다.', findings: '특이 사항 없음', actions: '조치 사항 없음', nextPlan: '남은 점검 요청 없음' }
const okResponse = () => ({
  status: 200,
  body: { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify(draft) }] },
})

const setup = ({ properties = {}, fetchResponse = okResponse } = {}) => {
  const gas = loadAppsScript({ properties: { APP_TOKEN: TOKEN, CLAUDE_API_KEY: 'sk-ant-test', ...properties }, fetchResponse })
  return { gas, post: (body) => gas.post({ action: 'reportDraft', token: TOKEN, ...body }) }
}

describe('reportDraft 요청', () => {
  it('Claude API를 불러 네 문단을 돌려주고, 사용 횟수를 서류 읽기와 따로 센다', () => {
    const { gas, post } = setup()
    expect(post({ report })).toEqual({ ok: true, body: draft })
    const [call] = gas.fetches
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call.options.headers['x-api-key']).toBe('sk-ant-test')
    expect(JSON.parse(call.options.payload).output_config.format.type).toBe('json_schema')
    expect(JSON.parse(gas.props.REPORT_USAGE).count).toBe(1)
    expect(gas.props.OCR_USAGE).toBeUndefined()
  })

  it('API 키가 없으면 설정 안내를 돌려주고 AI를 부르지 않는다', () => {
    const { gas, post } = setup({ properties: { CLAUDE_API_KEY: '' } })
    expect(post({ report })).toMatchObject({ ok: false, code: 'REPORT_NOT_CONFIGURED' })
    expect(gas.fetches).toHaveLength(0)
  })

  it('보고서 데이터가 틀리면 AI를 부르지 않고 횟수도 쓰지 않는다', () => {
    const { gas, post } = setup()
    expect(post({ report: { ...report, period: 'X' } })).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(gas.fetches).toHaveLength(0)
    expect(gas.props.REPORT_USAGE).toBeUndefined()
  })

  it('하루 한도를 넘으면 거부한다', () => {
    const { post } = setup({ properties: { REPORT_DAILY_LIMIT: '1' } })
    expect(post({ report }).ok).toBe(true)
    expect(post({ report })).toMatchObject({ ok: false, code: 'REPORT_QUOTA' })
  })

  it('AI 서버 사정(바쁨·연결 실패)으로 실패하면 사용 횟수를 되돌린다', () => {
    const busy = setup({ fetchResponse: () => ({ status: 529, body: { error: { type: 'overloaded_error', message: 'x' } } }) })
    expect(busy.post({ report })).toMatchObject({ ok: false, code: 'REPORT_BUSY' })
    expect(JSON.parse(busy.gas.props.REPORT_USAGE).count).toBe(0)

    const down = setup({ fetchResponse: () => ({ throws: 'timeout' }) })
    expect(down.post({ report })).toMatchObject({ ok: false, code: 'REPORT_FAILED' })
    expect(JSON.parse(down.gas.props.REPORT_USAGE).count).toBe(0)
  })

  it('키가 틀린 경우(401)는 횟수를 되돌리지 않는다', () => {
    const { gas, post } = setup({ fetchResponse: () => ({ status: 401, body: { error: { type: 'authentication_error', message: 'x' } } }) })
    expect(post({ report })).toMatchObject({ ok: false, code: 'REPORT_AUTH' })
    expect(JSON.parse(gas.props.REPORT_USAGE).count).toBe(1)
  })

  it('잠금 없이 처리한다 (오래 걸려도 다른 기기의 저장을 막지 않음)', () => {
    const { gas } = setup()
    expect(gas.context.WRITE_ACTIONS.reportDraft).toBeUndefined()
  })
})
