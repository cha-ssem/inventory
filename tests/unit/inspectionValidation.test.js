import { describe, it, expect } from 'vitest'
import { isValidEvent, isValidInspectionState, isValidRobot, isValidSite } from '../../src/domain/inspection/validation.js'

const AT = '2026-10-19T01:00:00.000Z'
const site = { siteId: 'ST-01', name: '청솔댐 취수탑', sector: 'DAM', region: '경남', contact: '김현장', active: true, createdAt: AT, updatedAt: AT }
const robot = { robotId: 'RV-01', model: 'V1', name: 'V1 1호기', serial: 'V1-2501', siteId: 'ST-01', active: true, createdAt: AT, updatedAt: AT }
const request = {
  id: 'E-1', requestId: 'R-1', type: 'REQUEST', at: AT, actor: '김현장',
  payload: { siteId: 'ST-01', robotId: 'RV-01', source: 'MANUAL', priority: 'MID', title: '정기 점검' },
}

describe('isValidSite', () => {
  it('올바른 현장을 받는다', () => expect(isValidSite(site)).toBe(true))
  it.each([
    ['ID 형식', { siteId: 'X-1' }],
    ['이름 없음', { name: '' }],
    ['분야', { sector: 'SPACE' }],
    ['수정일시', { updatedAt: 'x' }],
    ['사용 여부', { active: 'yes' }],
  ])('%s가 틀리면 거부한다', (_, change) => expect(isValidSite({ ...site, ...change })).toBe(false))
  it('null을 거부한다', () => expect(isValidSite(null)).toBe(false))
})

describe('isValidRobot', () => {
  it('올바른 로봇을 받는다', () => expect(isValidRobot(robot)).toBe(true))
  it.each([
    ['ID 형식', { robotId: 'R1' }],
    ['모델', { model: 'V9' }],
    ['현장 ID', { siteId: 'nowhere' }],
    ['이름', { name: 3 }],
  ])('%s가 틀리면 거부한다', (_, change) => expect(isValidRobot({ ...robot, ...change })).toBe(false))
  it('배치 현장이 없어도(null) 받는다', () => expect(isValidRobot({ ...robot, siteId: null })).toBe(true))
})

describe('isValidEvent', () => {
  it('올바른 요청 이벤트를 받는다', () => expect(isValidEvent(request)).toBe(true))
  it.each([
    ['ID', { id: '' }],
    ['요청 ID', { requestId: '' }],
    ['구분', { type: 'DELETE' }],
    ['일시', { at: '어제' }],
    ['담당', { actor: 5 }],
    ['내용', { payload: null }],
  ])('%s가 틀리면 거부한다', (_, change) => expect(isValidEvent({ ...request, ...change })).toBe(false))
  it('요청 이벤트는 현장·로봇이 있어야 한다', () => {
    expect(isValidEvent({ ...request, payload: { ...request.payload, robotId: '' } })).toBe(false)
  })
  it('다른 구분의 이벤트는 내용 형식만 본다', () => {
    expect(isValidEvent({ ...request, id: 'E-2', type: 'START', payload: {} })).toBe(true)
  })
})

describe('isValidInspectionState', () => {
  it('올바른 상태를 받는다', () => {
    expect(isValidInspectionState({ sites: [site], robots: [robot], events: [request] })).toBe(true)
  })
  it('빈 상태를 받는다', () => expect(isValidInspectionState({ sites: [], robots: [], events: [] })).toBe(true))
  it('배열이 아니면 거부한다', () => expect(isValidInspectionState({ sites: [], robots: [] })).toBe(false))
  it('ID가 겹치면 거부한다', () => {
    expect(isValidInspectionState({ sites: [site, site], robots: [], events: [] })).toBe(false)
    expect(isValidInspectionState({ sites: [], robots: [], events: [request, request] })).toBe(false)
  })
  it('잘못된 항목이 있으면 거부한다', () => {
    expect(isValidInspectionState({ sites: [], robots: [{ ...robot, model: '?' }], events: [] })).toBe(false)
  })
  it('null을 거부한다', () => expect(isValidInspectionState(null)).toBe(false))
})
