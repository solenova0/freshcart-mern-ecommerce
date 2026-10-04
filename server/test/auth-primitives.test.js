import assert from 'node:assert/strict'
import { test } from 'node:test'
import User from '../src/models/User.js'
import { createVerificationToken, hashVerificationToken } from '../src/auth/tokens.js'
import { loginSchema, registerSchema, verifyEmailSchema } from '../src/auth/validation.js'

test('verification tokens are random, stored as SHA-256 hashes, and expire', () => {
  const before = Date.now()
  const first = createVerificationToken(60)
  const second = createVerificationToken(60)
  assert.match(first.token, /^[a-f0-9]{64}$/)
  assert.notEqual(first.token, second.token)
  assert.notEqual(first.token, first.tokenHash)
  assert.equal(first.tokenHash, hashVerificationToken(first.token))
  assert.ok(first.expiresAt.getTime() >= before + 3600000)
  assert.ok(first.expiresAt.getTime() <= Date.now() + 3600000)
})

test('registration validation normalizes inputs and rejects privileged fields', () => {
  const values = { name: ' Customer ', email: ' CUSTOMER@EXAMPLE.COM ', password: 'password123' }
  const parsed = registerSchema.parse(values)
  assert.equal(parsed.name, 'Customer')
  assert.equal(parsed.email, 'customer@example.com')
  assert.equal(parsed.ageConfirmed, false)
  for (const field of ['role', 'isVerified', 'passwordHash', 'sessionVersion']) {
    assert.equal(registerSchema.safeParse({ ...values, [field]: 'admin' }).success, false)
  }
  assert.equal(registerSchema.safeParse({ ...values, ageConfirmed: 'true' }).success, false)
})

test('password validation rejects empty, weak-length and bcrypt-truncated UTF-8 inputs', () => {
  for (const password of ['', 'short', 'x'.repeat(73), '\u00e9'.repeat(37)]) {
    assert.equal(loginSchema.safeParse({ email: 'customer@example.com', password }).success, false)
  }
  assert.equal(loginSchema.safeParse({ email: 'customer@example.com', password: 'x'.repeat(72) }).success, true)
})

test('verification queries reject malformed tokens and extra parameters', () => {
  assert.equal(verifyEmailSchema.safeParse({ token: 'short' }).success, false)
  assert.equal(verifyEmailSchema.safeParse({ token: 'a'.repeat(64), extra: 'value' }).success, false)
  assert.equal(verifyEmailSchema.safeParse({ token: 'a'.repeat(64) }).success, true)
})

test('verification state and session versions are excluded from query selection and JSON', async () => {
  const verification = createVerificationToken(60)
  const user = new User({
    name: 'Customer', email: 'customer@example.com', passwordHash: 'hash',
    verificationTokenHash: verification.tokenHash,
    verificationTokenExpiresAt: verification.expiresAt,
    verificationEmailSentAt: new Date(),
  })
  await user.validate()
  assert.equal(user.sessionVersion, 0)
  for (const field of ['passwordHash', 'verificationTokenHash', 'verificationTokenExpiresAt', 'verificationEmailSentAt', 'sessionVersion']) {
    assert.equal(User.schema.path(field).options.select, false)
    assert.equal(user.toJSON()[field], undefined)
  }
  assert.ok(User.schema.indexes().some(([fields]) => fields.verificationTokenHash === 1))
})