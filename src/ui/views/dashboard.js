import { addDays, toDateKey } from '../../domain/dates.js'
import { buildHistoryRows } from '../../domain/history.js'
import { dashboardStats, recentTransactions } from '../../domain/stats.js'
import { buildStockRows } from '../../domain/stock.js'
import { formatNumber, html, setHtml } from '../dom.js'
import { txTable } from '../components/txTable.js'

const CHART_DAYS = 7
const LOW_LIST_LIMIT = 8

const statCard = ({ label, value, href, kind = '', testId }) => html`
  <a class="stat-card ${kind}" href="${href}" data-testid="${testId}">
    <div class="label">${label}</div>
    <div class="value">${formatNumber(value)}</div>
  </a>
`

const lowStockList = (rows) => {
  const low = rows.filter((r) => r.low)
  if (low.length === 0) return html`<div class="empty">안전재고 미달 품목이 없습니다.</div>`
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr><th>품번</th><th>품명</th><th class="num">현재고</th><th class="num">안전재고</th></tr>
      </thead>
      <tbody>
        ${low.slice(0, LOW_LIST_LIMIT).map(
          (r) => html`<tr class="is-low">
            <td class="mono">${r.partNo}</td>
            <td>${r.name}</td>
            <td class="num stock">${formatNumber(r.stock)}</td>
            <td class="num">${formatNumber(r.safetyStock)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>
  ${low.length > LOW_LIST_LIMIT ? html`<p class="muted">외 ${low.length - LOW_LIST_LIMIT}개 품목 · <a href="#/stock?low=1">전체 보기</a></p>` : ''}`
}

const dailyCounts = (transactions, parts, todayKey) => {
  const days = Array.from({ length: CHART_DAYS }, (_, i) => addDays(todayKey, i - CHART_DAYS + 1))
  const rows = buildHistoryRows(transactions, parts).filter((r) => !r.cancelled)
  return days.map((day) => {
    const ofDay = rows.filter((r) => toDateKey(r.createdAt) === day)
    return {
      day,
      in: ofDay.filter((r) => r.type === 'IN').length,
      out: ofDay.filter((r) => r.type === 'OUT').length,
    }
  })
}

const barChart = (series) => {
  const max = Math.max(1, ...series.flatMap((d) => [d.in, d.out]))
  const pct = (n) => `${Math.round((n / max) * 100)}%`
  return html`<div class="bar-chart" role="img" aria-label="최근 7일 입출고 건수">
      ${series.map(
        (d) => html`<div class="bar-col" title="${d.day} 입고 ${d.in}건 · 출고 ${d.out}건">
          <div class="bar-pair">
            <div class="bar in" style="height:${pct(d.in)}"></div>
            <div class="bar out" style="height:${pct(d.out)}"></div>
          </div>
          <span class="bar-label">${d.day.slice(5)}</span>
        </div>`,
      )}
    </div>
    <div class="legend"><span><i style="background:var(--in)"></i>입고</span><span><i style="background:var(--out)"></i>출고</span></div>`
}

const emptyState = () => html`<div class="panel empty">
  <h2>등록된 부품이 없습니다</h2>
  <p>부품을 등록하거나, 시연용 샘플 데이터를 불러오세요.</p>
  <div class="form-actions" style="justify-content:center">
    <a class="btn btn-primary" href="#/parts">부품 등록하기</a>
    <a class="btn" href="#/settings">샘플 데이터 불러오기</a>
  </div>
</div>`

export const renderDashboard = (container, { store }) => {
  const draw = () => {
    const { parts, transactions } = store.getState()
    const now = new Date().toISOString()
    const stats = dashboardStats({ parts, transactions, now })
    const rows = buildStockRows(parts, store.getStockMap())

    setHtml(
      container,
      html`<div class="page-head"><h1>대시보드</h1><span class="muted">${toDateKey(now)} 기준</span></div>
        ${parts.length === 0
          ? emptyState()
          : html`<div class="stat-grid">
                ${statCard({ label: '전체 품목', value: stats.totalParts, href: '#/stock', testId: 'stat-total' })}
                ${statCard({ label: '안전재고 미달', value: stats.lowStockCount, href: '#/stock?low=1', kind: stats.lowStockCount ? 'is-danger' : '', testId: 'stat-low' })}
                ${statCard({ label: '오늘 입고', value: stats.todayIn, href: '#/history?type=IN&today=1', kind: 'is-in', testId: 'stat-in' })}
                ${statCard({ label: '오늘 출고', value: stats.todayOut, href: '#/history?type=OUT&today=1', kind: 'is-out', testId: 'stat-out' })}
              </div>
              <div class="grid-2">
                <section class="panel">
                  <div class="panel-head"><h2>안전재고 미달 품목</h2><a href="#/stock?low=1">재고 현황</a></div>
                  ${lowStockList(rows)}
                </section>
                <section class="panel">
                  <div class="panel-head"><h2>최근 7일 입출고</h2></div>
                  ${barChart(dailyCounts(transactions, parts, toDateKey(now)))}
                </section>
              </div>
              <section class="panel">
                <div class="panel-head"><h2>최근 입출고</h2><a href="#/history">전체 이력</a></div>
                ${txTable(recentTransactions(transactions, parts, 10))}
              </section>`}`,
    )
  }
  draw()
  return store.subscribe(draw)
}
