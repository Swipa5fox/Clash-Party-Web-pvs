import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readBody, parseForm, parseJson, clientIp, sendJson } from './http.mjs'

test('parseForm decodes url-encoded fields', () => {
  const o = parseForm('username=a%40b&password=p+q&state=xyz')
  assert.deepEqual(o, { username: 'a@b', password: 'p q', state: 'xyz' })
})

test('parseJson returns the object or undefined on bad input', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 })
  assert.equal(parseJson('{nope'), undefined)
  assert.equal(parseJson('"scalar"'), undefined) // non-object
})

test('readBody returns the body under the cap', async () => {
  const req = Readable.from([Buffer.from('hello '), Buffer.from('world')])
  assert.equal(await readBody(req, 1024), 'hello world')
})

test('readBody rejects a body over the cap', async () => {
  const req = Readable.from([Buffer.from('x'.repeat(100))])
  await assert.rejects(readBody(req, 10), /too large/)
})

test('clientIp prefers the first X-Forwarded-For entry, else the socket', () => {
  assert.equal(
    clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: {} }),
    '9.9.9.9'
  )
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '1.2.3.4' } }), '1.2.3.4')
})

test('sendJson writes status, json content-type, and the serialized body', () => {
  const res = mockRes()
  sendJson(res, 403, { error: 'x' })
  assert.equal(res.status, 403)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.deepEqual(JSON.parse(res.body), { error: 'x' })
})

function mockRes() {
  const r = { status: 0, headers: {}, body: '' }
  r.writeHead = (s, h) => {
    r.status = s
    r.headers = h || {}
    return r
  }
  r.end = (b) => {
    r.body = b ?? ''
  }
  return r
}
