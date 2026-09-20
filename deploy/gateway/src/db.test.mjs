import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.mjs'

function freshDb() {
  return openDb(':memory:')
}
const USER = {
  username: 'alice',
  pwdHash: 'scrypt$x',
  subUrl: 'https://o.example/sub?t=1',
  deviceLimit: 3
}

test('addUser/getUser round-trips; unknown user is undefined', () => {
  const db = freshDb()
  db.addUser(USER)
  const u = db.getUser('alice')
  assert.equal(u.username, 'alice')
  assert.equal(u.subUrl, USER.subUrl)
  assert.equal(u.deviceLimit, 3)
  assert.ok(u.created > 0)
  assert.equal(db.getUser('bob'), undefined)
  db.close()
})

test('addUser rejects a duplicate username', () => {
  const db = freshDb()
  db.addUser(USER)
  assert.throws(() => db.addUser(USER))
  db.close()
})

test('setSub / setLimit / setPwd update the user', () => {
  const db = freshDb()
  db.addUser(USER)
  db.setSub('alice', 'https://o.example/sub?t=2')
  db.setLimit('alice', 5)
  db.setPwd('alice', 'scrypt$y')
  const u = db.getUser('alice')
  assert.equal(u.subUrl, 'https://o.example/sub?t=2')
  assert.equal(u.deviceLimit, 5)
  assert.equal(u.pwdHash, 'scrypt$y')
  db.close()
})

test('upsertDevice binds a device; re-upsert updates without growing the count', () => {
  const db = freshDb()
  db.addUser(USER)
  db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  assert.equal(db.countDevices('alice'), 1)
  assert.equal(db.getDevice('d1').deviceId, 'd1')
  db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  assert.equal(db.countDevices('alice'), 1)
  db.close()
})

test('delDevice removes a single device', () => {
  const db = freshDb()
  db.addUser(USER)
  db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  db.delDevice('d1')
  assert.equal(db.getDevice('d1'), undefined)
  assert.equal(db.countDevices('alice'), 0)
  db.close()
})

test('delUser cascades to its devices', () => {
  const db = freshDb()
  db.addUser(USER)
  db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  db.upsertDevice({ deviceId: 'd2', username: 'alice' })
  db.delUser('alice')
  assert.equal(db.getUser('alice'), undefined)
  assert.equal(db.getDevice('d1'), undefined)
  assert.equal(db.getDevice('d2'), undefined)
  db.close()
})

test('listUsers reports device counts; listDevices lists a user devices', () => {
  const db = freshDb()
  db.addUser(USER)
  db.addUser({ ...USER, username: 'bob' })
  db.upsertDevice({ deviceId: 'd1', username: 'alice' })
  const users = db.listUsers().sort((a, b) => a.username.localeCompare(b.username))
  assert.equal(users.length, 2)
  assert.equal(users[0].username, 'alice')
  assert.equal(users[0].deviceCount, 1)
  assert.equal(users[1].deviceCount, 0)
  const devices = db.listDevices('alice')
  assert.equal(devices.length, 1)
  assert.equal(devices[0].deviceId, 'd1')
  db.close()
})
