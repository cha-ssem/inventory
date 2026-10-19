// 동기화 정보(보낼 목록·진행 상태)는 localStorage에 JSON으로 둔다. 저장소는 언제든 실패할 수 있어 모두 감싼다.
export const readJson = (kv, key, fallback) => {
  try {
    const raw = kv?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (error) {
    console.error('동기화 정보를 읽지 못했습니다:', error)
    return fallback
  }
}

// 저장했으면 true (저장소가 없거나 실패하면 false)
export const writeJson = (kv, key, value) => {
  if (!kv) return false
  try {
    if (value === null) kv.removeItem(key)
    else kv.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.error('동기화 정보를 저장하지 못했습니다:', error)
    return false
  }
}
