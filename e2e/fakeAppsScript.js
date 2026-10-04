import { FAKE_TOKEN, FAKE_URL, createFakeBackend } from '../tests/support/fakeBackend.js'

export { FAKE_TOKEN, FAKE_URL }

// 단위 테스트와 같은 가짜 Apps Script(실제 Logic.gs 규칙)를 브라우저 요청 가로채기로 연결한다. 기기 = 브라우저 context.
export const createFakeAppsScript = () => {
  const backend = createFakeBackend()
  const attach = async (context) => {
    await context.route('https://script.google.com/macros/s/**', async (route) => {
      if (!backend.db.online) return route.abort('internetdisconnected')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backend.handle(route.request().postData())) })
    })
  }
  return { db: backend.db, attach }
}
