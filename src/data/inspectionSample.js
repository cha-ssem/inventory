import { toDateKey } from '../domain/dates.js'
import { createPart } from '../domain/parts.js'
import { ROBOT_PARTS, SAMPLE_INSPECTORS, SAMPLE_ROBOTS, SAMPLE_SITES } from './youngpoongCatalog.js'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const MASTER_AGE_DAYS = 30
const OPENING_AGE_DAYS = 20
const OPENING_MULTIPLIER = 3
const [KIM, LEE, PARK, CHOI] = SAMPLE_INSPECTORS

// 시연 이야기: 지난 2주의 완료된 점검(보고서용)과 지금 열려 있는 요청.
// steps: [구분, 며칠 전, 그날 지금보다 몇 분 전, 담당, 내용]. ID가 고정이라 여러 기기에서 불러와도 겹치지 않는다.
const SCENARIOS = [
  {
    no: 1, siteId: 'ST-01', robotId: 'RV-01', source: 'MANUAL', priority: 'MID', title: '취수탑 수중부 정기 영상 점검',
    steps: [
      ['ASSIGN', 12, 300, KIM, { assignee: KIM }],
      ['START', 11, 400, KIM, {}],
      ['COMPLETE', 11, 200, KIM, { result: 'OK', findings: '수심 0~18m 콘크리트 표면 박리·균열 없음. 취수구 스크린 막힘 없음.', actions: '', usedParts: [] }],
    ],
  },
  {
    no: 2, siteId: 'ST-03', robotId: 'RV-03', source: 'MANUAL', priority: 'MID', title: '안벽 하부 세굴 3D 스캔',
    steps: [
      ['ASSIGN', 10, 300, LEE, { assignee: LEE }],
      ['START', 9, 400, LEE, {}],
      ['COMPLETE', 9, 150, LEE, { result: 'ISSUE', findings: '안벽 하단 3번 구간 세굴 깊이 약 0.4m, 폭 2.5m.', actions: '세굴 구간 위치 표시. 월 1회 재측정 권고.', usedParts: [] }],
    ],
  },
  {
    no: 3, siteId: 'ST-05', robotId: 'RV-04', source: 'SENSOR', priority: 'HIGH', title: '추진기 전류 급상승', reading: { metric: 'motorCurrent', value: 24.8 },
    steps: [
      ['ASSIGN', 8, 380, PARK, { assignee: PARK }],
      ['START', 8, 300, PARK, {}],
      ['COMPLETE', 8, 120, PARK, { result: 'ISSUE', findings: '좌측 추진기에 비닐 이물질이 감겨 과전류 발생.', actions: '추진기 모듈 교체, O-링 교체 후 시운전 정상.', usedParts: [{ partNo: 'YP-RV-001', qty: 1 }, { partNo: 'YP-SP-002', qty: 1 }] }],
    ],
  },
  {
    no: 4, siteId: 'ST-06', robotId: 'RV-05', source: 'MANUAL', priority: 'MID', title: '선체 하부 이물질 제거',
    steps: [
      ['ASSIGN', 6, 300, CHOI, { assignee: CHOI }],
      ['START', 5, 420, CHOI, {}],
      ['COMPLETE', 5, 180, CHOI, { result: 'OK', findings: '선저 따개비·이물질 제거 완료 (약 35㎡).', actions: '마모된 흡입 호스 교체.', usedParts: [{ partNo: 'YP-SP-003', qty: 1 }] }],
    ],
  },
  {
    no: 5, siteId: 'ST-07', robotId: 'RV-02', source: 'MANUAL', priority: 'LOW', title: '교각 P7 균열 영상 기록',
    steps: [
      ['ASSIGN', 4, 300, KIM, { assignee: KIM }],
      ['START', 3, 400, KIM, {}],
      ['COMPLETE', 3, 200, KIM, { result: 'ISSUE', findings: '수면 아래 1.2m 지점 균열 폭 0.3mm, 길이 약 40cm.', actions: '발주처에 정밀안전진단 검토 요청.', usedParts: [] }],
    ],
  },
  {
    no: 6, siteId: 'ST-01', robotId: 'RV-01', source: 'LOG', priority: 'MID', title: '로그 분석: 배터리 소모가 빠름', reading: { metric: 'battery', value: 38 },
    steps: [
      ['ASSIGN', 2, 200, LEE, { assignee: LEE }],
      ['START', 1, 420, LEE, {}],
      ['COMPLETE', 1, 300, LEE, { result: 'ISSUE', findings: '배터리팩 셀 편차 커서 용량 70% 수준.', actions: '배터리팩 교체.', usedParts: [{ partNo: 'YP-RV-009', qty: 1 }] }],
    ],
  },
  {
    no: 7, siteId: 'ST-04', robotId: 'RV-03', source: 'MANUAL', priority: 'MID', title: '방파제 케이슨 이음부 스캔',
    steps: [
      ['ASSIGN', 1, 250, PARK, { assignee: PARK }],
      ['START', 0, 300, PARK, {}],
      ['COMPLETE', 0, 120, PARK, { result: 'OK', findings: '케이슨 이음부 벌어짐·침하 없음.', actions: '', usedParts: [] }],
    ],
  },
  { no: 8, siteId: 'ST-02', robotId: 'RV-01', source: 'MANUAL', priority: 'MID', title: '여수로 수문 하부 퇴적 확인', steps: [] },
  {
    no: 9, siteId: 'ST-05', robotId: 'RV-04', source: 'SENSOR', priority: 'HIGH', title: '누수 감지 (하우징)', reading: { metric: 'leak', value: 1 },
    steps: [['ASSIGN', 0, 60, PARK, { assignee: PARK }]],
  },
  {
    no: 10, siteId: 'ST-06', robotId: 'RV-05', source: 'MANUAL', priority: 'LOW', title: '흡입 호스 마모 점검',
    steps: [
      ['ASSIGN', 1, 200, CHOI, { assignee: CHOI }],
      ['START', 0, 90, CHOI, {}],
    ],
  },
  {
    no: 11, siteId: 'ST-08', robotId: 'RV-02', source: 'MANUAL', priority: 'LOW', title: '하굿둑 보 수문 영상 점검',
    steps: [['CANCEL', 2, 300, KIM, { reason: '기상 악화로 일정 다시 잡음' }]],
  },
]

