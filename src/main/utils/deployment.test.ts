import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dockerEnvExists = vi.fn<(path: string) => boolean>(() => false)

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>()
  return {
    ...original,
    existsSync: (path: string) => dockerEnvExists(path)
  }
})

describe('deployment', () => {
  let platformGetter: (() => NodeJS.Platform) | undefined

  beforeEach(async () => {
    const deployment = await import('./deployment')
    deployment.resetDeploymentCacheForTest()
    // mockReset（而非 mockClear）：同时清掉上一个用例设置的实现，
    // 让未显式 mockImplementation 的用例得到 falsy → desktop。
    dockerEnvExists.mockReset()
    platformGetter = Object.getOwnPropertyDescriptor(process, 'platform')?.get
  })

  afterEach(() => {
    if (platformGetter) {
      Object.defineProperty(process, 'platform', { get: platformGetter })
    }
    vi.resetModules()
  })

  const stubPlatform = (value: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value })
  }

  it('linux + /.dockerenv 存在 → container', async () => {
    stubPlatform('linux')
    dockerEnvExists.mockImplementation((p: string) => p === '/.dockerenv')
    const { getDeploymentEnv, isContainerDeployment } = await import('./deployment')
    expect(isContainerDeployment()).toBe(true)
    expect(getDeploymentEnv()).toBe('container')
  })

  it('linux + 无 /.dockerenv → desktop', async () => {
    stubPlatform('linux')
    const { getDeploymentEnv } = await import('./deployment')
    expect(getDeploymentEnv()).toBe('desktop')
  })

  it('非 linux 平台即使 /.dockerenv 存在也视为 desktop（不做 fs 探测）', async () => {
    stubPlatform('win32')
    dockerEnvExists.mockImplementation(() => true)
    const { getDeploymentEnv } = await import('./deployment')
    expect(getDeploymentEnv()).toBe('desktop')
    expect(dockerEnvExists).not.toHaveBeenCalled()
  })

  it('检测结果被缓存：重复调用不再触碰文件系统', async () => {
    stubPlatform('linux')
    dockerEnvExists.mockImplementation((p: string) => p === '/.dockerenv')
    const { getDeploymentEnv } = await import('./deployment')
    getDeploymentEnv()
    getDeploymentEnv()
    expect(dockerEnvExists).toHaveBeenCalledTimes(1)
  })
})
