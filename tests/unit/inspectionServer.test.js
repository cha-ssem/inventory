import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

// Apps Script는 파일끼리 전역 이름을 공유하므로 Logic.gs와 함께 실행한다
let gs
beforeAll(() => {
  gs = vm.createContext({})
  for (const file of ['Logic.gs', 'InspectionLogic.gs']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../../apps-script', file), 'utf-8'), gs)
  }
})

const AT = '2026-10-19T01:00:00.000Z'
const LATER = '2026-10-19T02:00:00.000Z'
const site = { siteId: 'ST-01', name: '청솔댐 취수탑', sector: 'DAM', region: '경남', contact: '정댐관', active: true, createdAt: AT, updatedAt: AT }
const robot = { robotId: 'RV-01', model: 'V1', name: 'V1 1호기', serial: 'V1-2501', siteId: 'ST-01', active: true, createdAt: AT, updatedAt: AT }
const event = {
  id: 'E-1', requestId: 'R-1', type: 'REQUEST', at: AT, actor: '김수중',
  payload: { siteId: 'ST-01', robotId: 'RV-01', source: 'MANUAL', priority: 'MID', title: '정기 점검', detail: '' },
}
const plain = (v) => JSON.parse(JSON.stringify(v))

describe('validateIncomingSite / Robot / Event', () => {
  it('올바른 값을 받고 글자 앞뒤 공백을 지운다', () => {
    expect(plain(gs.validateIncomingSite({ ...site, name: ' 청솔댐 취수탑 ' }))).toEqual({ ok: true, value: site })
    expect(plain(gs.validateIncomingRobot(robot))).toEqual({ ok: true, value: robot })
    expect(gs.validateIncomingEvent(event).ok).toBe(true)
  })

  it.each([
    ['현장 ID', () => gs.validateIncomingSite({ ...site, siteId: '=HYPERLINK()' })],
    ['현장 분야', () => gs.validateIncomingSite({ ...site, sector: 'MOON' })],
    ['현장 이름 길이', () => gs.validateIncomingSite({ ...site, name: '가'.repeat(51) })],
    ['현장 수정일시', () => gs.validateIncomingSite({ ...site, updatedAt: 'x' })],
    ['로봇 모델', () => gs.validateIncomingRobot({ ...robot, model: 'V9' })],
    ['로봇 현장 ID', () => gs.validateIncomingRobot({ ...robot, siteId: 'nowhere' })],
    ['이벤트 구분', () => gs.validateIncomingEvent({ ...event, type: 'DROP' })],
    ['이벤트 일시', () => gs.validateIncomingEvent({ ...event, at: '어제' })],
    ['이벤트 ID 길이', () => gs.validateIncomingEvent({ ...event, id: 'x'.repeat(65) })],
    ['이벤트 내용 형식', () => gs.validateIncomingEvent({ ...event, payload: 'text' })],
    ['이벤트 내용 크기', () => gs.validateIncomingEvent({ ...event, payload: { ...event.payload, detail: '가'.repeat(4001) } })],
    ['요청 내용', () => gs.validateIncomingEvent({ ...event, payload: { ...event.payload, title: '' } })],
  ])('%s가 틀리면 거부한다', (_, check) => {
    expect(check().ok).toBe(false)
  })

  it('로봇이 본사에 있으면(현장 없음) 받는다', () => {
    expect(gs.validateIncomingRobot({ ...robot, siteId: '' }).value.siteId).toBe(null)
  })
})

