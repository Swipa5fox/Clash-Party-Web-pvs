import { once } from 'events'
import { mkdtemp, readFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoreLogWritableStream, setCoreLogDisabled } from './logFile'
import { createLogger, setAppLogDisabled } from './logger'

const paths = vi.hoisted(() => ({ appLogPath: '' }))

vi.mock('./dirs', () => ({
  logPath: () => paths.appLogPath
}))

describe('application log switch', () => {
  let tempDir: string

  beforeEach(async () => {
    setAppLogDisabled(false)
    setCoreLogDisabled(false)
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mihomo-party-log-'))
    paths.appLogPath = path.join(tempDir, 'app.log')
  })

  afterEach(async () => {
    setAppLogDisabled(false)
    setCoreLogDisabled(false)
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('does not write application logs when disabled', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    setAppLogDisabled(true)

    await createLogger('test').info('should not be written')

    await expect(readFile(paths.appLogPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(consoleLog).toHaveBeenCalled()
  })

  it('does not disable core log streams', async () => {
    const coreLogPath = path.join(tempDir, 'core.log')
    setAppLogDisabled(true)

    const coreLog = createCoreLogWritableStream(coreLogPath)
    coreLog.end('core log')
    await once(coreLog, 'finish')

    await expect(readFile(coreLogPath, 'utf8')).resolves.toBe('core log')
  })
})
