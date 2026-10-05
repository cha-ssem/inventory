// 서류로 입고 화면의 HTML 조각 (상태는 ocrView.js가 가진다)
import { formatDateTime } from '../../domain/dates.js'
import { ROW_STATUS, rowStatus } from '../../domain/ocr.js'
import { LIMITS } from '../../domain/validation.js'
import { formatNumber, html } from '../dom.js'
import { OCR_ACCEPT } from '../components/ocrFile.js'

export const NEW_PART = '__new__'

const STATUS_VIEW = {
  [ROW_STATUS.ok]: { label: '정상', cls: 'badge-ok' },
  [ROW_STATUS.unmatched]: { label: '품번 미확인', cls: 'badge-warn' },
  [ROW_STATUS.inactive]: { label: '사용 중지 부품', cls: 'badge-warn' },
  [ROW_STATUS.badQty]: { label: '수량 오류', cls: 'badge-low' },
}

const SOURCE_HINT = {
  partNo: '귀사 품번으로 연결',
  mapping: '지난번 연결대로',
  name: '품명이 같아 연결 · 맞으면 [맞음]을 눌러 기억시키세요',
  manual: '직접 고름',
}

const pageHead = html`<div class="page-head">
  <h1>서류 사진으로 입고</h1>
  <div class="actions"><a class="btn" href="#/inbound">← 바코드 입고</a></div>
</div>`

export const notConnectedView = () => html`${pageHead}
  <section class="panel" data-testid="ocr-not-connected">
    <h2>구글 시트 연결이 필요합니다</h2>
    <p>서류 사진은 구글 시트에 연결된 Apps Script를 거쳐 AI가 읽습니다. 먼저 <a href="#/settings">설정 → 구글 시트 연결</a>을 해 주세요.</p>
  </section>`

export const uploadView = ({ error = '' } = {}) => html`${pageHead}
  <section class="panel ocr-upload">
    <p>거래명세서를 찍거나 파일을 고르면 AI가 품목과 수량을 읽어 표로 보여 줍니다. <strong>저장은 내용을 확인하고 [일괄 입력]을 눌러야 됩니다.</strong></p>
    <label class="btn btn-primary ocr-pick">
      📷 서류 사진 찍기 · 파일 고르기
      <input type="file" name="ocr-file" accept="${OCR_ACCEPT}" data-testid="ocr-file" hidden />
    </label>
    <p class="hint">JPG·PNG 사진 또는 PDF(5MB 이하). 서류 전체가 반듯하게, 그림자 없이 나오게 찍어 주세요. 단가·금액은 저장하지 않습니다.</p>
    ${error ? html`<div class="result-card is-error" role="alert" data-testid="ocr-error"><p>${error}</p></div>` : ''}
  </section>`

export const readingView = (name) => html`${pageHead}
  <section class="panel ocr-reading" data-testid="ocr-reading" aria-busy="true">
    <div class="spinner" aria-hidden="true"></div>
    <p><strong>AI가 서류를 읽는 중입니다…</strong></p>
    <p class="muted">${name} · 보통 10~40초 걸립니다. 이 화면을 닫지 마세요.</p>
  </section>`

const partOptions = (parts, selected) => {
  const current = parts.find((p) => p.partNo === selected)
  const active = parts.filter((p) => p.active !== false)
  const list = current && current.active === false ? [current, ...active] : active
  return html`<option value="">— 부품 고르기 —</option>
    ${list.map((p) => html`<option value="${p.partNo}" ${p.partNo === selected ? 'selected' : ''}>${p.partNo} ${p.name}${p.active === false ? ' (사용 중지)' : ''}</option>`)}
    <option value="${NEW_PART}">＋ 새 부품으로 등록…</option>`
}

const docCell = (item) => html`<div class="ocr-doc">
  <strong>${item.name || '(품명 없음)'}</strong>
  <span class="muted">${[item.spec, item.unit].filter(Boolean).join(' · ')}</span>
  <span class="muted mono">${item.ourPartNo ? `귀사 품번 ${item.ourPartNo}` : '귀사 품번 없음'}${item.supplierCode ? ` · 공급사 코드 ${item.supplierCode}` : ''}</span>
</div>`

const reviewRow = (row, parts, byNo) => {
  const status = rowStatus(row, byNo)
  const view = STATUS_VIEW[status]
  return html`<tr class="${row.include ? '' : 'is-excluded'}" data-key="${row.key}" data-testid="ocr-row">
    <td><input type="checkbox" data-field="include" aria-label="${row.item.name || '품목'} 포함" ${row.include ? 'checked' : ''} /></td>
    <td>${docCell(row.item)}</td>
    <td>
      <select class="input" data-field="partNo" aria-label="${row.item.name || '품목'}의 우리 부품">${partOptions(parts, row.partNo)}</select>
      ${row.source ? html`<span class="hint ${row.source === 'name' ? 'is-check' : ''}">${SOURCE_HINT[row.source]}</span>` : ''}
      ${row.source === 'name' ? html`<button type="button" class="btn btn-sm" data-action="confirm-match">맞음</button>` : ''}
    </td>
    <td><input class="input ocr-qty" type="number" min="1" step="1" inputmode="numeric" data-field="qty" value="${row.qty ?? ''}" aria-label="${row.item.name || '품목'} 수량" /></td>
    <td><span class="badge ${row.include ? view.cls : ''}" data-testid="ocr-status">${row.include ? view.label : '빼기'}</span></td>
  </tr>`
}

