#!/usr/bin/env -S node --experimental-sqlite --disable-warning=ExperimentalWarning
// cpx-admin CLI entrypoint. Wires the real account DB + a no-echo password reader into
// the tested command logic (src/admin.mjs).
import { loadConfig } from './src/config.mjs'
import { openDb } from './src/db.mjs'
import { runAdmin } from './src/admin.mjs'
import { readPassword } from './src/prompt.mjs'

const config = loadConfig()
const db = openDb(config.dbPath)
const code = await runAdmin(process.argv.slice(2), {
  db,
  deviceLimitDefault: config.deviceLimitDefault,
  readPassword,
  out: (s) => console.log(s),
  err: (s) => console.error(s)
})
db.close()
process.exit(code)
