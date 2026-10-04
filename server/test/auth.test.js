import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import User from '../src/models/User.js'
import { createApp } from '../src/app.js'
import { hashVerificationToken } from '../src/auth/tokens.js'
import { signSession } from '../src/auth/session.js'
import { requireAdmin, requireAuth } from '../src/middleware/auth.js'
import { createVerificationMailer } from '../src/services/brevo.js'

const config = {
  nodeEnv: 'test', corsOrigins: ['http://localhost:5173'],
  jwtSecret: 'a-test-secret-with-at-least-32-bytes', jwtTtlSeconds: 3600,
  verificationTtlMinutes: 60, apiPublicUrl: 'http://localhost:5000',
  brevoApiKey: 'test-key', brevoSenderEmail: 'sender@example.com', brevoSenderName: 'FreshCart',
}
const credentials = { name: 'Customer', email: 'customer@example.com', password: 'password123' }
let passwordHash
before(async () => { passwordHash = await bcrypt.hash(credentials.password, 12) })

function fixture({ nodeEnv = 'test', mailFailure = false } = {}) {
  const users = new Map()
  const emails = []

  function matches(user, filter) {
    if (filter._id && user._id.toString() !== filter._id.toString()) return false
    if (filter.email && user.email !== filter.email) return false
    if (filter.isVerified !== undefined && user.isVerified !== filter.isVerified) return false
    if (filter.sessionVersion !== undefined && user.sessionVersion !== filter.sessionVersion) return false
    if (filter.verificationTokenHash && user.verificationTokenHash !== filter.verificationTokenHash) return false
    if (filter.verificationTokenExpiresAt && !(user.verificationTokenExpiresAt > filter.verificationTokenExpiresAt.$gt)) return false
    if (filter.$or && user.verificationEmailSentAt && user.verificationEmailSentAt > filter.$or[2].verificationEmailSentAt.$lte) return false
    return true
  }

  function update(user, changes) {
    for (const [field, value] of Object.entries(changes.$set || {})) user.set(field, value)
    for (const field of Object.keys(changes.$unset || {})) user.set(field, undefined)
    for (const [field, value] of Object.entries(changes.$inc || {})) user.set(field, user[field] + value)
    return user
  }

  const UserModel = {
    async create(values) {
      if ([...users.values()].some((user) => user.email === values.email)) {
        const error = new Error('Duplicate email')
        error.code = 11000
        throw error
      }
      const user = new User(values)
      await user.validate()
      users.set(user._id.toString(), user)
      return user
    },
    findOne(filter) { return { select: async () => [...users.values()].find((user) => matches(user, filter)) || null } },
    findById(id) { return { select: async () => users.get(id.toString()) || null } },
    async findOneAndUpdate(filter, changes, options) {
      assert.equal(options.new, true)
      assert.equal(options.runValidators, true)
      const user = [...users.values()].find((user) => matches(user, filter))
      return user ? update(user, changes) : null
    },
    async updateOne(filter, changes) {
      const user = [...users.values()].find((user) => matches(user, filter))
      if (user) update(user, changes)
      return { modifiedCount: user ? 1 : 0 }
    },
  }
  const app = createApp({ ...config, nodeEnv }, {
    UserModel,
    async sendVerificationEmail(message) {
      if (mailFailure) {
        const error = new Error('Email unavailable')
        error.status = 503
        throw error
      }
      emails.push(message)
    },
  })
  return { app, users, emails, UserModel }
}

async function seed(fixture, values = {}) {
  return fixture.UserModel.create({ name: credentials.name, email: credentials.email, passwordHash, isVerified: true, ...values })
}

function cookieFrom(response) {
  return response.headers['set-cookie'][0].split(';')[0]
}

