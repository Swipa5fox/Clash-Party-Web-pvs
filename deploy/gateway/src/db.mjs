// SQLite account/device store via the built-in node:sqlite (zero external deps).
// Columns are snake_case on disk; results are mapped to camelCase for the rest of the app.
// LAN direct-access build: devices carry no public key (no request signing).
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  username     TEXT PRIMARY KEY,
  pwd_hash     TEXT NOT NULL,
  sub_url      TEXT NOT NULL,
  device_limit INTEGER NOT NULL DEFAULT 3,
  created      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  username     TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(username);
`

const mapUser = (r) =>
  r && {
    username: r.username,
    pwdHash: r.pwd_hash,
    subUrl: r.sub_url,
    deviceLimit: r.device_limit,
    created: r.created
  }

const mapDevice = (r) => r && { deviceId: r.device_id, username: r.username, created: r.created }

export function openDb(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)

  return {
    addUser({ username, pwdHash, subUrl, deviceLimit = 3 }) {
      db.prepare(
        'INSERT INTO users (username, pwd_hash, sub_url, device_limit, created) VALUES (?,?,?,?,?)'
      ).run(username, pwdHash, subUrl, deviceLimit, Date.now())
    },
    getUser(username) {
      return (
        mapUser(db.prepare('SELECT * FROM users WHERE username = ?').get(username)) || undefined
      )
    },
    setSub(username, subUrl) {
      db.prepare('UPDATE users SET sub_url = ? WHERE username = ?').run(subUrl, username)
    },
    setLimit(username, n) {
      db.prepare('UPDATE users SET device_limit = ? WHERE username = ?').run(n, username)
    },
    setPwd(username, pwdHash) {
      db.prepare('UPDATE users SET pwd_hash = ? WHERE username = ?').run(pwdHash, username)
    },
    delUser(username) {
      db.prepare('DELETE FROM users WHERE username = ?').run(username)
    },
    listUsers() {
      return db
        .prepare(
          `SELECT u.username, u.sub_url, u.device_limit, u.created,
                  (SELECT COUNT(*) FROM devices d WHERE d.username = u.username) AS device_count
           FROM users u ORDER BY u.created`
        )
        .all()
        .map((r) => ({
          username: r.username,
          subUrl: r.sub_url,
          deviceLimit: r.device_limit,
          created: r.created,
          deviceCount: r.device_count
        }))
    },
    upsertDevice({ deviceId, username }) {
      db.prepare(
        `INSERT INTO devices (device_id, username, created) VALUES (?,?,?)
         ON CONFLICT(device_id) DO UPDATE SET
           username = excluded.username, created = excluded.created`
      ).run(deviceId, username, Date.now())
    },
    getDevice(deviceId) {
      return (
        mapDevice(db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId)) ||
        undefined
      )
    },
    countDevices(username) {
      return db.prepare('SELECT COUNT(*) AS n FROM devices WHERE username = ?').get(username).n
    },
    delDevice(deviceId) {
      db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId)
    },
    listDevices(username) {
      return db
        .prepare('SELECT device_id, created FROM devices WHERE username = ? ORDER BY created')
        .all(username)
        .map((r) => ({ deviceId: r.device_id, created: r.created }))
    },
    close() {
      db.close()
    }
  }
}
