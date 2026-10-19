import { formatDateTime } from '../../domain/dates.js'
import { PRIORITIES, RESULTS, STATUSES } from '../../domain/inspection/constants.js'
import { REPORT_PERIODS, REPORT_SECTIONS, REPORT_STATUSES } from '../../domain/report/report.js'
import { formatNumber, html } from '../dom.js'

export const reportStatusBadge = (status) => html`<span class="badge badge-rp-${status}">${REPORT_STATUSES[status]}</span>`

const MAIL_LABELS = { SENT: '메일 보냄', FAILED: '메일 못 보냄', QUOTA: '메일 한도 초과', PENDING: '메일 보내는 중' }

const statusText = (report) => {
  if (report.status === 'DRAFT') return '초안 (확정 전)'
  if (report.status === 'FINALIZED') return `${REPORT_STATUSES.FINALIZED} · ${formatDateTime(report.finalizedAt)}`
  const { submittedAt, mailStatus } = report.submission ?? {}
  return `${REPORT_STATUSES.SUBMITTED} · ${formatDateTime(submittedAt)} · ${MAIL_LABELS[mailStatus] ?? ''}`
}

const statCell = (label, value) => html`<div class="rs-stat"><div class="rs-stat-label">${label}</div><div class="rs-stat-value">${formatNumber(value)}</div></div>`

const partsText = (usedParts) => (usedParts.length === 0 ? '-' : usedParts.map((u) => `${u.partNo} ×${u.qty}`).join(', '))

const completedTable = (items) =>
  items.length === 0
    ? html`<p class="rs-empty">기간 안에 완료한 점검이 없습니다.</p>`
    : html`<table class="rs-table">
        <thead><tr><th>완료 일시</th><th>현장</th><th>로봇</th><th>점검</th><th>결과</th><th>사용 부품</th></tr></thead>
        <tbody>
          ${items.map(
            (c) => html`<tr>
              <td class="nowrap">${formatDateTime(c.completedAt)}</td>
              <td>${c.siteName}</td>
              <td>${c.robotName}</td>
              <td>${c.title}</td>
              <td class="nowrap">${RESULTS[c.result] ?? c.result}</td>
              <td>${partsText(c.usedParts)}</td>
            </tr>`,
          )}
        </tbody>
      </table>`

const openTable = (items) =>
  items.length === 0
    ? html`<p class="rs-empty">남은 점검 요청이 없습니다.</p>`
    : html`<table class="rs-table">
        <thead><tr><th>우선</th><th>현장</th><th>점검</th><th>상태</th><th>담당</th><th>예정일</th></tr></thead>
        <tbody>
          ${items.map(
            (o) => html`<tr>
              <td class="nowrap">${PRIORITIES[o.priority] ?? o.priority}</td>
              <td>${o.siteName}</td>
              <td>${o.title}</td>
              <td class="nowrap">${STATUSES[o.status] ?? o.status}</td>
              <td>${o.assignee || '-'}</td>
              <td class="nowrap">${o.dueDate || '-'}</td>
            </tr>`,
          )}
        </tbody>
      </table>`

const section = (key, text) => html`<section class="rs-section" data-section="${key}">
  <h3>${REPORT_SECTIONS[key]}</h3>
  <p class="rs-text">${text || '-'}</p>
</section>`

// A4 한 장(넘치면 여러 장)으로 인쇄되는 보고서. body를 따로 받는 것은 편집 중인 문장을 저장 전에 미리 보기 위해서다.
export const reportSheet = (report, body = report.body) => {
  const { stats, completed, open } = report.snapshot
  const status = statusText(report)
  return html`<article class="report-sheet" data-testid="report-sheet">
    <header class="rs-head">
      <h2>${report.title}</h2>
      <dl class="rs-meta">
        <div><dt>기간</dt><dd>${REPORT_PERIODS[report.period]} ${report.from === report.to ? report.from : `${report.from} ~ ${report.to}`}</dd></div>
        <div><dt>현장</dt><dd>${report.siteNames.join(', ') || report.siteIds.join(', ')}</dd></div>
        <div><dt>작성</dt><dd>${report.author || '-'} · 버전 ${report.version}${report.aiUsed ? ' · AI 초안 사용' : ''}</dd></div>
        <div><dt>상태</dt><dd>${status}</dd></div>
      </dl>
    </header>
    <div class="rs-stats">
      ${statCell('완료', stats.completed)}${statCell('이상 없음', stats.ok)}${statCell('조치 필요', stats.issue)}${statCell('점검 불가', stats.fail)}
      ${statCell('새 요청', stats.newRequests)}${statCell('남은 요청', stats.open)}${statCell('긴급', stats.urgentOpen)}${statCell('사용 부품', stats.partsUsed)}
    </div>
    ${section('summary', body.summary)}
    <section class="rs-section"><h3>완료한 점검</h3>${completedTable(completed)}</section>
    ${section('findings', body.findings)} ${section('actions', body.actions)}
    <section class="rs-section"><h3>남은 점검 요청 (기간 끝 기준)</h3>${openTable(open)}</section>
    ${section('nextPlan', body.nextPlan)}
  </article>`
}