test('register hashes passwords and verification tokens, sends email, and does not issue a session', async () => {
  const state = fixture()
  const response = await request(state.app).post('/api/auth/register').send(credentials).expect(202)
  const user = [...state.users.values()][0]
  assert.match(user.passwordHash, /^\$2b\$12\$/)
  assert.equal(await bcrypt.compare(credentials.password, user.passwordHash), true)
  assert.equal(user.isVerified, false)
  assert.equal(user.role, 'user')
  assert.equal(state.emails.length, 1)
  assert.equal(user.verificationTokenHash, hashVerificationToken(state.emails[0].token))
  assert.notEqual(user.verificationTokenHash, state.emails[0].token)
  assert.ok(user.verificationTokenExpiresAt > new Date())
  assert.equal(response.headers['set-cookie'], undefined)
  assert.deepEqual(Object.keys(response.body), ['message'])
  const duplicate = await request(state.app).post('/api/auth/register').send(credentials).expect(202)
  assert.deepEqual(duplicate.body, response.body)
  assert.equal(state.emails.length, 1)
})

test('Zod rejects privileged fields, bad email, missing fields, and overlong UTF-8 passwords', async () => {
  const state = fixture()
  for (const values of [{ role: 'admin' }, { isVerified: true }, { email: 'invalid' }, { password: '\u00e9'.repeat(37) }, { name: '' }]) {
    const response = await request(state.app).post('/api/auth/register').send({ ...credentials, ...values }).expect(400)
    assert.equal(response.body.error.message, 'Invalid request')
    assert.ok(response.body.error.issues.length > 0)
  }
  assert.equal(state.users.size, 0)
  await request(state.app).post('/api/auth/login').send({ email: credentials.email }).expect(400)
})

test('verification consumes a valid token once and allows login', async () => {
  const state = fixture()
  await request(state.app).post('/api/auth/register').send(credentials).expect(202)
  const token = state.emails[0].token
  await request(state.app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(403)
  await request(state.app).get('/api/auth/verify-email').query({ token }).expect(200)
  const user = [...state.users.values()][0]
  assert.equal(user.isVerified, true)
  assert.equal(user.verificationTokenHash, undefined)
  assert.equal(user.verificationTokenExpiresAt, undefined)
  await request(state.app).get('/api/auth/verify-email').query({ token }).expect(400)
  await request(state.app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200)
})

test('malformed, unknown, and expired verification links cannot verify an account', async () => {
  const state = fixture()
  const token = 'a'.repeat(64)
  const user = await seed(state, { isVerified: false, verificationTokenHash: hashVerificationToken(token), verificationTokenExpiresAt: new Date(Date.now() - 1) })
  await request(state.app).get('/api/auth/verify-email').query({ token: 'invalid' }).expect(400)
  await request(state.app).get('/api/auth/verify-email').query({ token: 'b'.repeat(64) }).expect(400)
  await request(state.app).get('/api/auth/verify-email').query({ token }).expect(400)
  assert.equal(user.isVerified, false)
})

test('concurrent verification attempts can consume the same token only once', async () => {
  const state = fixture()
  const token = 'a'.repeat(64)
  await seed(state, {
    isVerified: false, verificationTokenHash: hashVerificationToken(token),
    verificationTokenExpiresAt: new Date(Date.now() + 60000),
  })
  const responses = await Promise.all([
    request(state.app).get('/api/auth/verify-email').query({ token }),
    request(state.app).get('/api/auth/verify-email').query({ token }),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400])
})

test('login sets an httpOnly JWT cookie; me is sanitized; logout revokes copied tokens', async () => {
  const state = fixture()
  const user = await seed(state)
  const response = await request(state.app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200)
  const cookie = cookieFrom(response)
  assert.match(response.headers['set-cookie'][0], /HttpOnly/)
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/)
  assert.match(response.headers['set-cookie'][0], /Path=\/api/)
  assert.match(response.headers['set-cookie'][0], /Max-Age=3600/)
  assert.doesNotMatch(response.headers['set-cookie'][0], /Domain=/)
  assert.equal(response.body.token, undefined)
  assert.equal(response.body.user.passwordHash, undefined)
  assert.equal(response.body.user.sessionVersion, undefined)
  const me = await request(state.app).get('/api/auth/me').set('Cookie', cookie).expect(200)
  assert.equal(me.body.user.id, user._id.toString())
  assert.equal(me.headers['cache-control'], 'no-store')
  const loggedOut = await request(state.app).post('/api/auth/logout').set('Cookie', cookie).expect(204)
  assert.match(loggedOut.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/)
  assert.equal(user.sessionVersion, 1)
  await request(state.app).get('/api/auth/me').set('Cookie', cookie).expect(401)
})

