import { once } from 'events'
import { mkdtemp, readFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCoreLogWritableStream, setCoreLogDisabled } from './logFile'

describe('log file output', () => {
  let tempDir: string

  beforeEach(async () => {
    setCoreLogDisabled(false)
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mihomo-party-log-'))
  })

  afterEach(async () => {
    setCoreLogDisabled(false)
    await rm(tempDir, { recursive: true, force: true })
  })

  it('does not write core log streams when disabled', async () => {
    const filePath = path.join(tempDir, 'core.log')
    setCoreLogDisabled(true)
    const stream = createCoreLogWritableStream(filePath)
    stream.end('ignored')
    await once(stream, 'finish')

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resumes core log writing when enabled again', async () => {
    const filePath = path.join(tempDir, 'core.log')
    setCoreLogDisabled(true)
    const stream = createCoreLogWritableStream(filePath)
    stream.end('ignored')
    await once(stream, 'finish')

    setCoreLogDisabled(false)
    const enabledStream = createCoreLogWritableStream(filePath)
    enabledStream.end('written')
    await once(enabledStream, 'finish')

    await expect(readFile(filePath, 'utf8')).resolves.toBe('written')
  })

  it('applies changes to an existing core log stream per chunk', async () => {
    const filePath = path.join(tempDir, 'core.log')
    const stream = createCoreLogWritableStream(filePath)
    const writeChunk = (chunk: string): Promise<void> =>
      new Promise((resolve, reject) => {
        stream.write(chunk, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })

    await writeChunk('before')
    setCoreLogDisabled(true)
    await writeChunk('ignored')
    setCoreLogDisabled(false)
    stream.end('after')
    await once(stream, 'finish')

    await expect(readFile(filePath, 'utf8')).resolves.toBe('beforeafter')
  })
})
