import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionCookieOptions } from '../src/auth/session.js'
import { assertPurchasable } from '../src/commerce/rules.js'
import Order from '../src/models/Order.js'
import Product from '../src/models/Product.js'
import mongoose from 'mongoose'
import Stripe from 'stripe'
import request from 'supertest'
import { createPaymentService } from '../src/services/payments.js'
import { createApp } from '../src/app.js'
import { adminSeedValues } from '../src/scripts/seed-admin.js'

test('Stripe reservations are unavailable to other purchases', () => {
  const product = { name: 'Apples', stock: 5, reservedStock: 4, productType: 'grocery' }
  assert.doesNotThrow(() => assertPurchasable(product, 1, {}))
  assert.throws(() => assertPurchasable(product, 2, {}), /Insufficient stock/)
})

test('cross-site cookies remain secure, httpOnly, host-only, and scoped', () => {
  assert.deepEqual(sessionCookieOptions({ nodeEnv: 'production', cookieSameSite: 'none' }), {
    secure: true, httpOnly: true, sameSite: 'none', path: '/api',
  })
})

test('Stripe session identifiers have a sparse unique index', () => {
  assert.ok(Order.schema.indexes().some(([fields, options]) => fields.stripeSessionId === 1 && options.unique && options.sparse))
})

test('production administrator provisioning rejects published demo credentials and absent secrets', () => {
  assert.equal(adminSeedValues({}).email, 'admin@freshcart.test')
  assert.throws(() => adminSeedValues({ NODE_ENV: 'production' }))
  assert.throws(() => adminSeedValues({ NODE_ENV: 'production', DEMO_ADMIN_EMAIL: 'admin@freshcart.test', DEMO_ADMIN_PASSWORD: 'a-unique-long-private-password' }))
  assert.equal(adminSeedValues({ NODE_ENV: 'production', DEMO_ADMIN_EMAIL: 'owner@example.com', DEMO_ADMIN_PASSWORD: 'a-unique-long-private-password' }).email, 'owner@example.com')
})

test('cross-site cookie mutation protection requires an explicit allowlisted origin', async () => {
  const config = { nodeEnv: 'production', cookieSameSite: 'none', corsOrigins: ['https://shop.example.com'] }
  const app = createApp(config)
  await request(app).post('/api/auth/login').send({}).expect(403)
  await request(app).post('/api/auth/login').set('Origin', 'https://shop.example.com').send({}).expect(400)
  await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({}).expect(403)
})

