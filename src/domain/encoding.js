// 한국어 엑셀의 "CSV(쉼표로 분리)"는 CP949(EUC-KR)로 저장되므로, UTF-8로 읽히지 않으면 EUC-KR로 다시 읽는다.
export const decodeText = (buffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('euc-kr').decode(buffer)
  }
}
