import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const FAKE_URL = 'https://script.google.com/macros/s/AKfycbFAKEe2e/exec'
export const FAKE_TOKEN = 'e2etoken0123456789'

const loadLogic = () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const gs = vm.createContext({})
  for (const file of ['Logic.gs', 'OcrLogic.gs', 'InspectionLogic.gs', 'ReportLogic.gs', 'ReportSubmitLogic.gs', 'ReportSyncLogic.gs']) vm.runInContext(readFileSync(resolve(here, '../../apps-script', file), 'utf-8'), gs)
  return gs
}

// Code.gs와 같은 규칙으로 동작하는 메모리 서버 (시트 대신 배열). 실제 판단은 Logic.gs 함수를 쓴다.
export const createFakeBackend = ({ token = FAKE_TOKEN } = {}) => {
  const gs = loadLogic()
  // ocrResult: ocr 요청에 돌려줄 AI 결과(명세서) 또는 { ok: false, ... } 오류. mappings: 대응표 시트
  const db = { parts: [], transactions: [], version: 'v1', revision: 0, online: true, hooks: {}, requests: [], ocrResult: null, ocrFiles: [], mappings: [],
    // 현장점검 시트. inspectionSupported=false면 점검 기능이 없던 예전 배포처럼 응답한다
    sites: [], robots: [], events: [], inspectionSupported: true,
    // reportResult: reportDraft 요청에 돌려줄 AI 문단 또는 { ok: false, ... } 오류. reportInputs: 받은 보고서 데이터
    reportResult: null, reportInputs: [],
    // reports: 제출된 보고서 줄 { reportKey, submittedAt, mailStatus }, mails: 보낸 메일, mailFails: 메일 실패 흉내
    reports: [], mails: [], mailFails: false,
    // reportStore: report_store 탭 줄(시트 행 그대로), reportRev: REPORT_STORE_REV, reportPage: 한 쪽 줄 수(기본 10). reportSyncSupported=false면 예전 배포처럼 응답
    reportStore: [], reportRev: 0, reportPage: undefined, reportSyncSupported: true }
  const lastRowId = () => db.transactions.at(-1)?.id ?? null
  const reportIndex = () => db.reportStore.map((row) => ({ reportId: row[0], status: row[2], mailStatus: row[3], updatedAt: row[4], rev: row[5] }))

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
    inspPush: (req) => {
      const plan = gs.planInspectionPush({ sites: db.sites, robots: db.robots, eventIds: db.events.map((e) => e.id) }, req)
      const upsert = (list, upserts) =>
        upserts.reduce((acc, u) => (u.rowIndex === null ? [...acc, u.item] : acc.map((x, i) => (i === u.rowIndex ? u.item : x))), list)
      db.sites = upsert(db.sites, plan.siteUpserts)
      db.robots = upsert(db.robots, plan.robotUpserts)
      db.events = [...db.events, ...plan.appendEvents]
      return { ok: true, acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rejectedMasters: plan.rejectedMasters, total: db.events.length }
    },
    inspPull: (req) => {
      const offset = Number(req.offset) || 0
      const full = gs.needsFullEventPull(offset, req.lastRowId, offset > 0 ? db.events[offset - 1]?.id ?? null : null)
      const valid = gs.filterValidEvents(db.events.slice(full ? 0 : offset))
      return {
        ok: true, full, sites: db.sites, robots: db.robots, events: valid.events, invalidCount: valid.invalidCount,
        total: db.events.length, lastRowId: db.events.at(-1)?.id ?? null,
      }
    },
    reportDraft: (req) => {
      const input = gs.sanitizeReportInput(req.report)
      if (!input.ok) return input
      if (!db.reportResult) return { ok: false, code: 'REPORT_NOT_CONFIGURED', error: 'AI 초안이 아직 설정되지 않았습니다.' }
      if (db.reportResult.ok === false) return db.reportResult
      db.reportInputs.push(input.value)
      return { ok: true, body: gs.sanitizeReportBody(db.reportResult) }
    },
    submitReport: (req) => {
      const sub = gs.sanitizeSubmission(req.report)
      if (!sub.ok) return sub
      const plan = gs.planSubmission(db.reports, sub.value.key, Date.now())
      const submittedAt = plan.append ? new Date().toISOString() : db.reports[plan.rowIndex].submittedAt
      if (plan.append) db.reports = [...db.reports, { reportKey: sub.value.key, submittedAt, mailStatus: 'SENDING', mailAt: submittedAt }]
      const index = plan.append ? db.reports.length - 1 : plan.rowIndex
      let mailStatus = db.reports[index].mailStatus
      if (plan.sendMail) {
        mailStatus = db.mailFails ? 'FAILED' : 'SENT'
        if (!db.mailFails) db.mails = [...db.mails, { subject: gs.reportMailSubject(sub.value), html: gs.buildReportHtml(sub.value, submittedAt) }]
        db.reports = db.reports.map((r, i) => (i === index ? { ...r, mailStatus } : r))
      }
      return {
        ok: true, duplicate: !plan.append, submittedAt, mailStatus, recipients: 1,
        ...(mailStatus === 'FAILED' ? { warning: '시트에는 기록했지만 메일을 보내지 못했습니다. 잠시 후 [메일 다시 보내기]를 누르세요.' } : {}),
      }
    },
    reportPush: (req) => {
      const plan = gs.planReportPush(reportIndex(), req.reports)
      let rev = gs.nextReportRevBase(reportIndex(), db.reportRev)
      plan.writes.forEach((w) => {
        rev += 1
        const row = gs.storedReportToRow(w.value, rev)
        db.reportStore = w.rowIndex === null ? [...db.reportStore, row] : db.reportStore.map((r, i) => (i === w.rowIndex ? row : r))
      })
      if (plan.writes.length > 0) db.reportRev = rev
      return { ok: true, acceptedIds: plan.acceptedIds, duplicateIds: plan.duplicateIds, rejected: plan.rejected, rev }
    },
    reportPull: (req) => {
      const since = gs.reportPullStart(req.sinceRev, db.reportRev)
      const picked = gs.selectReportPullRows(reportIndex(), since, db.reportRev, db.reportPage)
      const reports = picked.rowIndexes.map((i) => gs.rowToStoredReport(db.reportStore[i])).filter(Boolean)
      return { ok: true, full: since === 0, more: picked.more, reports, invalidCount: picked.rowIndexes.length - reports.length, rev: picked.rev }
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
    const isInspection = req.action === 'inspPush' || req.action === 'inspPull'
    if (isInspection && !db.inspectionSupported) return { ok: false, code: 'BAD_REQUEST', error: '알 수 없는 요청입니다.' }
    const isReportSync = req.action === 'reportPush' || req.action === 'reportPull'
    if (isReportSync && !db.reportSyncSupported) return { ok: false, code: 'UNKNOWN_ACTION', error: '알 수 없는 요청입니다. Apps Script를 최신 버전으로 다시 배포하세요.' }
    const handler = handlers[req.action]
    if (!handler) return { ok: false, code: 'UNKNOWN_ACTION', error: '알 수 없는 요청입니다.' }
    return handler(req)
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
