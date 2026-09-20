import { describe, it, expect } from 'vitest'
import { challenge } from './gateway'

// The direct-access build no longer injects a guarded lookup, so a loopback/LAN
// gateway is now reachable from the real client (connection itself may fail,
// but not because of SSRF host filtering).
describe('gateway network access (real client, direct-access build)', () => {
  it('attempts a loopback gateway instead of refusing it (transient error allowed)', async () => {
    const target = {
      gateway: 'http://127.0.0.1:59999',
      endpoints: { enroll: '/e', challenge: '/c', config: '/cfg', revoke: '/r' }
    }
    // Nothing listens on :59999 — the request fails with a network error
    // ('transient'/'unreachable'), proving the guarded-lookup refusal is gone.
    await expect(challenge(target, 'DID', { timeout: 2000 })).rejects.toMatchObject({
      kind: expect.stringMatching(/^(transient|unreachable)$/)
    })
  })
})
