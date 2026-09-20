import { describe, it, expect, beforeEach, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auditPluginVault: vi.fn(),
  updatePluginProfile: vi.fn(),
  getAppConfig: vi.fn(),
  getProfileConfig: vi.fn(),
  getCurrentProfileItem: vi.fn(),
  getProfileItem: vi.fn(),
  addProfileItem: vi.fn()
}))

vi.mock('../config', () => ({
  getAppConfig: mocks.getAppConfig,
  getProfileConfig: mocks.getProfileConfig,
  getCurrentProfileItem: mocks.getCurrentProfileItem,
  getProfileItem: mocks.getProfileItem,
  addProfileItem: mocks.addProfileItem
}))

vi.mock('../resolve/plugin', () => ({
  auditPluginVault: mocks.auditPluginVault,
  updatePluginProfile: mocks.updatePluginProfile
}))

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn() }
}))

describe('initProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAppConfig.mockResolvedValue({ autoUpdateProfileOnStart: true })
    mocks.getProfileConfig.mockResolvedValue({
      current: 'default',
      items: [
        {
          id: 'profile-plugin',
          type: 'plugin',
          name: 'Demo',
          pluginId: 'plugin-id',
          autoUpdate: false,
          interval: 0
        }
      ]
    })
    mocks.getCurrentProfileItem.mockResolvedValue({
      id: 'default',
      type: 'local',
      name: 'Empty'
    })
    mocks.getProfileItem.mockResolvedValue(undefined)
  })

  it('audits plugin vault availability on startup even when auto update is disabled', async () => {
    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.auditPluginVault).toHaveBeenCalledWith('plugin-id')
    expect(mocks.updatePluginProfile).not.toHaveBeenCalled()
  })

  it('skips remote profile updates on startup when disabled', async () => {
    const remoteProfile = {
      id: 'profile-remote',
      type: 'remote',
      name: 'Remote',
      autoUpdate: true,
      interval: 'invalid cron'
    }
    mocks.getAppConfig.mockResolvedValue({ autoUpdateProfileOnStart: false })
    mocks.getProfileConfig.mockResolvedValue({ current: remoteProfile.id, items: [remoteProfile] })
    mocks.getCurrentProfileItem.mockResolvedValue(remoteProfile)
    mocks.getProfileItem.mockResolvedValue(remoteProfile)

    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.addProfileItem).not.toHaveBeenCalled()
  })

  it('updates remote profiles on startup by default', async () => {
    const remoteProfile = {
      id: 'profile-remote',
      type: 'remote',
      name: 'Remote',
      autoUpdate: true,
      interval: 'invalid cron'
    }
    mocks.getProfileConfig.mockResolvedValue({ current: remoteProfile.id, items: [remoteProfile] })
    mocks.getCurrentProfileItem.mockResolvedValue(remoteProfile)
    mocks.getProfileItem.mockResolvedValue(remoteProfile)

    const { initProfileUpdater } = await import('./profileUpdater')
    await initProfileUpdater()

    expect(mocks.addProfileItem).toHaveBeenCalledWith(remoteProfile)
  })
})
