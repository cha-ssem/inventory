// 수중 점검 로봇 시연용 가상 데이터. 현장·발주처 이름은 실제가 아니다.

export const SAMPLE_SITES = [
  { siteId: 'ST-01', name: '청솔댐 취수탑', sector: 'DAM', region: '경남 밀양', contact: '정댐관' },
  { siteId: 'ST-02', name: '청솔댐 여수로 수문', sector: 'DAM', region: '경남 밀양', contact: '정댐관' },
  { siteId: 'ST-03', name: '남해항 2부두 안벽', sector: 'PORT', region: '부산 강서', contact: '한항만' },
  { siteId: 'ST-04', name: '남해항 방파제', sector: 'PORT', region: '부산 강서', contact: '한항만' },
  { siteId: 'ST-05', name: '해오름 원전 사용후연료 저장조', sector: 'NUCLEAR', region: '울산 울주', contact: '오안전' },
  { siteId: 'ST-06', name: '동진조선 3도크 선체', sector: 'SHIPYARD', region: '경남 거제', contact: '박선체' },
  { siteId: 'ST-07', name: '가람대교 교각 P7', sector: 'BRIDGE', region: '부산 사하', contact: '이교량' },
  { siteId: 'ST-08', name: '푸른강 하굿둑 보', sector: 'RIVER', region: '부산 사하', contact: '최하천' },
]

// siteId가 null이면 본사에서 정비 중
export const SAMPLE_ROBOTS = [
  { robotId: 'RV-01', model: 'V1', name: 'V1 영상 1호기', serial: 'V1-2501', siteId: 'ST-01' },
  { robotId: 'RV-02', model: 'V1', name: 'V1 영상 2호기', serial: 'V1-2502', siteId: 'ST-07' },
  { robotId: 'RV-03', model: 'V2', name: 'V2 소나 1호기', serial: 'V2-2501', siteId: 'ST-03' },
  { robotId: 'RV-04', model: 'V3', name: 'V3 청소 1호기', serial: 'V3-2501', siteId: 'ST-05' },
  { robotId: 'RV-05', model: 'V3', name: 'V3 청소 2호기', serial: 'V3-2502', siteId: 'ST-06' },
  { robotId: 'RV-06', model: 'V4', name: 'V4 로봇팔 1호기', serial: 'V4-2501', siteId: null },
]

// 기존 입출고 데이터에 더하는 로봇 부품 (YP-RV: 모듈, YP-SP: 소모품). 화면에서 이 접두어로 로봇 부품을 구별한다.
export const ROBOT_PART_PREFIX = 'YP-'

export const ROBOT_PARTS = [
  { partNo: 'YP-RV-001', name: '추진기 모듈', spec: '수평 4기통용', unit: 'EA', safetyStock: 4, location: 'Y-01-01' },
  { partNo: 'YP-RV-002', name: 'LED 조명 모듈', spec: '3000lm 방수', unit: 'EA', safetyStock: 4, location: 'Y-01-02' },
  { partNo: 'YP-RV-003', name: '전방 카메라 모듈', spec: 'FHD 저조도', unit: 'EA', safetyStock: 2, location: 'Y-01-03' },
  { partNo: 'YP-RV-004', name: '어안 카메라 모듈', spec: '180도', unit: 'EA', safetyStock: 2, location: 'Y-01-04' },
  { partNo: 'YP-RV-005', name: '소나 헤드', spec: '멀티빔', unit: 'EA', safetyStock: 1, location: 'Y-02-01' },
  { partNo: 'YP-RV-006', name: '초음파 거리 센서', spec: '360도 8채널', unit: 'EA', safetyStock: 2, location: 'Y-02-02' },
  { partNo: 'YP-RV-007', name: '흡입 펌프', spec: 'V3 청소용', unit: 'EA', safetyStock: 1, location: 'Y-02-03' },
  { partNo: 'YP-RV-008', name: '로봇팔 관절 감속기', spec: '6축용', unit: 'EA', safetyStock: 2, location: 'Y-02-04' },
  { partNo: 'YP-RV-009', name: '배터리팩', spec: '24V 40Ah', unit: 'EA', safetyStock: 3, location: 'Y-03-01' },
  { partNo: 'YP-SP-001', name: '방수 실링 키트', spec: '하우징용', unit: 'SET', safetyStock: 10, location: 'Y-04-01' },
  { partNo: 'YP-SP-002', name: 'O-링 세트', spec: 'NBR 20종', unit: 'SET', safetyStock: 10, location: 'Y-04-02' },
  { partNo: 'YP-SP-003', name: '흡입 호스', spec: '2m 내마모', unit: 'EA', safetyStock: 4, location: 'Y-04-03' },
  { partNo: 'YP-SP-004', name: '테더 케이블', spec: '100m 중성부력', unit: 'EA', safetyStock: 1, location: 'Y-04-04' },
]

// 모델별로 점검 때 자주 쓰는 부품 (점검 완료 화면의 추천 목록)
export const MODEL_PARTS = Object.freeze({
  V1: ['YP-SP-001', 'YP-SP-002', 'YP-RV-002', 'YP-RV-003', 'YP-RV-004', 'YP-RV-001', 'YP-RV-009'],
  V2: ['YP-SP-001', 'YP-SP-002', 'YP-RV-005', 'YP-RV-001', 'YP-RV-009'],
  V3: ['YP-SP-001', 'YP-SP-002', 'YP-SP-003', 'YP-RV-007', 'YP-RV-006', 'YP-RV-001', 'YP-RV-009'],
  V4: ['YP-SP-001', 'YP-SP-002', 'YP-RV-008', 'YP-RV-001', 'YP-RV-009'],
})

export const SAMPLE_INSPECTORS = ['김수중', '이로봇', '박점검', '최현장']
