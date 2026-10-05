import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const FAKE_URL = 'https://script.google.com/macros/s/AKfycbFAKEe2e/exec'
export const FAKE_TOKEN = 'e2etoken0123456789'

const loadLogic = () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const gs = vm.createContext({})
  for (const file of ['Logic.gs', 'OcrLogic.gs']) vm.runInContext(readFileSync(resolve(here, '../../apps-script', file), 'utf-8'), gs)
  return gs
}

// Code.gs와 같은 규칙으로 동작하는 메모리 서버 (시트 대신 배열). 실제 판단은 Logic.gs 함수를 쓴다.
export const createFakeBackend = ({ token = FAKE_TOKEN } = {}) => {
  const gs = loadLogic()
  // ocrResult: ocr 요청에 돌려줄 AI 결과(명세서) 또는 { ok: false, ... } 오류. mappings: 대응표 시트
  const db = { parts: [], transactions: [], version: 'v1', revision: 0, online: true, hooks: {}, requests: [], ocrResult: null, ocrFiles: [], mappings: [] }
  const lastRowId = () => db.transactions.at(-1)?.id ?? null

  const handlers = {
    ping: () => ({ ok: true, dataVersion: db.version, revision: db.revision, parts: db.parts.length, transactions: db.transactions.length, sheet: '입출고 시험 시트' }),
    pull: (req) => {
      const offset = Number(req.txOffset) || 0
      const full = gs.needsFullPull(req, db.version, offset > 0 ? db.transactions[offset - 1]?.id ?? null : null)
      const rows = db.transactions.slice(full ? 0 : offset)
      const valid = gs.filterValidRows(rows)
      return {
        ok: true, dataVersion: db.version, revision: db.revision, full, parts: db.parts,
        transactions: valid.transactions, invalidCount: valid.invalidCount, txTotal: db.transactions.length, lastRowId: lastRowId(),
      }
    },
    push: (req) => {
      const previousRevision = db.revision
      const plan = gs.planPush({ parts: db.parts, transactions: db.transactions }, req)
      db.transactions = [...db.transactions, ...plan.appendTransactions]
      plan.partUpserts.forEach((u) => {
        db.parts = u.rowIndex === null ? [...db.parts, u.part] : db.parts.map((p, i) => (i === u.rowIndex ? u.part : p))
      })
      if (plan.appendTransactions.length > 0 || plan.partUpserts.length > 0) db.revision += 1
      return {
        ok: true, dataVersion: db.version, revision: db.revision, previousRevision,
        acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rejectedParts: plan.rejectedParts, txTotal: db.transactions.length,
      }
    },
    ocr: (req) => {
      const file = gs.validateOcrFile(req.file)
      if (!file.ok) return file
      db.ocrFiles.push(file.value.mediaType)
      if (!db.ocrResult) return { ok: false, code: 'OCR_NOT_CONFIGURED', error: '서류 읽기가 아직 설정되지 않았습니다.' }
      if (db.ocrResult.ok === false) return db.ocrResult
      return { ok: true, statement: gs.sanitizeStatement(db.ocrResult), mappings: db.mappings }
    },
    saveMappings: (req) => {
      const plan = gs.planMappingUpserts(db.mappings, req.mappings, new Date().toISOString())
      plan.upserts.forEach((u) => {
        db.mappings = u.rowIndex === null ? [...db.mappings, u.mapping] : db.mappings.map((m, i) => (i === u.rowIndex ? u.mapping : m))
      })
      return { ok: true, saved: plan.upserts.length, rejected: plan.rejected }
    },
    replaceAll: (req) => {
      const allowed = gs.checkReplaceAllowed(req, db.revision)
      if (!allowed.ok) return allowed
      db.parts = gs.planParts([], req.parts).partUpserts.map((u) => u.part)
      db.transactions = gs.planTransactions([], req.transactions).appendTransactions
      db.version = `v${Number(db.version.slice(1)) + 1}`
      db.revision += 1
      return { ok: true, dataVersion: db.version, revision: db.revision, parts: db.parts.length, transactions: db.transactions.length, lastRowId: lastRowId() }
    },
  }

  const handle = (body) => {
    const req = JSON.parse(body)
    db.requests.push(req.action)
    if (!gs.checkToken(req.token, token)) return { ok: false, code: 'UNAUTHORIZED', error: '연결 토큰이 맞지 않습니다.' }
    return handlers[req.action](req)
  }

  // 단위 테스트용 fetch 대체. hooks[action]으로 응답 전에 끼어들 수 있다 (지연·동시 변경 재현).
  const fetchImpl = async (url, init) => {
    if (!db.online) throw new TypeError('Failed to fetch')
    const { action } = JSON.parse(init.body)
    if (db.hooks[action]) await db.hooks[action]()
    const body = handle(init.body)
    return { ok: true, json: async () => body }
  }

  return { db, gs, handle, fetchImpl }
}