test('production cookies are Secure and credentials fail without revealing whether an email exists', async () => {
  const state = fixture({ nodeEnv: 'production' })
  await seed(state)
  const valid = await request(state.app).post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200)
  assert.match(valid.headers['set-cookie'][0], /; Secure;/)
  const wrong = await request(state.app).post('/api/auth/login').send({ email: credentials.email, password: 'wrongpassword' }).expect(401)
  const absent = await request(state.app).post('/api/auth/login').send({ email: 'absent@example.com', password: 'wrongpassword' }).expect(401)
  assert.deepEqual(wrong.body, absent.body)
})

test('requireAuth rejects missing, tampered, expired, and wrong-audience sessions', async () => {
  const state = fixture()
  const user = await seed(state)
  await request(state.app).get('/api/auth/me').expect(401)
  const expired = jwt.sign({ version: 0 }, config.jwtSecret, { subject: user._id.toString(), issuer: 'freshcart-api', audience: 'freshcart-user', expiresIn: -1 })
  const wrongAudience = jwt.sign({ version: 0 }, config.jwtSecret, { subject: user._id.toString(), issuer: 'freshcart-api', audience: 'another-app', expiresIn: 60 })
  const wrongIssuer = jwt.sign({ version: 0 }, config.jwtSecret, { subject: user._id.toString(), issuer: 'another-api', audience: 'freshcart-user', expiresIn: 60 })
  const wrongAlgorithm = jwt.sign({ version: 0 }, config.jwtSecret, { algorithm: 'HS384', subject: user._id.toString(), issuer: 'freshcart-api', audience: 'freshcart-user', expiresIn: 60 })
  const missingVersion = jwt.sign({}, config.jwtSecret, { subject: user._id.toString(), issuer: 'freshcart-api', audience: 'freshcart-user', expiresIn: 60 })
  for (const token of ['tampered-token', expired, wrongAudience, wrongIssuer, wrongAlgorithm, missingVersion]) {
    await request(state.app).get('/api/auth/me').set('Cookie', `freshcart_session=${token}`).expect(401)
  }
  const cookie = `freshcart_session=${signSession(user, config)}`
  user.isVerified = false
  await request(state.app).get('/api/auth/me').set('Cookie', cookie).expect(403)
  state.users.delete(user._id.toString())
  await request(state.app).get('/api/auth/me').set('Cookie', cookie).expect(401)
})

test('requireAdmin uses current database roles rather than trusting the JWT', async () => {
  const state = fixture()
  const user = await seed(state)
  const adminApp = express()
  adminApp.locals.auth = { config, UserModel: state.UserModel }
  adminApp.use(cookieParser())
  adminApp.get('/api/admin/check', requireAuth, requireAdmin, (_req, res) => res.json({ allowed: true }))
  const cookie = `freshcart_session=${signSession(user, config)}`
  await request(adminApp).get('/api/admin/check').expect(401)
  await request(adminApp).get('/api/admin/check').set('Cookie', cookie).expect(403)
  user.role = 'admin'
  await request(adminApp).get('/api/admin/check').set('Cookie', cookie).expect(200)
  user.role = 'user'
  await request(adminApp).get('/api/admin/check').set('Cookie', cookie).expect(403)
})

