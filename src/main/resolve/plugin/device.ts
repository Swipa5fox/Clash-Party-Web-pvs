import { randomUUID } from 'crypto'

// LAN direct-access build: no device key pair, no request signing.
// The device is identified solely by its random UUID.
export function generateDeviceId(): string {
  return randomUUID()
}
