import { isValidState } from '../domain/backup.js'

export const STORAGE_KEY = 'samkwang-inventory:v1'

// 브라우저 저장소는 사생활 보호 모드나 용량 초과로 언제든 실패할 수 있으므로 모든 접근을 감싼다.
export const createStorage = (backend, key = STORAGE_KEY) => {
  const load = () => {
    if (!backend) return null
    try {
      const raw = backend.getItem(key)
      if (raw === null) return null
      const data = JSON.parse(raw)
      return isValidState(data) ? data : null
    } catch (error) {
      console.error('저장된 데이터를 불러오지 못했습니다:', error)
      return null
    }
  }

  const save = (state) => {
    if (!backend) return false
    try {
      backend.setItem(key, JSON.stringify(state))
      return true
    } catch (error) {
      console.error('데이터를 저장하지 못했습니다:', error)
      return false
    }
  }

  const clear = () => {
    if (!backend) return false
    try {
      backend.removeItem(key)
      return true
    } catch (error) {
      console.error('저장된 데이터를 지우지 못했습니다:', error)
      return false
    }
  }

  return { load, save, clear }
}

export const getBrowserStorageBackend = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
