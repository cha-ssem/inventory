import { toDateKey } from '../../domain/dates.js'
import { INSPECTION_LIMITS, PRIORITIES } from '../../domain/inspection/constants.js'
import { formValues, html, qs } from '../dom.js'
import { notifyResult, openModal } from '../feedback.js'
import { option, rememberInspector, rememberedInspector } from '../inspectionFormat.js'

const actorField = (id) => html`<div class="field">
  <label for="${id}">작성자</label>
  <input class="input" id="${id}" name="actor" maxlength="${INSPECTION_LIMITS.maxName}" value="${rememberedInspector()}" placeholder="예: 김수중" />
</div>`

const formButtons = (submitLabel, kind = 'btn-primary') => html`<div class="form-actions">
  <button type="button" class="btn" data-dismiss>닫기</button>
  <button type="submit" class="btn ${kind}">${submitLabel}</button>
</div>`

// 공통: 폼을 열고, 제출하면 save(values)를 부르고, 성공하면 닫는다
const openFormModal = ({ title, content, save, successMessage, onDone, onMount: extraMount }) =>
  openModal({
    title,
    content: html`<form novalidate>${content}<p class="field-error" data-form-error></p></form>`,
    onMount: (dialog, close) => {
      const form = dialog.querySelector('form')
      dialog.querySelector('[data-dismiss]').addEventListener('click', close)
      extraMount?.(form)
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const values = formValues(form)
        const result = save(values, form)
        qs(form, '[data-form-error]').textContent = result.ok ? '' : result.error || ''
        if (!result.ok) return
        rememberInspector(values.actor?.trim())
        notifyResult(result, successMessage)
        close()
        onDone?.(result)
      })
    },
  })

const robotOptions = (robots, siteId, selected) => {
  const here = robots.filter((r) => r.siteId === siteId)
  const others = robots.filter((r) => r.siteId !== siteId)
  return [...here, ...others].map((r) => option(r.robotId, `${r.name}${r.siteId === siteId ? ' (이 현장)' : ''}`, selected))
}

export const openRequestForm = ({ inspection, onDone, preset = {} }) => {
  const { sites, robots } = inspection.getState()
  const activeSites = sites.filter((s) => s.active !== false)
  const firstSite = preset.siteId ?? activeSites[0]?.siteId
  openFormModal({
    title: '점검 요청 등록',
    content: html`<div class="field">
        <label for="rq-site">현장 *</label>
        <select class="input" id="rq-site" name="siteId">${activeSites.map((s) => option(s.siteId, s.name, firstSite))}</select>
      </div>
      <div class="field">
        <label for="rq-robot">로봇 *</label>
        <select class="input" id="rq-robot" name="robotId">${robotOptions(robots, firstSite, preset.robotId)}</select>
      </div>
      <div class="field">
        <label for="rq-priority">우선순위 *</label>
        <select class="input" id="rq-priority" name="priority">${Object.entries(PRIORITIES).map(([k, v]) => option(k, v, preset.priority ?? 'MID'))}</select>
      </div>
      <div class="field">
        <label for="rq-title">점검 제목 *</label>
        <input class="input" id="rq-title" name="title" maxlength="${INSPECTION_LIMITS.maxTitle}" value="${preset.title ?? ''}" placeholder="예: 취수탑 수중부 정기 영상 점검" autofocus />
      </div>
      <div class="field">
        <label for="rq-detail">설명</label>
        <textarea class="input" id="rq-detail" name="detail" rows="3" maxlength="${INSPECTION_LIMITS.maxDetail}">${preset.detail ?? ''}</textarea>
      </div>
      ${actorField('rq-actor')} ${formButtons('요청 등록')}`,
    onMount: (form) => {
      form.elements.siteId.addEventListener('change', () => {
        form.elements.robotId.innerHTML = String(html`${robotOptions(robots, form.elements.siteId.value)}`)
      })
    },
    save: ({ actor, ...values }) => inspection.addRequest({ ...values, source: preset.source, ruleId: preset.ruleId, reading: preset.reading }, actor),
    successMessage: '점검 요청을 등록했습니다.',
    onDone,
  })
}

export const openAssignForm = ({ inspection, request, onDone }) =>
  openFormModal({
    title: request.assignee ? '담당자 다시 배정' : '담당자 배정',
    content: html`<div class="field">
        <label for="as-assignee">담당자 *</label>
        <input class="input" id="as-assignee" name="assignee" maxlength="${INSPECTION_LIMITS.maxName}" value="${request.assignee || rememberedInspector()}" autofocus />
      </div>
      <div class="field">
        <label for="as-due">점검 예정일</label>
        <input class="input" id="as-due" type="date" name="dueDate" value="${request.dueDate || toDateKey(new Date())}" />
      </div>
      ${actorField('as-actor')} ${formButtons('배정')}`,
    save: ({ actor, ...values }) => inspection.transition(request.requestId, 'ASSIGN', values, actor),
    successMessage: '담당자를 배정했습니다.',
    onDone,
  })

export const openStartForm = ({ inspection, request, onDone }) =>
  openFormModal({
    title: '점검 시작',
    content: html`<p class="confirm-message">${request.title}</p>
      <p class="muted">현장에 도착해서 로봇을 투입할 때 누르세요. 시작 시각이 기록됩니다.</p>
      ${actorField('st-actor')} ${formButtons('점검 시작')}`,
    save: ({ actor }) => inspection.transition(request.requestId, 'START', {}, actor),
    successMessage: '점검을 시작했습니다.',
    onDone,
  })

export const openCancelForm = ({ inspection, request, onDone }) =>
  openFormModal({
    title: '점검 요청 취소',
    content: html`<p class="confirm-message">${request.title}</p>
      <p class="muted">요청을 지우지 않고 "취소" 기록을 남깁니다.</p>
      <div class="field">
        <label for="cn-reason">취소 사유 *</label>
        <input class="input" id="cn-reason" name="reason" maxlength="200" placeholder="예: 기상 악화로 일정 다시 잡음" autofocus />
      </div>
      ${actorField('cn-actor')} ${formButtons('요청 취소', 'btn-danger')}`,
    save: ({ actor, ...values }) => inspection.transition(request.requestId, 'CANCEL', values, actor),
    successMessage: '점검 요청을 취소했습니다.',
    onDone,
  })

export { openFormModal, actorField, formButtons }
