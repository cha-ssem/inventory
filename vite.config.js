import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 배포본에만 넣는 보안 정책(CSP). 앱이 통신할 수 있는 곳을 Apps Script로만 묶어서,
// 만에 하나 화면에 스크립트가 끼어들어도 연결 토큰을 다른 서버로 보내지 못하게 한다.
// 단일 HTML 파일이라 인라인 스크립트·스타일은 허용해야 한다. (개발 서버의 실시간 갱신과 충돌해 build에만 적용)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = () => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  base: './',
  plugins: [contentSecurityPolicy(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/data/**', 'src/sync/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
