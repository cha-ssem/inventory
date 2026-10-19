import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/ui/feedback.js', () => ({
  confirmDialog: vi.fn(async () => true),
  notifyResult: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('../../src/ui/inspectionFormat.js', () => ({ rememberedInspector: () => '' }))

const { createReportStore } = await import('../../src/data/reportStore.js')
const { createReportActions } = await import('../../src/ui/views/reportEditorActions.js')
const feedback = await import('../../src/ui/feedback.js')

const snapshot = { stats: { completed: 0, ok: 0, issue: 0, fail: 0, newRequests: 0, open: 0, urgentOpen: 0, partsUsed: 0 }, completed: [], newRequests: [], open: [] }
const input = { period: 'DAILY', from: '2026-10-19', to: '2026-10-19', siteIds: ['ST-01'], siteNames: ['청솔댐 취수탑'] }
const AI_BODY = { summary: 'AI 요약', findings: 'AI 발견', actions: 'AI 조치', nextPlan: 'AI 계획' }

// 저장 성공·실패를 테스트 중에 바꿀 수 있는 저장소
const switchableStorage = () => {
  let saved = null
  const control = { failSave: false }
  return { control, storage: { load: () => saved, save: (s) => (control.failSave ? false : ((saved = s), true)) } }
}

// 화면 흉내: 입력 칸 값과 dirty·busy를 기록한다
const fakeView = (body) => {
  const state = { dirty: false, busy: [], form: { ...body }, filled: null }
  return {
    state,
    view: {
      getDirty: () => state.dirty,
      setDirty: (v) => (state.dirty = v),
      formBody: () => state.form,
      setBusy: (v) => state.busy.push(v),
      fillForm: (b) => {
        state.filled = b
        state.form = { ...b }
        state.dirty = true
      },
    },
  }
}

const setup = ({ server = async () => ({ ok: true, body: AI_BODY }) } = {}) => {
  const { control, storage } = switchableStorage()
  const reports = createReportStore({ storage, now: () => '2026-10-19T09:00:00.000Z', makeId: () => 'rp-1' })
  reports.create(input, snapshot, '김수중')
  const { state, view } = fakeView(reports.get('rp-1').body)
  const sync = { getStatus: () => ({ connected: true }), callServer: vi.fn(server) }
  const inspection = { listRequests: () => [], getState: () => ({ requests: [], events: [], robots: [], sites: [] }) }
  const actions = createReportActions({ reports, inspection, sync, reportId: 'rp-1', navigate: vi.fn(), view })
  return { reports, control, state, sync, actions }
}

beforeEach(() => vi.clearAllMocks())

describe('보고서 화면 동작', () => {
  it('AI 초안을 받아 저장하고 AI 사용 표시를 남긴다, 기다리는 동안 잠갔다 푼다', async () => {
    const { reports, state, actions } = setup()
    await actions.ai()
    expect(reports.get('rp-1')).toMatchObject({ aiUsed: true, body: AI_BODY })
    expect(state.busy).toEqual([true, false])
  })

  it('AI 초안 저장이 실패하면 문장을 입력 칸에 넣어 두고, 다음 [저장] 때 AI 사용 표시와 함께 저장한다', async () => {
    const { reports, control, state, actions } = setup()
    control.failSave = true
    await actions.ai()
    expect(state.filled).toEqual(AI_BODY)
    expect(state.dirty).toBe(true)
    expect(feedback.toast).toHaveBeenCalledWith(expect.stringMatching(/저장하지 못했습니다/), 'error')
    expect(reports.get('rp-1').aiUsed).toBeFalsy()

    control.failSave = false
    actions.save()
    expect(reports.get('rp-1')).toMatchObject({ aiUsed: true, body: AI_BODY })
    expect(state.dirty).toBe(false)
  })

  it('다시 모으기 저장이 실패하면 고치던 상태(dirty)를 되돌린다', async () => {
    const { control, state, actions } = setup()
    state.dirty = true
    control.failSave = true
    await actions.recollect()
    expect(state.dirty).toBe(true)
  })

  it('기다리는 동안 고친 문장이 있고 덮어쓰기를 거절하면 AI 초안을 넣지 않는다', async () => {
    const { reports, state, actions } = setup({
      server: async () => {
        state.dirty = true
        return { ok: true, body: AI_BODY }
      },
    })
    feedback.confirmDialog.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await actions.ai()
    expect(reports.get('rp-1').body.summary).not.toBe('AI 요약')
    expect(state.dirty).toBe(true)
  })

  it('제출 시간이 지나면 "다시 눌러도 늘지 않음"을 안내하고, 서버 오류여도 잠금을 푼다', async () => {
    const { reports, state, actions } = setup({ server: async () => ({ ok: false, timedOut: true }) })
    reports.update('rp-1', { summary: '요약' })
    reports.finalize('rp-1')
    await actions.submit()
    expect(feedback.toast).toHaveBeenCalledWith(expect.stringMatching(/다시 눌러도/), 'error')
    expect(state.busy).toEqual([true, false])

    const failing = setup({
      server: async () => {
        throw new Error('네트워크')
      },
    })
    await expect(failing.actions.ai()).rejects.toThrow('네트워크')
    expect(failing.state.busy).toEqual([true, false])
  })

  it('제출하면 서버 경고를 함께 알린다', async () => {
    const { reports, actions } = setup({ server: async () => ({ ok: true, submittedAt: '2026-10-19T09:01:00.000Z', mailStatus: 'SENT', recipients: 1, warning: '메일 상태 기록 실패' }) })
    reports.update('rp-1', { summary: '요약' })
    reports.finalize('rp-1')
    await actions.submit()
    expect(reports.get('rp-1').status).toBe('SUBMITTED')
    expect(feedback.notifyResult).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, warning: '메일 상태 기록 실패' }), expect.any(String))
  })
})
