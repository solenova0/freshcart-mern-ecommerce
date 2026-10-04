import assert from 'node:assert/strict'
import { test } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { parseEnvironment } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'

const app = createApp({ nodeEnv: 'production', corsOrigins: ['http://localhost:5173', 'http://localhost:5174'] })

test('health works without an Origin and includes security headers', async () => {
  const response = await request(app).get('/api/health').expect(200)
  assert.deepEqual(response.body, { status: 'ok' })
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.headers['x-powered-by'], undefined)
})

test('allowlisted storefront and admin origins receive credentialed CORS headers', async () => {
  for (const origin of ['http://localhost:5173', 'http://localhost:5174']) {
    const response = await request(app).get('/api/health').set('Origin', origin).expect(200)
    assert.equal(response.headers['access-control-allow-origin'], origin)
    assert.equal(response.headers['access-control-allow-credentials'], 'true')
  }
})

test('preflight supports JSON requests', async () => {
  const response = await request(app).options('/api/health')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type').expect(204)
  assert.match(response.headers['access-control-allow-methods'], /POST/)
  assert.match(response.headers['access-control-allow-headers'], /content-type/)
})

test('unlisted origins are rejected without CORS headers', async () => {
  const response = await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(403)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
  assert.equal(response.body.error.message, 'Origin is not allowed by CORS')
  assert.equal(response.body.error.stack, undefined)
})

test('an empty allowlist rejects browser cross-origin requests', async () => {
  const closedApp = createApp({ nodeEnv: 'production', corsOrigins: [] })
  await request(closedApp).get('/api/health').set('Origin', 'http://localhost:5173').expect(403)
})

test('unknown routes and malformed JSON use the central error response', async () => {
  const missing = await request(app).get('/api/missing').expect(404)
  assert.equal(missing.body.error.message, 'Route not found: GET /api/missing')
  const malformed = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{').expect(400)
  assert.equal(typeof malformed.body.error.message, 'string')
  assert.equal(malformed.body.error.stack, undefined)
})

test('readiness reports an unavailable database', async () => {
  const response = await request(app).get('/api/ready').expect(503)
  assert.deepEqual(response.body, { status: 'not_ready' })
})

test('production hides unexpected error details', (context) => {
  context.mock.method(console, 'error', () => {})
  const req = { app: { get: () => 'production' } }
  const res = {
    headersSent: false,
    status(value) { assert.equal(value, 500); return this },
    json(body) { assert.deepEqual(body, { error: { message: 'Internal server error' } }) },
  }
  errorHandler(new Error('private database details'), req, res, () => assert.fail('Unexpected next'))
})

test('environment parser validates values and normalizes the allowlist', () => {
  const values = {
    MONGODB_URI: 'mongodb://127.0.0.1/freshcart',
    CORS_ORIGINS: ' http://localhost:5173, ,http://localhost:5173 ',
    JWT_SECRET: 'a-test-secret-with-at-least-32-bytes',
    BREVO_API_KEY: 'test-only-not-a-real-api-key',
    BREVO_SENDER_EMAIL: 'sender@example.com',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-key',
    CLOUDINARY_API_SECRET: 'test-secret',
  }
  const config = parseEnvironment(values)
  assert.deepEqual(config.corsOrigins, ['http://localhost:5173'])
  assert.equal(config.port, 5000)
  assert.throws(() => parseEnvironment({}), /MONGODB_URI/)
  assert.throws(() => parseEnvironment({ ...values, PORT: '5000abc' }), /PORT/)
  assert.throws(() => parseEnvironment({ ...values, NODE_ENV: 'invalid' }), /NODE_ENV/)
  assert.throws(() => parseEnvironment({ ...values, CORS_ORIGINS: '*' }))
  assert.throws(() => parseEnvironment({ ...values, CORS_ORIGINS: 'http://localhost:5173/' }), /CORS_ORIGINS/)
  assert.throws(() => parseEnvironment({ ...values, JWT_SECRET: 'short' }), /JWT_SECRET/)
  assert.throws(() => parseEnvironment({ ...values, JWT_TTL_SECONDS: 'invalid' }), /JWT_TTL_SECONDS/)
  assert.throws(() => parseEnvironment({ ...values, VERIFICATION_TOKEN_TTL_MINUTES: '0' }), /VERIFICATION_TOKEN_TTL_MINUTES/)
  assert.throws(() => parseEnvironment({ ...values, BREVO_API_KEY: '' }), /BREVO_API_KEY/)
  assert.throws(() => parseEnvironment({ ...values, BREVO_SENDER_EMAIL: 'invalid' }), /BREVO_SENDER_EMAIL/)
  assert.throws(() => parseEnvironment({ ...values, NODE_ENV: 'production' }), /HTTPS/)
  assert.throws(() => parseEnvironment({ ...values, CLOUDINARY_CLOUD_NAME: '' }), /CLOUDINARY_CLOUD_NAME/)
  assert.throws(() => parseEnvironment({ ...values, CLOUDINARY_API_KEY: '' }), /CLOUDINARY_API_KEY/)
  assert.throws(() => parseEnvironment({ ...values, CLOUDINARY_API_SECRET: '' }), /CLOUDINARY_API_SECRET/)
  assert.throws(() => parseEnvironment({ ...values, CLOUDINARY_FOLDER: '../other-cloud' }), /CLOUDINARY_FOLDER/)
})