import { open } from 'fs/promises'
import { basename, extname, resolve } from 'path'
import { MAX_PLUGIN_FILE_BYTES } from './constants'

export function findPluginFile(args: string[]): string | undefined {
  return args.find(
    (arg) => !arg.startsWith('-') && !arg.includes('://') && extname(arg).toLowerCase() === '.cpx'
  )
}

export async function readPluginFile(filePath: string): Promise<IPluginFilePayload> {
  if (extname(filePath).toLowerCase() !== '.cpx') throw new Error('Unsupported plugin file type')

  const resolvedPath = resolve(filePath)
  const handle = await open(resolvedPath, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Plugin path is not a file')
    if (stat.size > MAX_PLUGIN_FILE_BYTES) throw new Error('Plugin file too large')

    // Read at most one byte beyond the limit so a file growing after stat cannot bypass the cap.
    const bytes = Buffer.alloc(MAX_PLUGIN_FILE_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > MAX_PLUGIN_FILE_BYTES) throw new Error('Plugin file too large')

    return {
      name: basename(resolvedPath),
      fileBytesB64: bytes.subarray(0, length).toString('base64')
    }
  } finally {
    await handle.close()
  }
}
