// 동기화 채널(점검·보고서)이 함께 쓰는 것

export const ABORTED = Object.freeze({ ok: false, code: 'ABORTED' })

// 그 기능이 없던 예전 Apps Script 배포인지 (점검 기능 전 배포는 BAD_REQUEST로 답했다)
export const isUnsupported = (result) =>
  result.code === 'UNKNOWN_ACTION' || (result.code === 'BAD_REQUEST' && /알 수 없는 요청/.test(result.error || ''))

export const assertShape = (condition, what) => {
  if (!condition) throw new Error(`서버 응답 형식이 올바르지 않습니다 (${what}).`)
}

export const joinNotices = (...notices) => notices.filter(Boolean).join(' ')
