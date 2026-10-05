const DEFAULT_TIMEOUT_MS = 30_000

// Apps Script 웹 앱은 사전 요청(OPTIONS)을 받지 못하므로 text/plain POST(단순 요청)로 보낸다
export const createSyncClient = ({ url, token, fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  // options.timeoutMs: 서류 읽기(ocr)처럼 오래 걸리는 요청은 시간 제한을 늘린다
  const request = async (action, payload = {}, options = {}) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? timeoutMs) : null
    let response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action, token }),
        redirect: 'follow',
        signal: controller?.signal,
      })
    } catch (error) {
      console.error('구글 시트 연결 실패:', error)
      if (error?.name === 'AbortError') return { ok: false, code: 'NETWORK', timedOut: true, error: '서버 응답이 늦어 중단했습니다. 인터넷 연결을 확인하고 다시 시도하세요.' }
      return { ok: false, code: 'NETWORK', error: '구글 시트에 연결할 수 없습니다. 인터넷 연결을 확인하세요.' }
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (!response.ok) return { ok: false, code: 'HTTP', error: `서버 응답 오류(${response.status})입니다. 배포 주소를 확인하세요.` }
    try {
      return await response.json()
    } catch (error) {
      console.error('구글 시트 응답 해석 실패:', error)
      return { ok: false, code: 'BAD_RESPONSE', error: '서버 응답을 읽을 수 없습니다. 웹 앱 배포의 액세스 권한이 "모든 사용자"인지 확인하세요.' }
    }
  }
  return { request }
}
