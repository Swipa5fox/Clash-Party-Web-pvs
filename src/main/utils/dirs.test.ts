import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// dirs.ts 用 path.join 拼路径，在 Windows 上会得到反斜杠分隔符。
// 断言里不能写死 POSIX 字面量，否则整个用例只在类 Unix 平台通过。
const HOME = path.join(path.sep, 'tmp', 'home')
const XDG = path.join(HOME, '.local', 'share')

vi.mock('os', () => ({ homedir: () => HOME }))

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    existsSync: (value: string) => path.basename(value) === 'package.json'
  }
})

vi.mock('../runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../runtime')>()
  return {
    ...original,
    installRoot: () => path.join(path.sep, 'tmp', 'repo')
  }
})

beforeEach(() => {
  delete process.env.CP_DATA_DIR
  delete process.env.XDG_DATA_HOME
  vi.resetModules()
})

afterEach(() => vi.restoreAllMocks())

describe('dataDir', () => {
  it('prefers CP_DATA_DIR over everything', async () => {
    process.env.CP_DATA_DIR = path.join(path.sep, 'var', 'lib', 'clash-party')
    const { dataDir } = await import('./dirs')
    expect(dataDir()).toBe(path.join(path.sep, 'var', 'lib', 'clash-party'))
  })

  it('falls back to XDG_DATA_HOME/clash-party', async () => {
    process.env.XDG_DATA_HOME = path.join(path.sep, 'tmp', 'xdg')
    const { dataDir } = await import('./dirs')
    expect(dataDir()).toBe(path.join(path.sep, 'tmp', 'xdg', 'clash-party'))
  })

  it('defaults to ~/.local/share/clash-party', async () => {
    const { dataDir } = await import('./dirs')
    expect(dataDir()).toBe(path.join(XDG, 'clash-party'))
  })
})
