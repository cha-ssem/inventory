import { describe, it, expect } from 'vitest'
import { decodeText } from '../../src/domain/encoding.js'

describe('decodeText', () => {
  it('UTF-8 파일은 그대로 읽는다', () => {
    const bytes = new TextEncoder().encode('품번,품명\nA1,덕트')
    expect(decodeText(bytes.buffer)).toBe('품번,품명\nA1,덕트')
  })

  it('한국어 엑셀이 저장한 CP949(EUC-KR) CSV도 읽는다', () => {
    const cp949 = new Uint8Array([199, 176, 185, 248, 44, 199, 176, 184, 237, 44, 180, 220, 192, 167, 10, 65, 49, 44, 180, 246, 198, 174, 44, 69, 65])
    expect(decodeText(cp949.buffer)).toBe('품번,품명,단위\nA1,덕트,EA')
  })
})