describe('planInspectionPush', () => {
  const empty = { sites: [], robots: [], eventIds: [] }

  it('새 현장·로봇은 추가하고, 이벤트는 처음 보는 ID만 추가한다', () => {
    const plan = gs.planInspectionPush({ ...empty, eventIds: ['E-0'] }, { sites: [site], robots: [robot], events: [event, { ...event, id: 'E-0' }] })
    expect(plan.siteUpserts).toHaveLength(1)
    expect(plan.siteUpserts[0].rowIndex).toBe(null)
    expect(plan.robotUpserts).toHaveLength(1)
    expect(plain(plan.acceptedIds)).toEqual(['E-1'])
    expect(plain(plan.duplicateIds)).toEqual(['E-0'])
  })

  it('수정일시가 더 최신일 때만 기존 행을 바꾼다', () => {
    const existing = { ...empty, sites: [site] }
    expect(gs.planInspectionPush(existing, { sites: [{ ...site, name: '옛 이름' }] }).siteUpserts).toHaveLength(0)
    const newer = gs.planInspectionPush(existing, { sites: [{ ...site, name: '새 이름', updatedAt: LATER }] }).siteUpserts
    expect(newer).toHaveLength(1)
    expect(newer[0].rowIndex).toBe(0)
  })

  it('형식이 틀린 항목은 이유와 함께 돌려준다', () => {
    const plan = gs.planInspectionPush(empty, { sites: [{ ...site, sector: '?' }], events: [{ ...event, type: '?' }] })
    expect(plan.rejectedMasters[0]).toMatchObject({ id: 'ST-01' })
    expect(plan.rejected[0]).toMatchObject({ id: 'E-1' })
  })

  it('같은 요청 안에서 같은 이벤트 ID가 두 번 오면 한 번만 추가한다', () => {
    const plan = gs.planInspectionPush(empty, { events: [event, event] })
    expect(plain(plan.acceptedIds)).toEqual(['E-1'])
    expect(plain(plan.duplicateIds)).toEqual(['E-1'])
  })

  it('한 번에 너무 많이 보내면 거부한다', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ ...event, id: `E-${i}` }))
    expect(() => gs.planInspectionPush(empty, { events })).toThrow(/500건/)
  })
})

describe('행 변환', () => {
  it('이벤트 내용은 JSON 글자로 저장하고 다시 읽는다', () => {
    const row = gs.eventToRow(event, LATER)
    expect(row[gs.EVENT_COLUMNS.indexOf('payload')]).toBe(JSON.stringify(event.payload))
    expect(plain(gs.rowToEvent(row))).toEqual(event)
  })

  it('수식처럼 보이는 글자는 작은따옴표를 붙여 저장하고, 읽을 때 뗀다', () => {
    const tricky = { ...event, actor: '=SUM(A1)' }
    const row = gs.eventToRow(tricky, LATER)
    expect(row[gs.EVENT_COLUMNS.indexOf('actor')]).toBe("'=SUM(A1)")
    expect(gs.rowToEvent(row).actor).toBe('=SUM(A1)')
  })

  it('현장·로봇 행을 되돌린다 (시트의 FALSE 글자도 사용 중지로 읽음)', () => {
    expect(plain(gs.rowToSite(gs.siteToRow(site)))).toEqual(site)
    const row = gs.robotToRow({ ...robot, siteId: null })
    row[gs.ROBOT_COLUMNS.indexOf('active')] = 'FALSE'
    expect(plain(gs.rowToRobot(row))).toEqual({ ...robot, siteId: null, active: false })
  })

  it('JSON이 깨진 행은 걸러서 개수만 알린다', () => {
    const broken = gs.eventToRow(event, LATER)
    broken[gs.EVENT_COLUMNS.indexOf('payload')] = '{broken'
    const result = gs.filterValidEvents([gs.rowToEvent(broken), gs.rowToEvent(gs.eventToRow({ ...event, id: 'E-2' }, LATER))])
    expect(result.events).toHaveLength(1)
    expect(result.invalidCount).toBe(1)
  })
})

describe('needsFullEventPull', () => {
  it('처음 받거나, 받은 위치 직전 행 ID가 다르면(행 삭제·정렬) 전체를 다시 보낸다', () => {
    expect(gs.needsFullEventPull(0, null, null)).toBe(true)
    expect(gs.needsFullEventPull(3, 'E-3', 'E-3')).toBe(false)
    expect(gs.needsFullEventPull(3, 'E-3', 'E-9')).toBe(true)
    expect(gs.needsFullEventPull(3, null, 'E-3')).toBe(true)
  })
})
