import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// 시트 한 장: 2차원 배열. 1행은 머리글. getRange(row, col, rows, cols)는 1부터 센다.
const createSheet = () => {
  const cells = []
  let maxRows = 1000
  const ensure = (r) => {
    while (cells.length < r) cells.push([])
  }
  const range = (row, col, rows = 1, cols = 1) => ({
    setValues: (values) => {
      values.forEach((line, i) => {
        ensure(row + i)
        line.forEach((v, j) => {
          cells[row - 1 + i][col - 1 + j] = v
        })
      })
      return range(row, col, rows, cols)
    },
    getValues: () =>
      Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => cells[row - 1 + i]?.[col - 1 + j] ?? '')),
    getValue: () => cells[row - 1]?.[col - 1] ?? '',
    setFontWeight: () => range(row, col, rows, cols),
    setNumberFormats: () => range(row, col, rows, cols),
    clearContent: () => {
      for (let i = 0; i < rows; i += 1) cells[row - 1 + i] = []
    },
  })
  return {
    cells,
    getRange: range,
    getLastRow: () => {
      for (let i = cells.length; i > 0; i -= 1) if ((cells[i - 1] || []).some((v) => v !== '' && v !== undefined)) return i
      return 0
    },
    getMaxRows: () => maxRows,
    insertRowsAfter: (_after, count) => {
      maxRows += count
    },
    setFrozenRows: () => {},
  }
}

// Apps Script 서버 파일(Code·Logic·Ocr·OcrLogic)을 가짜 Google 서비스 위에서 실행한다
export const loadAppsScript = ({ properties = {}, fetchResponse } = {}) => {
  const sheets = {}
  const props = { ...properties }
  const fetches = []
  const logs = []
  const context = vm.createContext({
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
    JSON,
    Date,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props[key] ?? null,
        setProperty: (key, value) => {
          props[key] = String(value)
        },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => 'uuid-1',
      formatDate: (date) => date.toISOString().slice(0, 10),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getName: () => '시험 시트',
        getSheetByName: (name) => sheets[name] ?? null,
        insertSheet: (name) => {
          sheets[name] = createSheet()
          return sheets[name]
        },
      }),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetches.push({ url, options })
        const { status, body, throws } = fetchResponse(JSON.parse(options.payload))
        if (throws) throw new Error(throws)
        return { getResponseCode: () => status, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) }
      },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType: () => ({ text }) }),
    },
  })
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps-script')
  for (const file of ['Logic.gs', 'OcrLogic.gs', 'Code.gs', 'Ocr.gs']) {
    vm.runInContext(readFileSync(resolve(dir, file), 'utf-8'), context)
  }
  const post = (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text)
  return { context, sheets, props, fetches, logs, post }
}
