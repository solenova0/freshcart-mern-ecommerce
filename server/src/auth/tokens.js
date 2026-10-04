import { createHash, randomBytes } from 'node:crypto'

export function hashVerificationToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createVerificationToken(ttlMinutes) {
  const token = randomBytes(32).toString('hex')
  return {
    token,
    tokenHash: hashVerificationToken(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60000),
  }
}