function fixture() {
  const config = {
    nodeEnv: 'test', corsOrigins: [], stripeSecretKey: 'sk_test_fake',
    stripeWebhookSecret: 'whsec_test_signature', storefrontUrl: 'http://localhost:5173',
  }
  const product = new Product({ name: 'Apples', price: 5, stock: 10, category: new mongoose.Types.ObjectId(), __v: 0 })
  const order = new Order({
    user: new mongoose.Types.ObjectId(), paymentMethod: 'stripe', total: 10, __v: 0,
    address: { fullName: 'Customer', line1: 'Market Road', city: 'Addis Ababa', country: 'ET' },
    items: [{ product: product._id, name: 'Apples', price: 5, quantity: 2, productType: 'grocery' }],
  })
  const state = { product: JSON.parse(JSON.stringify(product.toObject())), order: JSON.parse(JSON.stringify(order.toObject())), createCalls: 0 }
  const checkout = {
    id: 'cs_test_example', status: 'open', url: 'https://checkout.stripe.com/test',
    metadata: { orderId: order.id }, client_reference_id: order.user.toString(),
    currency: 'usd', amount_total: 1000, payment_status: 'paid',
  }
  function query(read) {
    return {
      session() { return this },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (!read()) return null
          const doc = new Order(state.order)
          doc.save = async () => { await doc.validate(); state.order = JSON.parse(JSON.stringify(doc.toObject())); return doc }
          return doc
        }).then(resolve, reject)
      },
    }
  }
  const dependencies = {
    OrderModel: {
      findById(id) { return query(() => id.toString() === order.id) },
      findOne(filter) { return query(() => filter._id.toString() === order.id && filter.user.toString() === order.user.toString()) },
    },
    ProductModel: {
      findById() { return { session: async () => new Product(state.product) } },
      async updateOne(filter, update) {
        for (const [field, value] of Object.entries(filter)) {
          if (field === '_id') continue
          if (typeof value === 'object' ? state.product[field] < value.$gte : state.product[field] !== value) return { modifiedCount: 0 }
        }
        for (const [field, amount] of Object.entries(update.$inc)) state.product[field] += amount
        return { modifiedCount: 1 }
      },
    },
    async runTransaction(operation) {
      const before = { product: structuredClone(state.product), order: structuredClone(state.order) }
      try { return await operation({}) }
      catch (error) { state.product = before.product; state.order = before.order; throw error }
    },
    stripeClient: {
      webhooks: new Stripe('sk_test_fake').webhooks,
      checkout: { sessions: {
        async create(parameters, options) {
          state.createCalls += 1
          assert.equal(options.idempotencyKey, `freshcart-order-${order.id}`)
          assert.equal(parameters.line_items[0].price_data.unit_amount, 500)
          return checkout
        },
        async retrieve() { return checkout },
        async expire() { checkout.status = 'expired'; return checkout },
      } },
    },
  }
  return { config, state, checkout, dependencies, service: createPaymentService(config, dependencies), order }
}

test('Stripe session creation is owned, idempotent, and reserves stock without deducting it', async () => {
  const data = fixture()
  await assert.rejects(data.service.createSession(data.order.id, new mongoose.Types.ObjectId()), { status: 404 })
  const first = await data.service.createSession(data.order.id, data.order.user)
  const second = await data.service.createSession(data.order.id, data.order.user)
  assert.equal(first.url, second.url)
  assert.equal(data.state.createCalls, 1)
  assert.equal(data.state.product.stock, 10)
  assert.equal(data.state.product.reservedStock, 2)
})

test('signed raw-body completion deducts stock once; duplicate and out-of-order expiry are harmless', async () => {
  const data = fixture()
  await data.service.createSession(data.order.id, data.order.user)
  const app = createApp(data.config, data.dependencies)
  const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed', data: { object: data.checkout } })
  const signature = data.dependencies.stripeClient.webhooks.generateTestHeaderString({ payload, secret: data.config.stripeWebhookSecret })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200)
  }
  assert.equal(data.state.product.stock, 8)
  assert.equal(data.state.product.reservedStock, 0)
  assert.equal(data.state.order.paymentStatus, 'paid')
  await data.service.processSession(data.checkout, false)
  assert.equal(data.state.order.paymentStatus, 'paid')
  assert.equal(data.state.product.stock, 8)
})

test('expired/cancelled sessions release stock exactly once, without deducting it', async () => {
  const data = fixture()
  await data.service.createSession(data.order.id, data.order.user)
  await data.service.cancel(data.order.id, data.order.user)
  await data.service.processSession(data.checkout, false)
  assert.equal(data.state.product.stock, 10)
  assert.equal(data.state.product.reservedStock, 0)
  assert.equal(data.state.order.orderStatus, 'cancelled')
})

test('webhooks reject invalid signatures and payment amount/session mismatches', async () => {
  const data = fixture()
  await data.service.createSession(data.order.id, data.order.user)
  await request(createApp(data.config, data.dependencies)).post('/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', 'bad').send('{}').expect(400)
  await assert.rejects(data.service.processSession({ ...data.checkout, amount_total: 1 }, true), { status: 400 })
  await assert.rejects(data.service.processSession({ ...data.checkout, id: 'cs_wrong' }, true), { status: 400 })
  assert.equal(data.state.product.stock, 10)
  assert.equal(data.state.order.paymentStatus, 'pending')
})