test('resend rotates eligible tokens, invalidates old links, and enforces a cooldown', async () => {
  const state = fixture()
  const oldToken = 'a'.repeat(64)
  const user = await seed(state, {
    isVerified: false, verificationTokenHash: hashVerificationToken(oldToken),
    verificationTokenExpiresAt: new Date(Date.now() + 60000), verificationEmailSentAt: new Date(Date.now() - 61000),
  })
  const response = await request(state.app).post('/api/auth/resend-verification').send({ email: credentials.email }).expect(202)
  assert.equal(state.emails.length, 1)
  assert.equal(user.verificationTokenHash, hashVerificationToken(state.emails[0].token))
  await request(state.app).get('/api/auth/verify-email').query({ token: oldToken }).expect(400)
  await request(state.app).post('/api/auth/resend-verification').send({ email: credentials.email }).expect(202)
  assert.equal(state.emails.length, 1)
  const unknown = await request(state.app).post('/api/auth/resend-verification').send({ email: 'unknown@example.com' }).expect(202)
  assert.deepEqual(unknown.body, response.body)
  user.isVerified = true
  await request(state.app).post('/api/auth/resend-verification').send({ email: credentials.email }).expect(202)
  assert.equal(state.emails.length, 1)
})

test('delivery failures invalidate the failed token and allow immediate retry', async (context) => {
  context.mock.method(console, 'error', () => {})
  const state = fixture({ mailFailure: true })
  await request(state.app).post('/api/auth/register').send(credentials).expect(503)
  const user = [...state.users.values()][0]
  assert.equal(user.isVerified, false)
  assert.equal(user.verificationTokenHash, undefined)
  assert.equal(user.verificationEmailSentAt, undefined)
  const retryApp = createApp(config, {
    UserModel: state.UserModel,
    async sendVerificationEmail(message) { state.emails.push(message) },
  })
  await request(retryApp).post('/api/auth/resend-verification').send({ email: credentials.email }).expect(202)
  assert.equal(state.emails.length, 1)
  assert.equal(user.verificationTokenHash, hashVerificationToken(state.emails[0].token))
})

test('per-route rate limits return consistent 429 errors and retry headers', async () => {
  const state = fixture()
  for (let attempt = 0; attempt < 5; attempt += 1) await request(state.app).post('/api/auth/register').send({}).expect(400)
  const response = await request(state.app).post('/api/auth/register').send({}).expect(429)
  assert.equal(response.body.error.message, 'Too many requests. Please try again later.')
  assert.ok(response.headers['retry-after'])
  assert.ok(response.headers.ratelimit)
})

test('cross-site mutations are rejected while configured origins are accepted', async () => {
  const state = fixture()
  await request(state.app).post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site').expect(403)
  await request(state.app).post('/api/auth/logout').set('Origin', 'https://untrusted.example').expect(403)
  await request(state.app).post('/api/auth/login').set('Origin', config.corsOrigins[0]).send({}).expect(400)
})

test('Brevo transactional request contains a token link and verified sender settings', async () => {
  let sent
  const mailer = createVerificationMailer(config, async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) }
    return { ok: true }
  })
  await mailer({ email: credentials.email, name: credentials.name, token: 'a'.repeat(64) })
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email')
  assert.equal(sent.options.method, 'POST')
  assert.equal(sent.options.headers['api-key'], config.brevoApiKey)
  assert.deepEqual(sent.body.sender, { name: 'FreshCart', email: config.brevoSenderEmail })
  assert.equal(sent.body.to[0].email, credentials.email)
  assert.ok(sent.body.textContent.includes(`http://localhost:5000/api/auth/verify-email?token=${'a'.repeat(64)}`))
  assert.ok(sent.options.signal instanceof AbortSignal)
})

test('Brevo provider failures and timeouts become safe service errors', async () => {
  const recipient = { email: credentials.email, name: credentials.name, token: 'a'.repeat(64) }
  for (const send of [async () => ({ ok: false }), async () => { throw new Error('private provider details') }]) {
    await assert.rejects(createVerificationMailer(config, send)(recipient), {
      message: 'Verification email delivery is temporarily unavailable', status: 503,
    })
  }
})