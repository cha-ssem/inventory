import { serializeBackup } from '../../domain/backup.js'
import { toDateKey } from '../../domain/dates.js'
import { downloadFile, formatNumber, html, qs, readFileAsText, setHtml } from '../dom.js'
import { confirmDialog, notifyResult, toast } from '../feedback.js'
import { mountSyncPanel } from '../components/syncPanel.js'

const MAX_BACKUP_BYTES = 10 * 1024 * 1024

const summary = (state) =>
  `부품 ${formatNumber(state.parts.length)}개 · 입출고 기록 ${formatNumber(state.transactions.length)}건`

// 화면 뼈대는 한 번만 그리고, 데이터 요약만 다시 그린다 (연결 폼 입력값이 지워지지 않도록)
export const renderSettings = (container, { store, sync }) => {
  const connected = () => sync?.getStatus().connected
  const storageNote = () =>
    connected()
      ? '구글 시트와 연결되어 있습니다. 이 기기에도 사본이 저장되어 인터넷이 끊겨도 쓸 수 있습니다.'
      : '데이터는 이 컴퓨터의 브라우저에만 저장됩니다. 다른 PC와 공유하려면 구글 시트에 연결하거나 백업 파일을 쓰세요.'
  setHtml(
      container,
      html`<div class="page-head"><h1>설정</h1></div>
        <section class="panel">
          <div class="panel-head"><h2>현재 데이터</h2></div>
          <p data-testid="data-summary"></p>
          <p class="muted storage-note"></p>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>구글 시트 연결</h2></div>
          <div class="sync-slot"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>시연용 데이터</h2></div>
          <p>가상 부품 25개와 최근 2주 입출고 기록을 불러옵니다. <strong>지금 데이터는 모두 바뀝니다.</strong></p>
          <div class="form-actions" style="justify-content:flex-start">
            <button type="button" class="btn btn-primary" data-action="sample">샘플 데이터 불러오기</button>
            <button type="button" class="btn btn-danger" data-action="reset">전체 초기화</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>백업과 복원</h2></div>
          <p>모든 데이터를 JSON 파일로 내려받거나, 내려받은 파일로 되돌립니다.</p>
          <div class="form-actions" style="justify-content:flex-start">
            <button type="button" class="btn" data-action="backup">백업 파일 내려받기</button>
            <label class="btn">백업 파일로 복원<input type="file" accept=".json,application/json" data-action="restore" hidden /></label>
          </div>
        </section>`,
    )

  const draw = () => {
    qs(container, '[data-testid="data-summary"]').textContent = summary(store.getState())
    qs(container, '.storage-note').textContent = storageNote()
  }

  const confirmReplace = (title, confirmLabel) =>
    confirmDialog({
      title,
      message: `지금 데이터(${summary(store.getState())})가 모두 바뀝니다.${connected() ? '\n구글 시트의 데이터도 함께 바뀌어 모든 기기에 반영됩니다.' : ''}\n필요하면 먼저 백업 파일을 내려받으세요.`,
      confirmLabel,
      danger: true,
    })

  const actions = {
    sample: async () => {
      if (await confirmReplace('샘플 데이터 불러오기', '불러오기')) notifyResult(store.loadSample(), '샘플 데이터를 불러왔습니다.')
    },
    reset: async () => {
      if (await confirmReplace('전체 초기화', '모두 지우기')) notifyResult(store.resetAll(), '모든 데이터를 지웠습니다.')
    },
    backup: () => {
      downloadFile(`입출고관리_백업_${toDateKey(new Date())}.json`, serializeBackup(store.getState(), new Date().toISOString()), 'application/json')
      toast('백업 파일을 내려받았습니다.', 'success')
    },
  }

  const restore = async (file) => {
    if (file.size > MAX_BACKUP_BYTES) return toast('백업 파일은 10MB 이하만 올릴 수 있습니다.', 'error')
    try {
      const text = await readFileAsText(file)
      if (await confirmReplace('백업 파일로 복원', '복원하기')) notifyResult(store.restoreBackup(text), '백업 파일로 복원했습니다.')
    } catch (error) {
      console.error('복원 실패:', error)
      toast('백업 파일을 읽지 못했습니다.', 'error')
    }
  }

  container.addEventListener('click', (event) => {
    const action = event.target.closest('button[data-action]')?.dataset.action
    if (action) actions[action]?.()
  })
  container.addEventListener('change', (event) => {
    if (!event.target.matches('input[data-action="restore"]')) return
    const [file] = event.target.files
    event.target.value = ''
    if (file) restore(file)
  })

  draw()
  const unsubscribeStore = store.subscribe(draw)
  const unsubscribeSync = sync ? mountSyncPanel(qs(container, '.sync-slot'), { store, sync }) : () => {}
  const unsubscribeNote = sync ? sync.subscribe(draw) : () => {}
  return () => {
    unsubscribeStore()
    unsubscribeSync()
    unsubscribeNote()
  }
}
