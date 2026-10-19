import { describe, it, expect } from 'vitest'
import { analyzeLog, buildSampleLog, parseSensorLog, LOG_LIMITS } from '../../src/domain/monitor/logCsv.js'

const robots = [
  { robotId: 'RV-01', model: 'V1', siteId: 'ST-01', name: 'V1 영상 1호기' },
  { robotId: 'RV-03', model: 'V2', siteId: 'ST-03', name: 'V2 소나 1호기' },
  { robotId: 'RV-06', model: 'V4', siteId: null, name: 'V4 로봇팔 1호기' },
]

const csv = (lines) => ['timestamp,robotId,metric,value', ...lines].join('\n')

describe('parseSensorLog', () => {
  it('시각·로봇·지표·값을 읽고 시각 순서로 정렬한다', () => {
    const result = parseSensorLog(csv(['2026-10-19T01:02:00Z,RV-01,depth,12.5', '2026-10-19T01:01:00Z,rv-01,depth,12']), robots)
    expect(result.ok).toBe(true)
    expect(result.rows).toEqual([
      { at: '2026-10-19T01:01:00.000Z', robotId: 'RV-01', metric: 'depth', value: 12 },
      { at: '2026-10-19T01:02:00.000Z', robotId: 'RV-01', metric: 'depth', value: 12.5 },
    ])
  })

  it('한국어 머리글도 읽는다', () => {
    const text = ['시각,로봇,지표,값', '2026-10-19 10:00,RV-01,leak,1'].join('\n')
    expect(parseSensorLog(text, robots).rows).toHaveLength(1)
  })

  it('없는 로봇, 그 모델에 없는 지표, 숫자가 아닌 값, 잘못된 시각은 건너뛰고 이유를 센다', () => {
    const result = parseSensorLog(
      csv(['2026-10-19T01:00:00Z,RV-99,depth,1', '2026-10-19T01:00:00Z,RV-01,armTorque,1', '2026-10-19T01:00:00Z,RV-01,depth,abc', 'yesterday,RV-01,depth,1', '2026-10-19T01:00:00Z,RV-01,depth,3']),
      robots,
    )
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toBe(4)
    expect(result.errors[0]).toMatch(/2행/)
  })

  it('머리글이 맞지 않으면 거부한다', () => {
    expect(parseSensorLog('a,b,c\n1,2,3', robots)).toMatchObject({ ok: false, error: expect.stringMatching(/머리글/) })
  })

  it('따옴표가 깨진 파일은 거부한다', () => {
    expect(parseSensorLog(csv(['"2026,RV-01,depth,1']), robots).ok).toBe(false)
  })

  it('행이 너무 많으면 거부한다', () => {
    const lines = Array.from({ length: LOG_LIMITS.maxRows + 1 }, () => '2026-10-19T01:00:00Z,RV-01,depth,1')
    expect(parseSensorLog(csv(lines), robots)).toMatchObject({ ok: false, error: expect.stringMatching(/행까지/) })
  })

  it('읽을 행이 없으면 거부한다', () => {
    expect(parseSensorLog(csv([]), robots).ok).toBe(false)
  })
})

describe('analyzeLog', () => {
  const minute = (m) => new Date(Date.parse('2026-10-19T01:00:00Z') + m * 60_000).toISOString()
  const series = (robotId, metric, values) => values.map((value, i) => ({ at: minute(i), robotId, metric, value }))

  it('기준을 넘은 구간을 시작·끝 시각, 횟수, 가장 나쁜 값으로 묶는다', () => {
    const rows = series('RV-01', 'motorCurrent', [8, 22, 23, 25, 24, 9, 8])
    const [segment] = analyzeLog(rows, robots)
    expect(segment).toMatchObject({
      robotId: 'RV-01', rule: { id: 'motor-overcurrent' }, from: minute(3), to: minute(4), count: 2, worst: 25,
    })
  })

  it('MIN 기준은 가장 낮은 값을 가장 나쁜 값으로 본다', () => {
    const [segment] = analyzeLog(series('RV-03', 'sonarSignal', [80, 30, 25, 20, 80]), robots)
    expect(segment).toMatchObject({ rule: { id: 'sonar-weak' }, worst: 20 })
  })

  it('떨어진 두 구간은 따로 센다', () => {
    const rows = series('RV-01', 'leak', [0, 1, 0, 1, 0])
    expect(analyzeLog(rows, robots)).toHaveLength(2)
  })

  it('위반이 없으면 빈 목록', () => {
    expect(analyzeLog(series('RV-01', 'depth', [10, 11]), robots)).toEqual([])
  })
})

describe('buildSampleLog', () => {
  it('현장 로봇의 1분 간격 로그를 만들고, 일부러 넣은 이상이 분석에서 나온다', () => {
    const text = buildSampleLog(robots, '2026-10-19T09:00:00.000Z')
    const parsed = parseSensorLog(text, robots)
    expect(parsed.ok).toBe(true)
    expect(parsed.skipped).toBe(0)
    expect(new Set(parsed.rows.map((r) => r.robotId))).toEqual(new Set(['RV-01', 'RV-03']))
    const rules = analyzeLog(parsed.rows, robots).map((s) => s.rule.id)
    expect(rules).toEqual(expect.arrayContaining(['sonar-weak', 'battery-low']))
  })
})
