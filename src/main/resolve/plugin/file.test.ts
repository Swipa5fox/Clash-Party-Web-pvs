import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_PLUGIN_FILE_BYTES } from './constants'
import { findPluginFile, readPluginFile } from './file'

let tempDir: string | undefined

async function tempFile(name: string, content: string | Buffer): Promise<string> {
  tempDir ??= await mkdtemp(join(tmpdir(), 'clash-party-cpx-'))
  const filePath = join(tempDir, name)
  await writeFile(filePath, content)
  return filePath
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('findPluginFile', () => {
  it('finds a cpx path anywhere in the command line', () => {
    expect(findPluginFile(['app', '--flag', '/tmp/provider.CPX'])).toBe('/tmp/provider.CPX')
  })

  it('ignores unrelated arguments and URLs', () => {
    expect(
      findPluginFile(['app', '--config=provider.cpx', 'clash://install-plugin?url=app.cpx'])
    ).toBeUndefined()
  })
})

describe('readPluginFile', () => {
  it('returns the file name and base64 bytes', async () => {
    const filePath = await tempFile('provider.cpx', '{"magic":"CPXF"}')
    const payload = await readPluginFile(filePath)

    expect(payload.name).toBe('provider.cpx')
    expect(Buffer.from(payload.fileBytesB64, 'base64').toString('utf-8')).toBe('{"magic":"CPXF"}')
  })

  it('rejects a non-cpx file', async () => {
    const filePath = await tempFile('provider.json', '{}')
    await expect(readPluginFile(filePath)).rejects.toThrow(/unsupported/i)
  })

  it('rejects a file over the plugin limit', async () => {
    const filePath = await tempFile('provider.cpx', Buffer.alloc(MAX_PLUGIN_FILE_BYTES + 1))
    await expect(readPluginFile(filePath)).rejects.toThrow(/too large/i)
  })
})
