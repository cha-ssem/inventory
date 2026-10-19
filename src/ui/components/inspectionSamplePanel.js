import { generateRobotStock } from '../../data/inspectionSample.js'
import { formatNumber, html, qs, setHtml } from '../dom.js'
import { confirmDialog, notifyResult } from '../feedback.js'
import { sectionTag } from '../inspectionFormat.js'

const summary = ({ sites, robots, events }) => {
  const requests = new Set(events.map((e) => e.requestId)).size
  return `현장 ${formatNumber(sites.length)}곳 · 로봇 ${formatNumber(robots.length)}대 · 점검 요청 ${formatNumber(requests)}건`
}

// 설정 화면의 "수중 점검 로봇 현장점검 샘플" 칸. 입출고 데이터는 바꾸지 않고 로봇 부품만 더한다.
export const mountInspectionSamplePanel = (slot, { store, inspection, connected }) => {
  setHtml(
    slot,
    html`<div class="panel-head"><h2>수중 점검 로봇 현장점검 샘플</h2>${sectionTag()}</div>
      <p>
        수중 점검 로봇(ROVINS) 현장 8곳, 로봇 6대, 최근 2주 점검 기록을 불러옵니다. 로봇 부품 13종과 그 재고는 지금 입출고 데이터에
        <strong>더하기만</strong> 합니다 (이미 있는 부품은 그대로).
      </p>
      <p data-testid="inspection-summary"></p>
      <div class="form-actions" style="justify-content:flex-start">
        <button type="button" class="btn btn-primary" data-action="inspection-sample">현장점검 샘플 불러오기</button>
        <button type="button" class="btn btn-danger" data-action="inspection-reset">점검 데이터 지우기</button>
      </div>`,
  )

  const draw = () => {
    qs(slot, '[data-testid="inspection-summary"]').textContent = `지금 점검 데이터: ${summary(inspection.getState())}`
  }

  const confirmReplace = (title, confirmLabel) =>
    confirmDialog({
      title,
      message: `이 기기의 점검 데이터(${summary(inspection.getState())})가 바뀝니다. 입출고 기록은 지우지 않습니다.${connected() ? '\n구글 시트와 연결되어 있어서, 시트에 있는 점검 기록은 지우지 않고 다음 동기화 때 다시 받아 합칩니다.' : ''}`,
      confirmLabel,
      danger: true,
    })

  const loadSample = async () => {
    if (!(await confirmReplace('현장점검 샘플 불러오기', '불러오기'))) return
    const now = new Date().toISOString()
    const loaded = inspection.loadSample()
    const added = store.addCatalog(generateRobotStock({ now }))
    const warning = loaded.warning || added.warning
    notifyResult({ ok: true, warning }, `현장점검 샘플을 불러왔습니다. 로봇 부품 ${added.added}종을 더했습니다.`)
  }

  const reset = async () => {
    if (await confirmReplace('점검 데이터 지우기', '지우기')) notifyResult(inspection.resetAll(), '점검 데이터를 지웠습니다.')
  }

  const onClick = (event) => {
    const action = event.target.closest('button[data-action]')?.dataset.action
    if (action === 'inspection-sample') loadSample()
    if (action === 'inspection-reset') reset()
  }

  slot.addEventListener('click', onClick)
  draw()
  const unsubscribe = inspection.subscribe(draw)
  return () => {
    unsubscribe()
    slot.removeEventListener('click', onClick)
  }
}
