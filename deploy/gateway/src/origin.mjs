// Fetch a user's hidden subscription from the upstream origin. https-only (refuses
// downgrade-on-redirect), size- and time-bounded. The sub_url is admin-configured and
// trusted, so no private-IP ban here (an operator may keep the origin internal). `ca`
// lets the origin use a private CA.
import https from 'node:https'

export async function fetchSubscription(
  subUrl,
  { timeoutMs = 30000, maxBytes = 10 * 1024 * 1024, maxRedirects = 5, ca } = {}
) {
  let url = new URL(subUrl)
  for (let redirects = 0; ; redirects++) {
    if (url.protocol !== 'https:') throw new Error('subscription origin must be https')
    const res = await once(url, { timeoutMs, maxBytes, ca })
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (redirects >= maxRedirects) throw new Error('subscription origin: too many redirects')
      url = new URL(res.location, url)
      continue
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`subscription origin status ${res.status}`)
    }
    return res.body
  }
}

function once(url, { timeoutMs, maxBytes, ca }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: timeoutMs, ca }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        resolve({ status, location: res.headers.location })
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > maxBytes) {
          res.destroy()
          reject(new Error('subscription origin response too large'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf-8') }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('subscription fetch timed out')))
    req.on('error', reject)
    req.end()
  })
}
