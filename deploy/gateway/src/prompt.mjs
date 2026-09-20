// No-echo password prompt. On a TTY it reads two lines with echo off and confirms they
// match; when stdin is piped (scripts/CI) it reads stdin: one line is used for both,
// two lines must match. I/O glue — exercised by the container smoke, not unit tests.
import { stdin, stdout } from 'node:process'

// Control codes by ordinal to avoid embedding raw control bytes in source.
const LF = 10
const CR = 13
const EOT = 4 // Ctrl-D / end of transmission
const ETX = 3 // Ctrl-C
const DEL = 127
const BS = 8

function readLineNoEcho(prompt) {
  return new Promise((resolve) => {
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    let buf = ''
    const onData = (chunk) => {
      for (const c of chunk.toString('utf-8')) {
        const code = c.charCodeAt(0)
        if (code === LF || code === CR || code === EOT) {
          stdin.setRawMode(false)
          stdin.removeListener('data', onData)
          stdin.pause()
          stdout.write('\n')
          return resolve(buf)
        }
        if (code === ETX) {
          stdin.setRawMode(false)
          stdout.write('\n')
          process.exit(130)
        }
        if (code === DEL || code === BS) buf = buf.slice(0, -1)
        else buf += c
      }
    }
    stdin.on('data', onData)
  })
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = ''
    stdin.setEncoding('utf-8')
    stdin.on('data', (c) => (data += c))
    stdin.on('end', () => resolve(data))
    stdin.resume()
  })
}

export async function readPassword(prompt = 'Password: ') {
  let a, b
  if (stdin.isTTY) {
    a = await readLineNoEcho(prompt)
    b = await readLineNoEcho('Confirm:  ')
  } else {
    const lines = (await readAllStdin()).split(/\r?\n/)
    a = lines[0] ?? ''
    b = lines.length > 1 && lines[1] !== '' ? lines[1] : a
  }
  if (a !== b) {
    stdout.write('Passwords do not match.\n')
    return ''
  }
  return a
}
