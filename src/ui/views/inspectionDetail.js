import { pendingReverts, revertSkippedCompletion } from '../../data/inspectionActions.js'
import { formatDateTime } from '../../domain/dates.js'
import { availableActions } from '../../domain/inspection/flow.js'
import { METRICS } from '../../domain/inspection/constants.js'
import { formatNumber, html, setHtml } from '../dom.js'
import { notifyResult, toast } from '../feedback.js'
import { openCompleteForm } from '../components/completeForm.js'
import { openAssignForm, openCancelForm, openStartForm } from '../components/inspectionForms.js'
import { priorityBadge, resultBadge, robotLabel, sectionBanner, siteLabel, sourceLabel, statusBadge } from '../inspectionFormat.js'

const ACTION_BUTTONS = {
  ASSIGN: { label: '담당자 배정', kind: 'btn-primary' },
  START: { label: '점검 시작', kind: 'btn-primary' },
  COMPLETE: { label: '점검 완료', kind: 'btn-primary' },
  CANCEL: { label: '요청 취소', kind: 'btn-danger' },
}

const EVENT_TEXT = {
  REQUEST: () => '요청 등록',
  ASSIGN: (e) => `배정: ${e.payload.assignee}${e.payload.dueDate ? ` (예정 ${e.payload.dueDate})` : ''}`,
  START: () => '점검 시작',
  COMPLETE: () => '점검 완료',
  CANCEL: (e) => `취소: ${e.payload.reason}`,
  RECUR: (e) => `같은 이상 다시 감지${readingText(e.payload.reading)}`,
}

function readingText(reading) {
  const metric = reading && METRICS[reading.metric]
  return metric ? ` · ${metric.label} ${reading.value}${metric.unit}` : ''
}

const partName = (store, partNo) => store.getState().parts.find((p) => p.partNo === partNo)?.name ?? ''

const completionView = (request, store) => {
  const c = request.completion
  if (!c) return ''
  return html`<section class="panel">
    <div class="panel-head"><h2>점검 결과</h2>${resultBadge(c.result)}</div>
    <dl class="detail-list">
      <dt>점검 내용</dt><dd class="pre">${c.findings || '-'}</dd>
      <dt>조치 내용</dt><dd class="pre">${c.actions || '-'}</dd>
      <dt>사용 부품</dt>
      <dd>${(c.usedParts ?? []).length === 0 ? '없음' : html`<ul class="plain">${c.usedParts.map((u) => html`<li><span class="mono">${u.partNo}</span> ${partName(store, u.partNo)} × ${formatNumber(u.qty)}</li>`)}</ul>`}</dd>
    </dl>
  </section>`
}

// 다른 기기가 먼저 완료해서 반영되지 않은 완료: 함께 나간 출고를 되돌릴 수 있게 한다
const conflictView = (reverts) =>
  reverts.length === 0
    ? ''
    : html`<section class="panel conflict-panel" data-testid="conflict">
        <div class="panel-head"><h2>반영되지 않은 완료</h2></div>
        <p>다른 기기에서 먼저 완료해서 아래 완료 기록은 반영되지 않았습니다. 그때 함께 출고된 부품이 재고에서 빠져 있습니다.</p>
        ${reverts.map(
          (r) => html`<div class="form-actions" style="justify-content:flex-start">
            <span>출고 기록 ${r.txIds.length}건</span>
            <button type="button" class="btn btn-danger btn-sm" data-revert="${r.eventId}">출고 되돌리기</button>
          </div>`,
        )}
      </section>`

const historyView = (request) => html`<section class="panel">
  <div class="panel-head"><h2>처리 이력</h2></div>
  <ol class="timeline">
    ${request.history.map((e) => html`<li><span class="when">${formatDateTime(e.at)}</span> ${EVENT_TEXT[e.type](e)}${e.actor ? html` <span class="muted">· ${e.actor}</span>` : ''}</li>`)}
  </ol>
</section>`

const detailView = (request, { sites, robots }, store) => html`${sectionBanner()}<div class="page-head">
    <h1>${request.title}</h1>
    <div class="actions">
      ${availableActions(request.status).map((type) => html`<button type="button" class="btn ${ACTION_BUTTONS[type].kind}" data-flow="${type}">${ACTION_BUTTONS[type].label}</button>`)}
    </div>
  </div>
  <p><a href="#/inspections">← 점검 목록</a></p>
  <section class="panel">
    <div class="panel-head"><h2>요청 정보</h2>${statusBadge(request.status)}</div>
    <dl class="detail-list">
      <dt>현장</dt><dd>${siteLabel(sites, request.siteId)}</dd>
      <dt>로봇</dt><dd>${robotLabel(robots, request.robotId)}</dd>
      <dt>우선순위</dt><dd>${priorityBadge(request.priority)}</dd>
      <dt>출처</dt><dd>${sourceLabel(request.source)}${readingText(request.lastReading)}${request.recurCount > 0 ? ` · 재발생 ${request.recurCount}회` : ''}</dd>
      <dt>담당</dt><dd>${request.assignee || '-'}${request.dueDate ? ` (예정 ${request.dueDate})` : ''}</dd>
      <dt>설명</dt><dd class="pre">${request.detail || '-'}</dd>
      <dt>요청</dt><dd>${formatDateTime(request.requestedAt)}${request.requestedBy ? ` · ${request.requestedBy}` : ''}</dd>
    </dl>
  </section>
  ${conflictView(pendingReverts(store, request))} ${completionView(request, store)} ${historyView(request)}`

const openFlow = (type, deps) => {
  const forms = { ASSIGN: openAssignForm, START: openStartForm, COMPLETE: openCompleteForm, CANCEL: openCancelForm }
  forms[type]?.({
    ...deps,
    onDone: (result) => {
      if (result.low?.length > 0) toast(`안전재고 미달: ${result.low.join(', ')}`, 'warning')
    },
  })
}

export const renderInspectionDetail = (container, { store, inspection, query }) => {
  const requestId = query.get('id') || ''

  const draw = () => {
    const request = inspection.getRequest(requestId)
    if (!request) {
      setHtml(container, html`${sectionBanner()}<div class="page-head"><h1>현장점검</h1></div><section class="panel"><div class="empty">점검 요청을 찾을 수 없습니다. <a href="#/inspections">목록으로</a></div></section>`)
      return
    }
    setHtml(container, detailView(request, inspection.getState(), store))
  }

  container.addEventListener('click', (event) => {
    const revertId = event.target.closest('[data-revert]')?.dataset.revert
    if (revertId) return notifyResult(revertSkippedCompletion({ store, inspection }, requestId, revertId), '함께 출고된 부품을 되돌렸습니다.')
    const type = event.target.closest('[data-flow]')?.dataset.flow
    const request = inspection.getRequest(requestId)
    if (!type || !request) return
    const robot = inspection.getState().robots.find((r) => r.robotId === request.robotId)
    openFlow(type, { store, inspection, request, robot })
  })
  draw()
  const unsubscribeInspection = inspection.subscribe(draw)
  const unsubscribeStore = store.subscribe(draw)
  return () => {
    unsubscribeInspection()
    unsubscribeStore()
  }
}
