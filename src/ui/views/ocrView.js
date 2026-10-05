// 서류 사진으로 입고 (OCR): 올리기 → AI 읽기 → 검수 → 일괄 입력
import {
  buildReviewRows,
  findDuplicateStatement,
  mappingsToSave,
  parseQtyInput,
  reviewSummary,
  toInboundInputs,
  updateRow,
} from '../../domain/ocr.js'
import { suggestPartNo } from '../../domain/partNo.js'
import { setHtml } from '../dom.js'
import { confirmDialog, notifyResult, toast } from '../feedback.js'
import { prepareOcrFile } from '../components/ocrFile.js'
import { openPartForm } from '../components/partForm.js'
import { NEW_PART, doneView, notConnectedView, readingView, reviewView, uploadView } from './ocrReview.js'

// Apps Script가 AI 응답을 기다리는 시간까지 넉넉히 둔다
const OCR_TIMEOUT_MS = 120_000

const EMPTY_HEADER = Object.freeze({ supplier: '', statementNo: '', worker: '' })

// 서버 오류를 사용자가 할 일이 보이는 문장으로 바꾼다
const ocrErrorMessage = (result) => {
  if (result.timedOut) return '응답이 늦어 중단했습니다. 서버는 아직 읽고 있었을 수 있으니 1분 뒤 다시 올려 주세요.'
  if (result.code === 'BAD_REQUEST' && String(result.error).includes('알 수 없는 요청')) {
    return 'Apps Script가 예전 버전입니다. 관리자에게 Ocr·OcrLogic 파일을 넣고 새 버전으로 배포해 달라고 하세요.'
  }
  return result.error || '서류를 읽지 못했습니다.'
}

