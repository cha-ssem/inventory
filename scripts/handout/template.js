// 참석자용 실습 안내서(HTML → PDF)와 복사용 프롬프트(txt)를 content.js에서 만든다.
import { COURSE, FILES, ROADMAP, SAFETY, SESSIONS, STUCK, SUPPORT } from './content.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch])
// [ ] 칸은 밑줄로 보여서 바꿔 쓸 곳이 한눈에 보이게 한다
const withBlanks = (text) => esc(text).replace(/\[([^\]]*)\]/g, '<span class="blank">$1</span>')

const STYLE = `
  @page { size: A4; margin: 13mm 14mm 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #111; font-size: 9.6pt; line-height: 1.5; }
  h1 { font-size: 20pt; margin: 0 0 1mm; }
  h2 { font-size: 13.5pt; margin: 0 0 2mm; padding: 1.3mm 2.5mm; background: #e6e6e6; border-left: 2.5mm solid #111; }
  h3 { font-size: 10.5pt; margin: 3.4mm 0 1.2mm; break-after: avoid; }
  p { margin: 1mm 0; }
  ol, ul { margin: 0.6mm 0 1.4mm; padding-left: 5mm; }
  li { margin: 0.5mm 0; }
  .page { break-before: page; }
  .sub { color: #444; }
  .box { border: 1.2px solid #111; border-radius: 1.6mm; padding: 2mm 3mm; margin: 2.4mm 0; break-inside: avoid; }
  .box h3 { margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin: 1mm 0 2mm; }
  th, td { border: 1px solid #999; padding: 1mm 1.8mm; text-align: left; vertical-align: top; }
  th { background: #eee; }
  tr { break-inside: avoid; }
  td:first-child { white-space: nowrap; font-weight: 700; width: 1%; }
  .prompt { margin: 1.6mm 0 2.4mm; break-inside: avoid; }
  .prompt .label { font-weight: 700; font-size: 9.2pt; }
  .prompt pre { margin: 0.5mm 0 0; padding: 1.6mm 2.6mm; background: #f6f6f6; border: 1px solid #bbb; border-radius: 1.2mm; white-space: pre-wrap; font-family: inherit; font-size: 9pt; }
  .blank { border-bottom: 1.2px solid #111; font-weight: 700; padding: 0 0.5mm; }
  .goal { margin: 0 0 1.6mm; }
  .tips { background: #f2f2f2; border-radius: 1.6mm; padding: 1.6mm 3mm; margin-top: 2mm; break-inside: avoid; }
  .tips ul { margin: 0.6mm 0 0; }
  .memo { border: 1px dashed #777; border-radius: 1.6mm; min-height: 32mm; padding: 2mm 3mm; color: #666; margin-top: 2mm; }
  .formula b { border: 1px solid #111; border-radius: 1mm; padding: 0 1.6mm; background: #eee; }
`

const promptBlock = (p) => `<div class="prompt"><div class="label">${esc(p.label)}</div><pre>${withBlanks(p.text)}</pre></div>`

const sessionBlock = (s, first) => `
  <section class="${first ? '' : 'page'}">
    <h2>세션 ${s.no}. ${esc(s.title)}</h2>
    <p class="goal">${esc(s.goal)}</p>
    <h3>순서</h3>
    <ol>${s.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    <h3>프롬프트 <span class="sub">(실습_프롬프트.txt에서 복사)</span></h3>
    ${s.prompts.map(promptBlock).join('')}
    <div class="tips"><b>알아둘 점</b><ul>${s.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
  </section>`

const cover = () => `
  <section>
    <h1>실습 안내</h1>
    <div class="sub">${esc(COURSE.title)} · ${esc(COURSE.company)} · ${esc(COURSE.date)}</div>
    <div class="box">
      <h3>오늘 순서</h3>
      <ol>
        <li>Claude 기초: 내 업무 질문 하나</li>
        <li>엑셀 × Claude: 목록 정리와 함수</li>
        <li>서류 사진 → 표</li>
        <li>바코드 라벨 만들기</li>
        <li>(시연) Claude Code로 만든 입출고관리 프로그램</li>
        <li>마무리: 내일 할 일 정하기</li>
      </ol>
    </div>
    <h3>받은 파일 <span class="sub">(폴더 ${esc(COURSE.folder)})</span></h3>
    <table>${FILES.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.desc)}</td></tr>`).join('')}</table>
    <p class="sub">실습 자료의 회사·공급사·품번·단가는 모두 가상입니다.</p>
    <div class="box formula">
      <h3>좋은 프롬프트 공식</h3>
      <p><b>역할</b> + <b>상황</b> + <b>요청</b> + <b>출력 형식</b></p>
      <p>예: 자동차 부품 회사 영업 담당자야(역할). 고객사 납기가 3일 늦어진다(상황). 알리는 메일을 써줘(요청). 사과·원인·새 납기 순서로 짧게(출력 형식).</p>
    </div>
    <div class="box">
      <h3>꼭 지킬 것</h3>
      <ul>${SAFETY.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
    <h3>막힐 때</h3>
    <table>${STUCK.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
  </section>`

const closing = () => `
  <section class="page">
    <h2>마무리: 내일부터</h2>
    <h3>도입 로드맵</h3>
    <table>${ROADMAP.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    <h3>엑셀과 구글 시트, 언제 무엇을</h3>
    <table>
      <tr><td>엑셀</td><td>혼자 하는 분석·보고서, ERP·거래처 자료 가공, 외부로 나가면 안 되는 자료</td></tr>
      <tr><td>구글 시트</td><td>여러 사람이 동시에 기록하는 장부, 현장에서 스마트폰으로 입력</td></tr>
    </table>
    <h3>정부 지원사업 <span class="sub">(2026-10-05 기준)</span></h3>
    <table>${SUPPORT.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    <h3>집에서 다시 해 보기</h3>
    <ul>
      <li>오늘 실습은 같은 파일과 프롬프트로 그대로 다시 할 수 있습니다.</li>
      <li>잘 된 프롬프트는 [ ]만 바꿔서 저장해 두고 다시 쓰세요 (프롬프트 모음집 1장).</li>
      <li>회사 자료로 할 때는 회사 정책을 먼저 확인하고, 이름·숫자는 가명으로 바꾸세요.</li>
    </ul>
    <h3>내일 Claude로 해 볼 업무 1개</h3>
    <div class="memo">적어 보세요:</div>
  </section>`

export const renderHandout = () => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>실습 안내 · ${esc(COURSE.title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  ${cover()}
  ${SESSIONS.map((s) => sessionBlock(s, false)).join('')}
  ${closing()}
</body>
</html>`

// 복사용 텍스트. 윈도우 메모장에서도 줄바꿈이 보이도록 CRLF로 쓴다.
export const renderPromptText = () => {
  const line = '='.repeat(60)
  const lines = [
    `${COURSE.title} · 실습 프롬프트`,
    `${COURSE.company} · ${COURSE.date}`,
    '',
    '사용법: 필요한 프롬프트를 통째로 복사해서 Claude 입력칸에 붙여넣으세요.',
    '[ ] 안은 내 상황으로 바꿔 쓰는 칸입니다.',
    '',
    ...SESSIONS.flatMap((s) => [
      line,
      `세션 ${s.no}. ${s.title}`,
      line,
      '',
      ...s.prompts.flatMap((p) => [`▶ ${p.label}`, '', p.text, '', '']),
    ]),
  ]
  return lines.join('\n').replace(/\r?\n/g, '\r\n')
}
