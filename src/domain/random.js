// 같은 seed면 항상 같은 값을 내는 의사 난수 (mulberry32). 샘플 데이터·가상 센서가 함께 쓴다.
export const createRandom = (seed) => {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296
  }
}
