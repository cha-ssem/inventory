import { formatDateTime, toDateKey } from '../../domain/dates.js'
import { METRICS } from '../../domain/inspection/constants.js'
import { LOG_LIMITS, analyzeLog, buildSampleLog, parseSensorLog } from '../../domain/monitor/logCsv.js'
import { downloadFile, formatNumber, html, qs, qsa, readFileAsText, setHtml } from '../dom.js'
import { toast } from '../feedback.js'
import { priorityBadge } from '../inspectionFormat.js'

const segmentTable = (segments, robots) => {
  if (segments.length === 0) return html`<div class="empty">기준을 넘은 구간이 없습니다.</div>`
  const name = (id) => robots.find((r) => r.robotId === id)?.name ?? id
  return html`<div class="table-wrap">
      <table>
        <thead>
          <tr><th><span class="sr-only">선택</span></th><th>로봇</th><th>기준</th><th>구간</th><th class="num">횟수</th><th class="num">가장 나쁜 값</th></tr>
        </thead>
        <tbody>
          ${segments.map(
            (s, i) => html`<tr>
              <td>${s.deployed ? html`<input type="checkbox" data-segment="${i}" checked aria-label="${name(s.robotId)} ${s.rule.title} 선택" />` : ''}</td>
              <td>${name(s.robotId)}${s.deployed ? '' : html` <span class="muted">(${s.blocked}이라 요청 불가)</span>`}</td>
              <td>${priorityBadge(s.rule.priority)} ${s.rule.title}</td>
              <td class="nowrap">${formatDateTime(s.from)} ~ ${formatDateTime(s.to)}</td>
              <td class="num">${formatNumber(s.count)}</td>
              <td class="num">${s.worst} ${METRICS[s.rule.metric].unit}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <div class="form-actions" style="justify-content:flex-start">
      <button type="button" class="btn btn-primary" data-log-request>선택한 구간으로 점검 요청 만들기</button>
    </div>`
}

// 모니터링 화면의 "로그 파일 분석" 칸. onViolations: 고른 구간을 점검 요청으로 바꾼다.
export const mountLogUpload = (slot, { inspection, onViolations }) => {
  let segments = []
  setHtml(
    slot,
    html`<div class="panel-head"><h2>로그 파일 분석</h2></div>
      <p class="muted">로봇이 남긴 센서 로그(CSV: timestamp, robotId, metric, value)를 올리면 기준을 넘은 구간을 찾습니다. 2MB까지.</p>
      <div class="form-actions" style="justify-content:flex-start">
        <label class="btn">로그 파일 올리기<input type="file" accept=".csv,text/csv" data-log-file hidden /></label>
        <button type="button" class="btn" data-log-sample>샘플 로그 내려받기</button>
      </div>
      <p class="muted log-summary" data-testid="log-summary"></p>
      <div class="log-result"></div>`,
  )

  const robots = () => inspection.getState().robots

  const analyze = async (file) => {
    if (file.size > LOG_LIMITS.maxBytes) return toast('로그 파일은 2MB 이하만 올릴 수 있습니다.', 'error')
    try {
      const parsed = parseSensorLog(await readFileAsText(file), robots())
      if (!parsed.ok) return toast(parsed.error, 'error')
      segments = analyzeLog(parsed.rows, robots(), inspection.getState().sites)
      const skipped = parsed.skipped > 0 ? ` · 건너뛴 행 ${formatNumber(parsed.skipped)}개 (${parsed.errors[0]})` : ''
      const duplicates = parsed.duplicates > 0 ? ` · 같은 시각 중복 행 ${formatNumber(parsed.duplicates)}개는 하나로 합침` : ''
      qs(slot, '.log-summary').textContent = `${formatNumber(parsed.rows.length)}행 분석 · 기준을 넘은 구간 ${segments.length}개${skipped}${duplicates}`
      setHtml(qs(slot, '.log-result'), segmentTable(segments, robots()))
    } catch (error) {
      console.error('로그 분석 실패:', error)
      toast('로그 파일을 읽지 못했습니다.', 'error')
    }
  }

  const requestSelected = () => {
    const chosen = qsa(slot, '[data-segment]:checked').map((box) => segments[Number(box.dataset.segment)])
    if (chosen.length === 0) return toast('구간을 하나 이상 고르세요.', 'error')
    const violations = chosen
      .map((s) => ({ robot: robots().find((r) => r.robotId === s.robotId), rule: s.rule, reading: { metric: s.rule.metric, value: s.worst } }))
      .filter((v) => v.robot)
    const { created, recurred, failed, suppressed } = onViolations(violations)
    if (created.length > 0 || recurred > 0 || failed.length > 0) return
    if (suppressed > 0) toast('조금 전 만들지 못한 점검 요청은 10분 동안 다시 시도하지 않습니다. 잠시 뒤 다시 누르세요.', 'info')
    else toast('이미 같은 내용의 열린 점검 요청이 있습니다.', 'info')
  }

  const onClick = (event) => {
    if (event.target.closest('[data-log-sample]')) {
      downloadFile(`ROVINS_센서로그_${toDateKey(new Date())}.csv`, buildSampleLog(robots(), new Date().toISOString()), 'text/csv;charset=utf-8')
    }
    if (event.target.closest('[data-log-request]')) requestSelected()
  }
  const onChange = (event) => {
    if (!event.target.matches('[data-log-file]')) return
    const [file] = event.target.files
    event.target.value = ''
    if (file) analyze(file)
  }
  slot.addEventListener('click', onClick)
  slot.addEventListener('change', onChange)
  return () => {
    slot.removeEventListener('click', onClick)
    slot.removeEventListener('change', onChange)
  }
}