// 요청은 첫 단계보다 앞선 시각에 만든다 (열린 요청은 하루 전 또는 오늘 아침)
const REQUEST_LEAD = { days: 0, minutes: 90 }

const pad = (n) => String(n).padStart(3, '0')

const buildScenario = (scenario, timeAt) => {
  const requestId = `YP-R-${pad(scenario.no)}`
  const [, firstDay, firstMin] = scenario.steps[0] ?? [null, 1, 0]
  const requestAt = timeAt(firstDay + REQUEST_LEAD.days, firstMin + REQUEST_LEAD.minutes)
  const { siteId, robotId, source, priority, title, reading } = scenario
  const request = {
    id: `${requestId}-0`, requestId, type: 'REQUEST', at: requestAt, actor: KIM,
    payload: { siteId, robotId, source, priority, title, detail: '', ...(reading ? { reading } : {}) },
  }
  const steps = scenario.steps.map(([type, day, min, actor, payload], i) => {
    const at = timeAt(day, min)
    const extra = type === 'ASSIGN' ? { dueDate: toDateKey(new Date(at)) } : {}
    return { id: `${requestId}-${i + 1}`, requestId, type, at, actor, payload: { ...payload, ...extra } }
  })
  return [request, ...steps]
}

const makeTimeAt = (now) => {
  const nowMs = new Date(now).getTime()
  return (days, minutes) => new Date(nowMs - days * DAY_MS - minutes * MINUTE_MS).toISOString()
}

export const generateInspectionSample = ({ now = new Date().toISOString() } = {}) => {
  const timeAt = makeTimeAt(now)
  const masterAt = timeAt(MASTER_AGE_DAYS, 0)
  const sites = SAMPLE_SITES.map((s) => ({ ...s, active: true, createdAt: masterAt, updatedAt: masterAt }))
  const robots = SAMPLE_ROBOTS.map((r) => ({ ...r, active: true, createdAt: masterAt, updatedAt: masterAt }))
  const events = SCENARIOS.flatMap((s) => buildScenario(s, timeAt)).sort((a, b) => a.at.localeCompare(b.at))
  return { sites, robots, events }
}

// 입출고 데이터에 더할 로봇 부품: 첫 입고 + 샘플 점검에서 쓴 부품의 출고 기록
export const generateRobotStock = ({ now = new Date().toISOString() } = {}) => {
  const timeAt = makeTimeAt(now)
  const openingAt = timeAt(OPENING_AGE_DAYS, 0)
  const parts = ROBOT_PARTS.map((p) => createPart(p, openingAt))
  const openings = parts.map((p, i) => ({
    id: `YP-OPEN-${pad(i + 1)}`, type: 'IN', partNo: p.partNo, qty: p.safetyStock * OPENING_MULTIPLIER,
    partner: '영풍산업 본사 자재', worker: KIM, memo: '로봇 부품 초기 재고', refId: null, createdAt: openingAt,
  }))
  const used = generateInspectionSample({ now }).events.filter((e) => e.type === 'COMPLETE')
  const outs = used.flatMap((e) =>
    e.payload.usedParts.map((u, i) => ({
      id: `${e.requestId}-OUT-${i + 1}`, type: 'OUT', partNo: u.partNo, qty: u.qty,
      partner: '현장점검', worker: e.actor, memo: `점검 ${e.requestId}`, refId: null, createdAt: e.at,
    })),
  )
  return { parts, transactions: [...openings, ...outs] }
}
