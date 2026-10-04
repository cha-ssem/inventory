import { describe, it, expect, vi } from 'vitest'
import { createStorage, STORAGE_KEY } from '../../src/data/storage.js'

const memoryBackend = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

describe('createStorage', () => {
  it('저장한 상태를 다시 불러온다', () => {
    const storage = createStorage(memoryBackend())
    const state = { parts: [{ partNo: 'A', name: '부품', unit: 'EA', safetyStock: 0, active: true }], transactions: [] }
    expect(storage.save(state)).toBe(true)
    expect(storage.load()).toEqual(state)
  })

  it('저장된 값이 없으면 null을 돌려준다', () => {
    expect(createStorage(memoryBackend()).load()).toBeNull()
  })

  it('저장된 값이 깨져 있으면 null을 돌려준다', () => {
    const backend = memoryBackend()
    backend.setItem(STORAGE_KEY, '{broken')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(createStorage(backend).load()).toBeNull()
    spy.mockRestore()
  })

  it('저장 형식이 맞지 않으면 null을 돌려준다', () => {
    const backend = memoryBackend()
    backend.setItem(STORAGE_KEY, JSON.stringify({ parts: 'x' }))
    expect(createStorage(backend).load()).toBeNull()
  })

  it('브라우저 저장소를 쓸 수 없으면 실패를 알리고 예외를 던지지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = createStorage(broken)
    expect(storage.load()).toBeNull()
    expect(storage.save({ parts: [], transactions: [] })).toBe(false)
    expect(storage.clear()).toBe(false)
    spy.mockRestore()
  })

  it('저장소 자체가 없어도 동작한다', () => {
    const storage = createStorage(null)
    expect(storage.load()).toBeNull()
    expect(storage.save({ parts: [], transactions: [] })).toBe(false)
  })

  it('clear는 저장된 값을 지운다', () => {
    const storage = createStorage(memoryBackend())
    storage.save({ parts: [], transactions: [] })
    expect(storage.clear()).toBe(true)
    expect(storage.load()).toBeNull()
  })
})
