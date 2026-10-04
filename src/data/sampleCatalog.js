// 강의 시연용 가상 데이터. 실제 회사 품번이나 고객사명이 아니다.
export const SAMPLE_PARTS = [
  { partNo: 'SK-AD-001', name: '에어벤트 덕트 센터', spec: 'PP 사출', unit: 'EA', safetyStock: 200, location: 'A-01-01' },
  { partNo: 'SK-AD-002', name: '에어벤트 덕트 LH', spec: 'PP 사출', unit: 'EA', safetyStock: 150, location: 'A-01-02' },
  { partNo: 'SK-AD-003', name: '에어벤트 덕트 RH', spec: 'PP 사출', unit: 'EA', safetyStock: 150, location: 'A-01-03' },
  { partNo: 'SK-AD-004', name: '디프로스터 덕트', spec: 'PP 블로우', unit: 'EA', safetyStock: 100, location: 'A-02-01' },
  { partNo: 'SK-AD-005', name: '리어 덕트 커넥터', spec: 'ABS 사출', unit: 'EA', safetyStock: 120, location: 'A-02-02' },
  { partNo: 'SK-AD-006', name: '플로어 덕트', spec: 'PP 블로우', unit: 'EA', safetyStock: 80, location: 'A-02-03' },
  { partNo: 'SK-PD-001', name: '액셀 페달 하우징', spec: 'PA66 GF30', unit: 'EA', safetyStock: 150, location: 'B-01-01' },
  { partNo: 'SK-PD-002', name: '브레이크 페달 패드', spec: 'EPDM', unit: 'EA', safetyStock: 200, location: 'B-01-02' },
  { partNo: 'SK-PD-003', name: '페달 암 브래킷', spec: 'SPCC 1.6t', unit: 'EA', safetyStock: 100, location: 'B-01-03' },
  { partNo: 'SK-PD-004', name: '페달 스토퍼', spec: 'TPE', unit: 'EA', safetyStock: 300, location: 'B-02-01' },
  { partNo: 'SK-PD-005', name: '클러치 페달 커버', spec: 'PP 사출', unit: 'EA', safetyStock: 80, location: 'B-02-02' },
  { partNo: 'SK-CS-001', name: '컨트롤 박스 케이스', spec: 'ABS 사출', unit: 'EA', safetyStock: 100, location: 'C-01-01' },
  { partNo: 'SK-CS-002', name: '퓨즈 박스 커버', spec: 'PP 사출', unit: 'EA', safetyStock: 120, location: 'C-01-02' },
  { partNo: 'SK-CS-003', name: '커넥터 하우징', spec: 'PBT', unit: 'EA', safetyStock: 500, location: 'C-01-03' },
  { partNo: 'SK-CS-004', name: '센서 케이스', spec: 'PA6', unit: 'EA', safetyStock: 200, location: 'C-02-01' },
  { partNo: 'SK-CS-005', name: '배터리 트레이', spec: 'PP 사출', unit: 'EA', safetyStock: 60, location: 'C-02-02' },
  { partNo: 'SK-RM-001', name: 'PP 수지', spec: '25kg/포', unit: 'BAG', safetyStock: 40, location: 'R-01-01' },
  { partNo: 'SK-RM-002', name: 'ABS 수지', spec: '25kg/포', unit: 'BAG', safetyStock: 20, location: 'R-01-02' },
  { partNo: 'SK-RM-003', name: 'PA66 수지', spec: '25kg/포', unit: 'BAG', safetyStock: 15, location: 'R-01-03' },
  { partNo: 'SK-RM-004', name: '마스터배치 블랙', spec: '20kg/포', unit: 'BAG', safetyStock: 10, location: 'R-02-01' },
  { partNo: 'SK-SB-001', name: '체결 클립', spec: 'POM', unit: 'BOX', safetyStock: 30, location: 'S-01-01' },
  { partNo: 'SK-SB-002', name: '고무 패킹', spec: 'NBR', unit: 'BOX', safetyStock: 20, location: 'S-01-02' },
  { partNo: 'SK-SB-003', name: '스크류 M5', spec: 'SUS 1000ea/BOX', unit: 'BOX', safetyStock: 15, location: 'S-01-03' },
  { partNo: 'SK-SB-004', name: '포장 박스 (중)', spec: '골판지 400x300', unit: 'EA', safetyStock: 300, location: 'S-02-01' },
  { partNo: 'SK-SB-005', name: '완충 패드', spec: 'EPE', unit: 'EA', safetyStock: 400, location: 'S-02-02' },
]

// 안전재고 미달로 보이게 할 품목 (시연용)
export const SAMPLE_LOW_PARTS = ['SK-AD-001', 'SK-PD-003', 'SK-RM-002', 'SK-SB-004']

export const SAMPLE_SUPPLIERS = ['대한수지', '한빛폴리머', '동방부품', '세진포장']
export const SAMPLE_DESTINATIONS = ['사출 1라인', '사출 2라인', '조립라인', '고객사 납품']
export const SAMPLE_WORKERS = ['김자재', '이생산', '박품질', '최출고']
