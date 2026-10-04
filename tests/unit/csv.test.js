import { describe, it, expect } from 'vitest'
import { toCsv, parseCsv, parsePartsCsv, BOM } from '../../src/domain/csv.js'

describe('toCsv', () => {
  it('엑셀에서 한글이 깨지지 않도록 BOM을 붙이고 CRLF로 줄을 나눈다', () => {
    const csv = toCsv([['품번', '수량'], ['A1', 3]])
    expect(csv).toBe(`${BOM}품번,수량\r\nA1,3`)
  })

  it('쉼표, 따옴표, 줄바꿈이 있는 값은 따옴표로 감싼다', () => {
    const csv = toCsv([['a,b', 'say "hi"', 'line\nbreak']])
    expect(csv).toBe(`${BOM}"a,b","say ""hi""","line\nbreak"`)
  })

  it('수식으로 해석될 수 있는 문자열은 앞에 작은따옴표를 붙인다', () => {
    const csv = toCsv([['=SUM(A1)', '+1', '@cmd', '-x', '정상']])
    expect(csv).toBe(`${BOM}'=SUM(A1),'+1,'@cmd,'-x,정상`)
  })

  it('숫자 음수와 null·undefined는 그대로 처리한다', () => {
    expect(toCsv([[-5, null, undefined]])).toBe(`${BOM}-5,,`)
  })
})

describe('parseCsv', () => {
  it('BOM을 지우고 따옴표 안의 쉼표·줄바꿈·이중 따옴표를 처리한다', () => {
    const rows = parseCsv(`${BOM}a,"b,c","d""e"\r\n"f\ng",h\n`)
    expect(rows).toEqual([
      ['a', 'b,c', 'd"e'],
      ['f\ng', 'h'],
    ])
  })

  it('빈 줄은 건너뛴다', () => {
    expect(parseCsv('a,b\n\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parsePartsCsv', () => {
  it('한글 머리글을 인식해서 부품 입력으로 바꾼다', () => {
    const text = '품번,품명,규격,단위,안전재고,보관위치\nsk-ad-001,덕트,PP,EA,10,A-01\nSK-PD-001,페달,,EA,,B-01'
    const result = parsePartsCsv(text, [])
    expect(result.errors).toEqual([])
    expect(result.parts).toHaveLength(2)
    expect(result.parts[0]).toMatchObject({ partNo: 'SK-AD-001', safetyStock: 10, location: 'A-01' })
    expect(result.parts[1].safetyStock).toBe(0)
  })

  it('영문 머리글도 인식한다', () => {
    const result = parsePartsCsv('partNo,name,unit\nA1,부품,EA', [])
    expect(result.parts[0]).toMatchObject({ partNo: 'A1', name: '부품', unit: 'EA' })
  })

  it('잘못된 줄은 줄 번호와 함께 오류로 모으고 나머지는 계속 처리한다', () => {
    const text = '품번,품명,단위\nA1,부품,EA\n,이름만,EA\nA1,중복,EA\nB1,정상,EA'
    const result = parsePartsCsv(text, [])
    expect(result.parts.map((p) => p.partNo)).toEqual(['A1', 'B1'])
    expect(result.errors.map((e) => e.line)).toEqual([3, 4])
  })

  it('이미 등록된 품번은 오류로 처리한다', () => {
    const result = parsePartsCsv('품번,품명,단위\nA1,부품,EA', [{ partNo: 'A1' }])
    expect(result.parts).toHaveLength(0)
    expect(result.errors[0].line).toBe(2)
  })

  it('품번 머리글이 없으면 전체 오류를 돌려준다', () => {
    const result = parsePartsCsv('이름,수량\n덕트,3', [])
    expect(result.parts).toHaveLength(0)
    expect(result.errors[0]).toMatchObject({ line: 1 })
  })

  it('행 수 제한을 넘으면 거부한다', () => {
    const body = Array.from({ length: 1001 }, (_, i) => `P${i},부품,EA`).join('\n')
    const result = parsePartsCsv(`품번,품명,단위\n${body}`, [])
    expect(result.parts).toHaveLength(0)
    expect(result.errors[0].message).toMatch(/1000/)
  })
})

describe('parseCsv 따옴표 처리', () => {
  it('셀 중간의 따옴표는 글자로 본다', () => {
    expect(parseCsv('12" 덕트,EA')).toEqual([['12" 덕트', 'EA']])
  })

  it('따옴표가 닫히지 않으면 오류를 던진다', () => {
    expect(() => parseCsv('a,"bc\nd,e')).toThrow(/따옴표/)
  })

  it('닫는 따옴표 뒤의 글자는 셀에 이어 붙인다', () => {
    expect(parseCsv('"ab"c,d')).toEqual([['abc', 'd']])
  })
})

describe('parsePartsCsv 추가 규칙', () => {
  it('따옴표 오류가 있으면 전체 오류로 알린다', () => {
    const result = parsePartsCsv('품번,품명,단위\nA1,"덕트,EA', [])
    expect(result.parts).toHaveLength(0)
    expect(result.errors[0].message).toMatch(/따옴표/)
  })

  it('내보낼 때 붙인 수식 방지 작은따옴표를 가져올 때 지운다', () => {
    const result = parsePartsCsv(`품번,품명,규격,단위\nA1,볼트,'-M6,EA`, [])
    expect(result.parts[0].spec).toBe('-M6')
  })
})
