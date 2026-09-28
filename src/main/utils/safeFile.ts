import { randomBytes } from 'crypto'
import { open, rename, rm, type FileHandle } from 'fs/promises'
import { basename, dirname, join } from 'path'

export interface AtomicWriteOptions {
  encoding?: BufferEncoding
  mode?: number
}

function temporaryPath(filePath: string): string {
  return join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  )
}

/**
 * Write a complete replacement beside the existing file, then atomically rename it into place.
 * A failed write never truncates the previous file.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const tempPath = temporaryPath(filePath)
  let handle: FileHandle | undefined

  try {
    handle = await open(tempPath, 'wx', options.mode)
    await handle.writeFile(data, options.encoding ?? 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(tempPath, filePath)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

/** Keeps writes serialized without allowing one failed write to block later retries. */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const current = this.tail.then(task, task)
    this.tail = current.then(
      () => undefined,
      () => undefined
    )
    return current
  }
}
