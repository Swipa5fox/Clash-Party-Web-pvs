import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.mjs'
import { verifyPassword } from './crypto.mjs'
import { runAdmin } from './admin.mjs'

function harness({ password = 'pw' } = {}) {
  const lines = []
  const db = openDb(':memory:')
  const deps = {
    db,
    readPassword: async () => password,
    out: (s) => lines.push(String(s)),
    err: (s) => lines.push('ERR:' + s)
  }
  return { db, deps, lines, text: () => lines.join('\n') }
}

test('add-user creates a user with a hashed password and a device limit', async () => {
  const h = harness({ password: 's3cret' })
  const code = await runAdmin(
    ['add-user', 'alice', 'https://o.example/sub?t=1', '--limit', '5'],
    h.deps
  )
  assert.equal(code, 0)
  const u = h.db.getUser('alice')
  assert.equal(u.subUrl, 'https://o.example/sub?t=1')
  assert.equal(u.deviceLimit, 5)
  assert.equal(verifyPassword('s3cret', u.pwdHash), true)
})

test('add-user rejects a duplicate username with a non-zero exit', async () => {
  const h = harness()
  await runAdmin(['add-user', 'alice', 'https://o/sub'], h.deps)
  const code = await runAdmin(['add-user', 'alice', 'https://o/sub'], h.deps)
  assert.notEqual(code, 0)
  assert.match(h.text(), /exists/i)
})

test('set-sub / set-limit / passwd update an existing user', async () => {
  const h = harness({ password: 'new-pw' })
  await runAdmin(['add-user', 'alice', 'https://o/sub'], h.deps)
  await runAdmin(['set-sub', 'alice', 'https://o/sub2'], h.deps)
  await runAdmin(['set-limit', 'alice', '9'], h.deps)
  await runAdmin(['passwd', 'alice'], h.deps)
  const u = h.db.getUser('alice')
  assert.equal(u.subUrl, 'https://o/sub2')
  assert.equal(u.deviceLimit, 9)
  assert.equal(verifyPassword('new-pw', u.pwdHash), true)
})

test('del-user removes the user and its devices', async () => {
  const h = harness()
  await runAdmin(['add-user', 'alice', 'https://o/sub'], h.deps)
  h.db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  const code = await runAdmin(['del-user', 'alice'], h.deps)
  assert.equal(code, 0)
  assert.equal(h.db.getUser('alice'), undefined)
  assert.equal(h.db.getDevice('d1'), undefined)
})

test('list-users hides the full subUrl by default and shows it with --show-sub', async () => {
  const h = harness()
  await runAdmin(['add-user', 'alice', 'https://secret.example/sub?token=XYZ'], h.deps)
  await runAdmin(['list-users'], h.deps)
  assert.match(h.text(), /secret\.example/)
  assert.doesNotMatch(h.text(), /token=XYZ/)
  await runAdmin(['list-users', '--show-sub'], h.deps)
  assert.match(h.text(), /token=XYZ/)
})

test('list-devices and revoke-device manage bindings', async () => {
  const h = harness()
  await runAdmin(['add-user', 'alice', 'https://o/sub'], h.deps)
  h.db.upsertDevice({ deviceId: 'dev-abc', username: 'alice' })
  await runAdmin(['list-devices', 'alice'], h.deps)
  assert.match(h.text(), /dev-abc/)
  const code = await runAdmin(['revoke-device', 'dev-abc'], h.deps)
  assert.equal(code, 0)
  assert.equal(h.db.getDevice('dev-abc'), undefined)
})

test('operating on a missing user is a non-zero exit with a clear message', async () => {
  const h = harness()
  const code = await runAdmin(['set-sub', 'ghost', 'https://o/sub'], h.deps)
  assert.notEqual(code, 0)
  assert.match(h.text(), /not found/i)
})

test('an unknown command returns non-zero and prints usage', async () => {
  const h = harness()
  const code = await runAdmin(['frobnicate'], h.deps)
  assert.notEqual(code, 0)
  assert.match(h.text(), /usage/i)
})
