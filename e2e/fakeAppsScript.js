import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

export const FAKE_URL = 'https://script.google.com/macros/s/AKfycbFAKEe2e/exec'
export const FAKE_TOKEN = 'e2etoken0123456789'

// 실제 Apps Script 로직(Logic.gs)으로 요청을 처리하는 메모리 서버. 시트 대신 배열을 쓴다.
export const createFakeAppsScript = () => {
  const gs = vm.createContext({})
  vm.runInContext(readFileSync(resolve(import.meta.dirname, '../apps-script/Logic.gs'), 'utf-8'), gs)
  const db = { parts: [], transactions: [], version: 'v1', online: true, requests: [] }

  const handlers = {
    ping: () => ({ ok: true, dataVersion: db.version, parts: db.parts.length, transactions: db.transactions.length, sheet: '입출고 시험 시트' }),
    pull: (req) => {
      const full = req.dataVersion !== db.version
      const offset = full ? 0 : Number(req.txOffset) || 0
      return { ok: true, dataVersion: db.version, full, parts: db.parts, transactions: db.transactions.slice(offset), txTotal: db.transactions.length }
    },
    push: (req) => {
      const plan = gs.planPush({ parts: db.parts, transactions: db.transactions }, req)
      db.transactions = [...db.transactions, ...plan.appendTransactions]
      plan.partUpserts.forEach((u) => {
        db.parts = u.rowIndex === null ? [...db.parts, u.part] : db.parts.map((p, i) => (i === u.rowIndex ? u.part : p))
      })
      return { ok: true, dataVersion: db.version, acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rejectedParts: plan.rejectedParts, txTotal: db.transactions.length }
    },
    replaceAll: (req) => {
      db.parts = gs.planParts([], req.parts).partUpserts.map((u) => u.part)
      db.transactions = gs.planTransactions([], req.transactions).appendTransactions
      db.version = `v${Number(db.version.slice(1)) + 1}`
      return { ok: true, dataVersion: db.version }
    },
  }

  const handle = (body) => {
    const req = JSON.parse(body)
    db.requests.push(req.action)
    if (!gs.checkToken(req.token, FAKE_TOKEN)) return { ok: false, code: 'UNAUTHORIZED', error: '연결 토큰이 맞지 않습니다.' }
    return handlers[req.action](req)
  }

  // Playwright context 단위로 가로챈다 (기기 = 브라우저 context)
  const attach = async (context) => {
    await context.route('https://script.google.com/macros/s/**', async (route) => {
      if (!db.online) return route.abort('internetdisconnected')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(handle(route.request().postData())) })
    })
  }

  return { db, attach }
}