export const renderOcrInbound = (container, { store, sync }) => {
  let state = { step: 'upload', error: '' }
  let alive = true
  let requestSeq = 0
  let saving = false

  const releasePreview = () => {
    if (state.file?.previewUrl) URL.revokeObjectURL(state.file.previewUrl)
  }

  const setState = (changes) => {
    state = { ...state, ...changes }
    draw()
  }

  const reviewModel = () => {
    const { parts, transactions } = store.getState()
    return {
      header: state.header,
      date: state.statement.date,
      noStatementNo: !state.header.statementNo.trim(),
      rows: state.rows,
      parts,
      duplicates: findDuplicateStatement(transactions, state.header.supplier, state.header.statementNo),
      summary: reviewSummary(state.rows, parts),
      file: state.file,
    }
  }

  // 다시 그려도 입력하던 칸에 커서가 남도록, 그리기 직전에 커서가 있던 칸을 기억했다가 되돌린다
  const focusedField = () => {
    const el = document.activeElement
    if (!el || !container.contains(el)) return null
    return { key: el.closest('[data-key]')?.dataset.key, field: el.dataset.field, id: el.id }
  }

  const restoreFocus = (spot) => {
    if (!spot) return
    const selector = spot.id ? `#${spot.id}` : `[data-key="${spot.key}"] [data-field="${spot.field}"]`
    container.querySelector(selector)?.focus()
  }

  const draw = () => {
    if (!alive) return
    if (!sync.getStatus().connected) return setHtml(container, notConnectedView())
    const views = {
      upload: () => uploadView({ error: state.error }),
      reading: () => readingView(state.file.name),
      review: () => reviewView(reviewModel()),
      done: () => doneView({ ...state.done, parts: store.getState().parts }),
    }
    const spot = focusedField()
    setHtml(container, views[state.step]())
    restoreFocus(spot)
  }

  const restart = () => {
    requestSeq += 1
    releasePreview()
    state = { step: 'upload', error: '' }
    draw()
  }

  // 읽는 동안에는 파일 고르기 칸을 숨기고, 늦게 도착한 이전 요청의 결과는 버린다
  const readDocument = async (fileInput) => {
    const seq = ++requestSeq
    const isCurrent = () => alive && seq === requestSeq
    setState({ step: 'reading', file: { previewUrl: null, name: fileInput.name, isPdf: false }, error: '' })
    const prepared = await prepareOcrFile(fileInput)
    if (!isCurrent()) return prepared.ok && URL.revokeObjectURL(prepared.value.previewUrl)
    if (!prepared.ok) return setState({ step: 'upload', file: null, error: prepared.error })
    const { previewUrl, name, isPdf, mediaType, data } = prepared.value
    state = { ...state, file: { previewUrl, name, isPdf } }

    const result = await sync.callServer('ocr', { file: { mediaType, data } }, { timeoutMs: OCR_TIMEOUT_MS })
    if (!isCurrent()) return URL.revokeObjectURL(previewUrl)
    if (!result.ok) {
      releasePreview()
      return setState({ step: 'upload', file: null, error: ocrErrorMessage(result) })
    }
    const statement = result.statement
    setState({
      step: 'review',
      statement,
      header: { ...EMPTY_HEADER, supplier: statement.supplier, statementNo: statement.statementNo },
      rows: buildReviewRows(statement, store.getState().parts, result.mappings || []),
    })
  }

  const setRow = (key, changes) => setState({ rows: updateRow(state.rows, key, changes) })

  const suggestionFor = (key, item) => {
    const { parts, transactions } = store.getState()
    const siblingPartNos = state.rows.filter((r) => r.key !== key && r.partNo).map((r) => r.partNo)
    return suggestPartNo({ item, supplier: state.header.supplier || state.statement.supplier, parts, transactions, siblingPartNos })
  }

  const registerForRow = (key) => {
    const { item } = state.rows.find((r) => r.key === key)
    openPartForm({
      store,
      initialPartNo: item.ourPartNo,
      suggestion: suggestionFor(key, item),
      initial: { name: item.name, spec: item.spec, unit: item.unit || 'EA' },
      onSaved: (part) => setRow(key, { partNo: part.partNo }),
      onClose: draw,
    })
  }

  const onRowChange = (target) => {
    const key = Number(target.closest('[data-key]').dataset.key)
    const field = target.dataset.field
    if (field === 'include') return setRow(key, { include: target.checked })
    if (field === 'qty') return setRow(key, { qty: parseQtyInput(target.value) })
    if (target.value === NEW_PART) return registerForRow(key)
    return setRow(key, { partNo: target.value || null })
  }

  const confirmSave = async (model) => {
    if (model.duplicates.length > 0) {
      const ok = await confirmDialog({ title: '이미 입고한 명세서', message: '같은 명세서로 입고한 기록이 있습니다. 그래도 입고할까요?', confirmLabel: '그래도 입고' })
      if (!ok) return false
    }
    if (model.summary.problems > 0) {
      return confirmDialog({ title: '확인 필요한 품목', message: `확인 필요한 ${model.summary.problems}개는 빼고 ${model.summary.ready}개만 입고할까요?`, confirmLabel: '빼고 입고' })
    }
    return true
  }

  // 사람이 확인한 연결은 다음에 자동으로 쓰도록 시트에 남긴다. 실패해도 입고에는 영향이 없다.
  const saveMappings = async (mappings) => {
    if (mappings.length === 0) return
    const result = await sync.callServer('saveMappings', { mappings })
    if (!result.ok) toast('부품 연결을 기억하지 못했습니다. 다음에 다시 골라 주세요.', 'warning')
  }

  // 다른 기기가 같은 명세서를 먼저 입고했는지 보려고, 저장 전에 시트에서 최신 기록을 받아 온다
  const pullLatest = async () => {
    const status = await sync.syncNow()
    if (status.state !== 'ok') toast('다른 기기의 최신 기록을 받지 못해, 이 기기 기록으로만 중복을 확인했습니다.', 'warning')
  }

  const rowErrorMessage = (inputs, errors) => {
    const first = errors[0]
    const row = state.rows.find((r) => r.partNo === inputs[first.index]?.partNo)
    return `${row?.item.name || inputs[first.index]?.partNo}: ${first.error}`
  }

  const commitInbound = () => {
    const { parts } = store.getState()
    const inputs = toInboundInputs(state.rows, parts, state.header)
    const result = store.recordInboundBatch(inputs)
    if (!result.ok) return notifyResult({ ok: false, error: result.errors ? rowErrorMessage(inputs, result.errors) : result.error })
    notifyResult({ ...result, error: undefined }, `${result.value.length}개 품목을 입고했습니다.`)
    // 대응표는 AI가 읽은 상호로 저장한다. 다음에 같은 서류를 읽으면 같은 상호로 읽혀서 연결된다.
    saveMappings(mappingsToSave(state.rows, parts, state.statement.supplier || state.header.supplier))
    releasePreview()
    return setState({ step: 'done', file: null, done: { txs: result.value, supplier: state.header.supplier.trim(), statementNo: state.header.statementNo.trim() } })
  }

  const save = async () => {
    if (saving) return
    saving = true
    try {
      await pullLatest()
      if (!alive || state.step !== 'review') return
      draw()
      if (await confirmSave(reviewModel())) commitInbound()
    } finally {
      saving = false
    }
  }

  const onChange = (target) => {
    if (target.matches('[data-testid="ocr-file"]')) return target.files[0] && readDocument(target.files[0])
    if (target.closest('.ocr-header')) return setState({ header: { ...state.header, [target.name]: target.value } })
    if (target.dataset.field) return onRowChange(target)
    return null
  }

  // change는 커서가 다음 칸으로 옮겨 가기 전에 일어나므로, 옮겨 간 뒤에 다시 그린다
  container.addEventListener('change', (event) => setTimeout(() => alive && onChange(event.target), 0))

  container.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action
    if (action === 'restart') restart()
    if (action === 'save') save()
    if (action === 'confirm-match') setRow(Number(event.target.closest('[data-key]').dataset.key), { source: 'manual' })
  })

  const unsubscribeSync = sync.subscribe(() => {
    if (state.step === 'upload') draw()
  })
  // 검수하는 동안 다른 기기에서 부품이 바뀌면(사용 중지 등) 상태를 다시 계산한다
  let lastParts = store.getState().parts
  const unsubscribeStore = store.subscribe((next) => {
    if (state.step !== 'review' || next.parts === lastParts) return
    lastParts = next.parts
    draw()
  })
  draw()
  return () => {
    alive = false
    unsubscribeSync()
    unsubscribeStore()
    releasePreview()
  }
}