const duplicateNotice = (duplicates, noStatementNo) =>
  duplicates.length === 0
    ? noStatementNo
      ? html`<div class="result-card is-warning" data-testid="ocr-no-number"><p>명세서 번호가 없어 중복 입고를 확인할 수 없습니다. 서류에 번호가 있으면 입력하세요.</p></div>`
      : ''
    : html`<div class="result-card is-warning" role="alert" data-testid="ocr-duplicate">
        <div class="result-title">이미 입고한 명세서입니다</div>
        <p>같은 공급자·명세서 번호로 ${formatDateTime(duplicates[0].createdAt)}에 ${formatNumber(duplicates.length)}건을 입고했습니다. 두 번 입고하지 않도록 확인하세요.</p>
      </div>`

const headerForm = ({ supplier, statementNo, worker }, date) => html`<form class="form-grid ocr-header" novalidate>
  <div class="field">
    <label for="ocr-supplier">공급자 (거래처로 저장)</label>
    <input id="ocr-supplier" class="input" name="supplier" value="${supplier}" maxlength="${LIMITS.maxText}" />
  </div>
  <div class="field">
    <label for="ocr-no">명세서 번호 (메모로 저장)</label>
    <input id="ocr-no" class="input mono" name="statementNo" value="${statementNo}" maxlength="${LIMITS.maxMemo}" />
  </div>
  <div class="field">
    <label for="ocr-worker">작업자</label>
    <input id="ocr-worker" class="input" name="worker" value="${worker}" maxlength="${LIMITS.maxText}" placeholder="예: 김자재" />
  </div>
  <div class="field">
    <label>거래 일자 (서류)</label>
    <div class="input" aria-readonly="true">${date || '읽지 못함'}</div>
  </div>
</form>`

const preview = (file) =>
  file.isPdf
    ? html`<p class="muted">PDF 파일: ${file.name}</p>`
    : html`<img class="ocr-preview" src="${file.previewUrl}" alt="올린 서류 사진" />`

export const reviewView = ({ header, date, noStatementNo, rows, parts, duplicates, summary, file }) => {
  const byNo = new Map(parts.map((p) => [p.partNo, p]))
  return html`${pageHead}
  <div class="ocr-layout">
    <section class="panel">
      <div class="panel-head"><h2>읽은 내용 확인</h2><button type="button" class="btn btn-sm" data-action="restart">다른 서류 올리기</button></div>
      ${headerForm(header, date)}
      ${duplicateNotice(duplicates, noStatementNo)}
      ${rows.length === 0
        ? html`<div class="empty">품목을 읽지 못했습니다. 서류 전체가 보이게 다시 찍어 주세요.</div>`
        : html`<div class="table-wrap"><table class="ocr-table" data-testid="ocr-table">
            <thead><tr><th>포함</th><th>서류 품목</th><th>우리 부품</th><th>수량</th><th>상태</th></tr></thead>
            <tbody>${rows.map((row) => reviewRow(row, parts, byNo))}</tbody>
          </table></div>`}
      <div class="ocr-footer">
        <p data-testid="ocr-summary">넣을 품목 <strong>${summary.ready}</strong>개 · 확인 필요 <strong>${summary.problems}</strong>개 · 뺀 품목 ${summary.excluded}개</p>
        <button type="button" class="btn btn-primary" data-action="save" ${summary.ready === 0 ? 'disabled' : ''}>일괄 입력 (${summary.ready}개)</button>
      </div>
    </section>
    <aside class="panel ocr-original">
      <details open><summary><strong>원본 서류</strong></summary>${preview(file)}</details>
    </aside>
  </div>`
}

export const doneView = ({ txs, parts, supplier, statementNo }) => {
  const byNo = new Map(parts.map((p) => [p.partNo, p]))
  return html`${pageHead}
  <section class="panel">
    <div class="result-card is-success" data-testid="ocr-done">
      <div class="result-title">${formatNumber(txs.length)}개 품목을 입고했습니다</div>
      <p>${supplier || '공급자 없음'}${statementNo ? ` · 명세서 ${statementNo}` : ''}. 잘못 넣은 품목은 이력 화면에서 취소할 수 있습니다.</p>
    </div>
    <ul class="session-list">
      ${txs.map((t) => html`<li><span><strong class="mono">${t.partNo}</strong> ${byNo.get(t.partNo)?.name || ''}</span><span>+${formatNumber(t.qty)}</span></li>`)}
    </ul>
    <div class="form-actions">
      <a class="btn" href="#/history">이력 보기</a>
      <button type="button" class="btn btn-primary" data-action="restart">다른 서류 올리기</button>
    </div>
  </section>`
}
