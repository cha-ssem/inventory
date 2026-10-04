// Apps Script 웹 앱 배포 주소만 허용한다 (다른 서버로 데이터가 나가지 않도록)
const URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,64}$/

export const validateSyncConfig = (input) => {
  const url = String(input?.url ?? '').trim()
  const token = String(input?.token ?? '').trim()
  const errors = {}
  if (!URL_PATTERN.test(url)) errors.url = 'Apps Script 웹 앱 주소(https://script.google.com/macros/s/…/exec)를 입력하세요.'
  if (!TOKEN_PATTERN.test(token)) errors.token = '연결 토큰은 영문·숫자 16~64자입니다. Apps Script setup 실행 로그에서 확인하세요.'
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { url, token } }
}
