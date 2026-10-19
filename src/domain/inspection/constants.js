// 현장점검(영풍산업 수중 점검 로봇) 도메인의 고정 값

export const SECTORS = Object.freeze({
  DAM: '댐',
  PORT: '항만',
  NUCLEAR: '원자력 발전소',
  SHIPYARD: '조선',
  BRIDGE: '교량',
  RIVER: '하천',
})

export const ROBOT_MODELS = Object.freeze({
  V1: 'ROVINS-V1 영상 점검',
  V2: 'ROVINS-V2 소나 3D 스캔',
  V3: 'ROVINS-V3 청소',
  V4: 'ROVINS-V4 로봇팔 작업',
})

// 센서 지표: 이름, 단위, 그래프 범위
export const METRICS = Object.freeze({
  depth: { label: '수심', unit: 'm', min: 0, max: 60 },
  waterTemp: { label: '수온', unit: '℃', min: 0, max: 40 },
  battery: { label: '배터리', unit: '%', min: 0, max: 100 },
  leak: { label: '누수 감지', unit: '', min: 0, max: 1 },
  motorCurrent: { label: '추진기 전류', unit: 'A', min: 0, max: 30 },
  turbidity: { label: '탁도', unit: 'NTU', min: 0, max: 200 },
  sonarSignal: { label: '소나 신호 품질', unit: '%', min: 0, max: 100 },
  suctionPressure: { label: '흡입 압력', unit: 'kPa', min: 0, max: 100 },
  armTorque: { label: '로봇팔 토크', unit: 'N·m', min: 0, max: 120 },
})

const COMMON_METRICS = ['depth', 'waterTemp', 'battery', 'leak', 'motorCurrent']

export const MODEL_METRICS = Object.freeze({
  V1: [...COMMON_METRICS, 'turbidity'],
  V2: [...COMMON_METRICS, 'sonarSignal'],
  V3: [...COMMON_METRICS, 'suctionPressure'],
  V4: [...COMMON_METRICS, 'armTorque'],
})

// 점검 이벤트: 지우지 않고 추가만 한다. 요청의 현재 상태는 이벤트를 차례로 접어서 계산한다.
export const EVENT_TYPES = Object.freeze({
  REQUEST: 'REQUEST',
  ASSIGN: 'ASSIGN',
  START: 'START',
  COMPLETE: 'COMPLETE',
  CANCEL: 'CANCEL',
  RECUR: 'RECUR', // 열린 요청과 같은 이상이 다시 감지됨
})

export const STATUSES = Object.freeze({
  REQUESTED: '요청',
  ASSIGNED: '배정',
  IN_PROGRESS: '점검 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
})

export const SOURCES = Object.freeze({ MANUAL: '직접 등록', SENSOR: '센서 감지', LOG: '로그 분석' })

export const PRIORITIES = Object.freeze({ HIGH: '긴급', MID: '보통', LOW: '낮음' })

export const RESULTS = Object.freeze({ OK: '이상 없음', ISSUE: '조치 필요', FAIL: '점검 불가' })

export const INSPECTION_LIMITS = Object.freeze({
  maxName: 50,
  maxTitle: 100,
  maxDetail: 500,
  maxNote: 1000,
  maxUsedParts: 20,
  maxPayload: 4000, // 이벤트 내용 JSON 글자 수 (apps-script/InspectionLogic.gs의 INSP_LIMITS.maxPayload와 같게)
})

export const SITE_ID_PATTERN = /^ST-\d{2,4}$/
export const ROBOT_ID_PATTERN = /^RV-\d{2,4}$/
