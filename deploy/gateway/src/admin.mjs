// Admin command logic, decoupled from I/O so it is testable. The bin wrapper
// (../admin.mjs) supplies a real db, a no-echo password reader, and console writers.
import { hashPassword } from './crypto.mjs'

const USAGE = `Usage: cpx-admin <command> ...
  add-user <username> <subUrl> [--limit N]
  set-sub <username> <subUrl>
  passwd <username>
  set-limit <username> <N>
  del-user <username>
  list-users [--show-sub]
  list-devices <username>
  revoke-device <deviceId>`

function parse(rest) {
  const pos = []
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]
    if (t === '--limit') flags.limit = rest[++i]
    else if (t === '--show-sub') flags.showSub = true
    else if (t.startsWith('--')) flags[t.slice(2)] = true
    else pos.push(t)
  }
  return { pos, flags }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return '(invalid url)'
  }
}

export async function runAdmin(args, deps) {
  const { db, readPassword, out, err } = deps
  const defaultLimit = deps.deviceLimitDefault ?? 3
  const [cmd, ...rest] = args
  const { pos, flags } = parse(rest)
  const need = (ok, msg) => {
    if (!ok) err(msg)
    return ok
  }
  const requireUser = (name) => {
    if (db.getUser(name)) return true
    err(`user "${name}" not found`)
    return false
  }

  switch (cmd) {
    case 'add-user': {
      const [username, subUrl] = pos
      if (!need(username && subUrl, 'add-user requires <username> <subUrl>')) return 1
      if (db.getUser(username)) {
        err(`user "${username}" already exists`)
        return 1
      }
      const password = await readPassword('Password: ')
      if (!need(password, 'empty password')) return 1
      const deviceLimit = flags.limit ? Number(flags.limit) : defaultLimit
      db.addUser({ username, pwdHash: hashPassword(password), subUrl, deviceLimit })
      out(`added user "${username}" (device limit ${deviceLimit})`)
      return 0
    }
    case 'set-sub': {
      const [username, subUrl] = pos
      if (!need(username && subUrl, 'set-sub requires <username> <subUrl>')) return 1
      if (!requireUser(username)) return 1
      db.setSub(username, subUrl)
      out(`updated subscription for "${username}"`)
      return 0
    }
    case 'set-limit': {
      const [username, n] = pos
      if (!need(username && n, 'set-limit requires <username> <N>')) return 1
      if (!requireUser(username)) return 1
      db.setLimit(username, Number(n))
      out(`set device limit ${Number(n)} for "${username}"`)
      return 0
    }
    case 'passwd': {
      const [username] = pos
      if (!need(username, 'passwd requires <username>')) return 1
      if (!requireUser(username)) return 1
      const password = await readPassword('Password: ')
      if (!need(password, 'empty password')) return 1
      db.setPwd(username, hashPassword(password))
      out(`changed password for "${username}"`)
      return 0
    }
    case 'del-user': {
      const [username] = pos
      if (!need(username, 'del-user requires <username>')) return 1
      if (!requireUser(username)) return 1
      db.delUser(username)
      out(`deleted user "${username}" and its devices`)
      return 0
    }
    case 'list-users': {
      for (const u of db.listUsers()) {
        const sub = flags.showSub ? u.subUrl : hostOf(u.subUrl)
        out(
          `${u.username}\tdevices=${u.deviceCount}/${u.deviceLimit}\t${sub}\t${new Date(u.created).toISOString()}`
        )
      }
      return 0
    }
    case 'list-devices': {
      const [username] = pos
      if (!need(username, 'list-devices requires <username>')) return 1
      if (!requireUser(username)) return 1
      for (const d of db.listDevices(username)) {
        out(`${d.deviceId}\t${new Date(d.created).toISOString()}`)
      }
      return 0
    }
    case 'revoke-device': {
      const [deviceId] = pos
      if (!need(deviceId, 'revoke-device requires <deviceId>')) return 1
      db.delDevice(deviceId)
      out(`revoked device ${deviceId}`)
      return 0
    }
    default:
      err(USAGE)
      return 1
  }
}
