import { describe, it, expect } from 'vitest'
import { loadAppsScript } from '../support/fakeGoogle.js'

// 실제 Code.gs·Inspection.gs를 가짜 시트 위에서 실행한다
const TOKEN = 'servertoken01234567'
const AT = '2026-10-19T01:00:00.000Z'
const site = { siteId: 'ST-01', name: '청솔댐 취수탑', sector: 'DAM', region: '경남', contact: '정댐관', active: true, createdAt: AT, updatedAt: AT }
const robot = { robotId: 'RV-01', model: 'V1', name: 'V1 1호기', serial: 'V1-2501', siteId: null, active: true, createdAt: AT, updatedAt: AT }
const event = (id, type = 'REQUEST') => ({
  id, requestId: 'R-1', type, at: AT, actor: '김수중',
  payload: type === 'REQUEST' ? { siteId: 'ST-01', robotId: 'RV-01', source: 'MANUAL', priority: 'MID', title: '정기 점검' } : {},
})

const setup = () => {
  const gas = loadAppsScript({ properties: { APP_TOKEN: TOKEN } })
  const post = (action, body = {}) => gas.post({ action, token: TOKEN, ...body })
  return { gas, post }
}

describe('inspPush / inspPull', () => {
  it('올린 현장·로봇·이벤트를 그대로 다시 받는다', () => {
    const { post } = setup()
    const pushed = post('inspPush', { sites: [site], robots: [robot], events: [event('E-1'), event('E-2', 'START')] })
    expect(pushed).toMatchObject({ ok: true, acceptedIds: ['E-1', 'E-2'], duplicateIds: [], rejected: [], total: 2 })

    const pulled = post('inspPull', { offset: 0 })
    expect(pulled).toMatchObject({ ok: true, full: true, total: 2, lastRowId: 'E-2', invalidCount: 0 })
    expect(pulled.sites).toEqual([site])
    expect(pulled.robots).toEqual([robot])
    expect(pulled.events).toEqual([event('E-1'), event('E-2', 'START')])
  })

  it('받은 위치 이후의 이벤트만 돌려준다', () => {
    const { post } = setup()
    post('inspPush', { events: [event('E-1')] })
    post('inspPush', { events: [event('E-2', 'START')] })
    const pulled = post('inspPull', { offset: 1, lastRowId: 'E-1' })
    expect(pulled.full).toBe(false)
    expect(pulled.events.map((e) => e.id)).toEqual(['E-2'])
  })

  it('같은 이벤트를 다시 올리면 중복으로 알리고 행을 늘리지 않는다', () => {
    const { post } = setup()
    post('inspPush', { events: [event('E-1')] })
    expect(post('inspPush', { events: [event('E-1')] })).toMatchObject({ acceptedIds: [], duplicateIds: ['E-1'], total: 1 })
  })

  it('수정일시가 최신인 현장만 기존 행을 고친다', () => {
    const { post } = setup()
    post('inspPush', { sites: [site] })
    post('inspPush', { sites: [{ ...site, name: '새 이름', updatedAt: '2026-10-19T02:00:00.000Z' }] })
    expect(post('inspPull', { offset: 0 }).sites.map((s) => s.name)).toEqual(['새 이름'])
  })

  it('새 현장 여러 개와 기존 현장 고치기를 한 번에 처리한다', () => {
    const { post } = setup()
    post('inspPush', { sites: [site] })
    const second = { ...site, siteId: 'ST-02', name: '둘째' }
    const third = { ...site, siteId: 'ST-03', name: '셋째' }
    post('inspPush', { sites: [{ ...site, name: '고친 이름', updatedAt: '2026-10-19T02:00:00.000Z' }, second, third] })
    expect(post('inspPull', { offset: 0 }).sites.map((s) => s.name)).toEqual(['고친 이름', '둘째', '셋째'])
  })

  it('목록 형식이 틀리면 서버 오류로 처리하고 시트는 그대로 둔다', () => {
    const { post } = setup()
    expect(post('inspPush', { events: 'x' })).toMatchObject({ ok: false, code: 'SERVER_ERROR' })
  })

  it('입출고 리비전은 올리지 않는다 (입출고 전체 바꾸기 충돌과 무관)', () => {
    const { gas, post } = setup()
    post('inspPush', { events: [event('E-1')] })
    expect(gas.props.REVISION).toBeUndefined()
  })

  it('setup()은 점검 시트도 만든다', () => {
    const { gas } = setup()
    gas.context.setup()
    expect(Object.keys(gas.sheets)).toEqual(expect.arrayContaining(['sites', 'robots', 'insp_events']))
  })

  it('모르는 요청은 UNKNOWN_ACTION으로 알린다 (예전 앱·배포 구분용)', () => {
    const { post } = setup()
    expect(post('nothing')).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' })
  })

  it('토큰이 틀리면 거부한다', () => {
    const { gas } = setup()
    expect(gas.post({ action: 'inspPull', token: 'wrong-token-000000' })).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
  })
})
