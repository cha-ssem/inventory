// 강의·OCR 시험용 가상 거래명세서 데이터. 공급사와 사업자번호는 모두 가상이다.
// 품번(SK-…)은 앱 샘플 데이터(src/data/sampleCatalog.js)와 같아서 OCR 결과를 그대로 맞춰 볼 수 있다.

export const BUYER = {
  name: '(주)삼광케미칼',
  bizNo: '000-00-00000',
  address: '울산광역시 북구 산성로 83',
  contact: '자재팀',
}

export const STATEMENTS = [
  {
    file: 'sample-01-resin',
    no: 'DS-2610-0012',
    date: '2026-10-02',
    supplier: {
      name: '대한수지(가상)',
      bizNo: '000-00-00001',
      ceo: '홍길동',
      address: '울산광역시 남구 가상로 101',
      type: '도매 / 합성수지',
      phone: '052-000-0001',
    },
    note: '납기 준수 바랍니다.',
    // 우리 회사 품번이 모두 적혀 있는 경우 (자동 연결 시험)
    items: [
      { partNo: 'SK-RM-001', code: 'DH-PP-25', name: 'PP 수지', spec: '25kg/포', unit: 'BAG', qty: 40, price: 42000 },
      { partNo: 'SK-RM-002', code: 'DH-ABS-25', name: 'ABS 수지', spec: '25kg/포', unit: 'BAG', qty: 20, price: 58000 },
      { partNo: 'SK-RM-003', code: 'DH-PA66-25', name: 'PA66 수지', spec: '25kg/포', unit: 'BAG', qty: 10, price: 96000 },
      { partNo: 'SK-RM-004', code: 'DH-MB-BK', name: '마스터배치 블랙', spec: '20kg/포', unit: 'BAG', qty: 5, price: 71000 },
    ],
  },
  {
    file: 'sample-02-parts',
    no: 'DB-1002-338',
    date: '2026-10-03',
    supplier: {
      name: '동방부품(가상)',
      bizNo: '000-00-00002',
      ceo: '김철수',
      address: '부산광역시 사상구 가상대로 22',
      type: '제조 / 자동차부품',
      phone: '051-000-0002',
    },
    note: '클립은 박스당 500EA',
    // 우리 품번이 빠진 행이 섞인 경우 (공급사 코드·품명으로 맞춰야 함)
    items: [
      { partNo: 'SK-SB-001', code: 'DB-CL-500', name: '체결 클립', spec: 'POM', unit: 'BOX', qty: 30, price: 18500 },
      { partNo: '', code: 'DB-PK-NBR', name: '고무 패킹', spec: 'NBR', unit: 'BOX', qty: 20, price: 22000 },
      { partNo: 'SK-SB-003', code: 'DB-SC-M5', name: '스크류 M5', spec: 'SUS 1000ea', unit: 'BOX', qty: 15, price: 31000 },
      { partNo: '', code: 'DB-BR-16', name: '페달 암 브래킷', spec: 'SPCC 1.6t', unit: 'EA', qty: 200, price: 2300 },
      { partNo: 'SK-PD-004', code: 'DB-ST-TPE', name: '페달 스토퍼', spec: 'TPE', unit: 'EA', qty: 300, price: 450 },
    ],
  },
  {
    file: 'sample-03-packing',
    no: 'SJ-26100045',
    date: '2026-10-04',
    supplier: {
      name: '세진포장(가상)',
      bizNo: '000-00-00003',
      ceo: '이영희',
      address: '경상남도 양산시 가상공단길 7',
      type: '제조 / 포장재',
      phone: '055-000-0003',
    },
    note: '파손 시 즉시 연락 바랍니다.',
    // 미등록 품목(SK 품번 없음)이 섞인 경우 (신규 부품 등록 유도)
    items: [
      { partNo: 'SK-SB-004', code: 'SJ-BX-M', name: '포장 박스 (중)', spec: '골판지 400x300', unit: 'EA', qty: 500, price: 850 },
      { partNo: 'SK-SB-005', code: 'SJ-PD-EPE', name: '완충 패드', spec: 'EPE', unit: 'EA', qty: 800, price: 320 },
      { partNo: '', code: 'SJ-TP-48', name: '포장 테이프', spec: '48mm x 50m', unit: 'EA', qty: 60, price: 1200 },
    ],
  },
]

export const BLANK_ROWS = 12
