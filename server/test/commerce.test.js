import assert from 'node:assert/strict'
import { test } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import User from '../src/models/User.js'
import Product from '../src/models/Product.js'
import Cart from '../src/models/Cart.js'
import Order from '../src/models/Order.js'
import { signSession } from '../src/auth/session.js'

const shippingAddress = { fullName: 'Customer', line1: '12 Market Road', city: 'Addis Ababa', country: 'ET' }

function fixture({ role = 'user', ageConfirmed = false } = {}) {
  const state = { conflict: false, events: [], failOrder: false, lastOrderFilter: undefined }
  const config = { nodeEnv: 'test', corsOrigins: ['http://localhost:5173'], jwtSecret: 'a-test-secret-with-at-least-32-bytes', jwtTtlSeconds: 3600 }

  function matches(record, filter) {
    return Object.entries(filter).every(([field, value]) => {
      if (value && typeof value === 'object' && '$in' in value) return value.$in.some((entry) => String(entry) === String(record[field]))
      if (value && typeof value === 'object' && '$gte' in value) return record[field] >= value.$gte
      return String(record[field]) === String(value)
    })
  }

  function adapter(Model) {
    const records = new Map()
    function update(record, changes) {
      for (const [field, value] of Object.entries(changes.$set || {})) record[field] = value
      for (const [field, value] of Object.entries(changes.$inc || {})) record[field] = (record[field] || 0) + value
    }
    function doc(record) {
      if (!record) return null
      const document = new Model(record)
      document.save = async () => {
        const previous = records.get(document.id)
        if (state.conflict) { previous.__v += 1; state.conflict = false }
        if (document.__v !== previous.__v) throw new mongoose.Error.VersionError(document, previous.__v, ['items'])
        await document.validate()
        document.__v += 1
        records.set(document.id, JSON.parse(JSON.stringify(document.toObject())))
        state.events.push(`save:${Model.modelName}`)
        return document
      }
      return document
    }
    function query(read, isList = false) {
      let sorting
      let offset = 0
      let count = Infinity
      return {
        select() { return this }, session() { return this },
        sort(value) { sorting = value; return this },
        skip(value) { offset = value; return this },
        limit(value) { count = value; return this },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            let records = read()
            if (!isList) return doc(records)
            if (sorting) records = records.sort((first, second) => {
              for (const [field, direction] of Object.entries(sorting)) {
                const comparison = first[field] > second[field] ? 1 : first[field] < second[field] ? -1 : 0
                if (comparison) return comparison * direction
              }
              return 0
            })
            return records.slice(offset, offset + count).map(doc)
          }).then(resolve, reject)
        },
      }
    }
    return {
      records,
      async create(values) {
        if (Model === Order && state.failOrder) throw new Error('Order persistence failed')
        if (Array.isArray(values)) return Promise.all(values.map((entry) => this.create(entry)))
        const document = new Model({ ...values, __v: 0, createdAt: new Date(), updatedAt: new Date() })
        await document.validate()
        records.set(document.id, JSON.parse(JSON.stringify(document.toObject())))
        return doc(records.get(document.id))
      },
      find(filter = {}) {
        if (Model === Order) state.lastOrderFilter = filter
        return query(() => [...records.values()].filter((record) => matches(record, filter)), true)
      },
      findById(id) { return query(() => records.get(id.toString())) },
      findOne(filter) { return query(() => [...records.values()].find((record) => matches(record, filter))) },
      async findOneAndUpdate(filter, changes, options) {
        assert.equal(options.new, true)
        assert.equal(options.runValidators, true)
        let record = [...records.values()].find((entry) => matches(entry, filter))
        if (!record && options.upsert) {
          const created = await this.create(changes.$setOnInsert)
          record = records.get(created.id)
        }
        if (!record) return null
        update(record, changes)
        await new Model(record).validate()
        return doc(record)
      },
      async updateOne(filter, changes) {
        const record = [...records.values()].find((entry) => matches(entry, filter))
        if (!record) return { modifiedCount: 0 }
        update(record, changes)
        return { modifiedCount: 1 }
      },
      async countDocuments(filter) { return [...records.values()].filter((record) => matches(record, filter)).length },
    }
  }

  state.UserModel = adapter(User)
  state.ProductModel = adapter(Product)
  state.CartModel = adapter(Cart)
  state.OrderModel = adapter(Order)
  state.user = new User({ name: 'Customer', email: 'customer@example.com', passwordHash: 'hash', role, ageConfirmed, isVerified: true, address: shippingAddress, __v: 0 })
  state.UserModel.records.set(state.user.id, JSON.parse(JSON.stringify(state.user.toObject())))
  state.cookie = `freshcart_session=${signSession(state.user, config)}`
  state.runTransaction = async (operation) => {
    const models = [state.UserModel, state.ProductModel, state.CartModel, state.OrderModel]
    const snapshots = models.map((model) => structuredClone([...model.records.entries()]))
    state.events.push('transaction:start')
    try {
      const result = await operation({ marker: 'test-session' })
      state.events.push('transaction:commit')
      return result
    } catch (error) {
      models.forEach((model, index) => {
        model.records.clear()
        for (const [key, value] of snapshots[index]) model.records.set(key, value)
      })
      state.events.push('transaction:rollback')
      throw error
    }
  }
  state.app = createApp(config, state)
  return state
}

async function product(state, values = {}) {
  return state.ProductModel.create({ name: 'Apples', price: 2.5, stock: 10, category: new mongoose.Types.ObjectId(), ...values })
}

async function addToCart(state, productId, quantity = 1) {
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId, quantity }).expect(200)
}

test('all cart and address endpoints require authentication and reject cross-site mutations', async () => {
  const state = fixture()
  for (const [method, path] of [
    ['get', '/api/cart'], ['post', '/api/cart/items'], ['patch', `/api/cart/items/${'a'.repeat(24)}`],
    ['delete', `/api/cart/items/${'a'.repeat(24)}`], ['delete', '/api/cart'], ['put', '/api/users/me/address'],
  ]) await request(state.app)[method](path).expect(401)
  await request(state.app).delete('/api/cart').set('Cookie', state.cookie).set('Sec-Fetch-Site', 'cross-site').expect(403)
})

test('cart supports get, incrementing add, exact quantity update, remove, and idempotent clear', async () => {
  const state = fixture()
  const item = await product(state)
  const empty = await request(state.app).get('/api/cart').set('Cookie', state.cookie).expect(200)
  assert.deepEqual(empty.body.cart, { id: null, items: [], total: 0 })
  const path = `/api/cart/items/${item.id}`
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id, quantity: 2 }).expect(200)
  const added = await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id }).expect(200)
  assert.equal(added.body.cart.items.length, 1)
  assert.equal(added.body.cart.items[0].quantity, 3)
  assert.equal(added.body.cart.total, 7.5)
  const changed = await request(state.app).patch(path).set('Cookie', state.cookie).send({ quantity: 1 }).expect(200)
  assert.equal(changed.body.cart.total, 2.5)
  const removed = await request(state.app).delete(path).set('Cookie', state.cookie).expect(200)
  assert.deepEqual(removed.body.cart.items, [])
  await request(state.app).delete(path).set('Cookie', state.cookie).expect(404)
  await request(state.app).delete('/api/cart').set('Cookie', state.cookie).expect(200)
  await request(state.app).delete('/api/cart').set('Cookie', state.cookie).expect(200)
  assert.equal(state.ProductModel.records.get(item.id).stock, 10)
})

test('cart rechecks stock/age, rejects invalid quantities and stale writes, and reports deleted products', async () => {
  const state = fixture()
  const item = await product(state, { stock: 2 })
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id, quantity: 3 }).expect(409)
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id, quantity: 0 }).expect(400)
  const hookah = await product(state, { productType: 'hookah' })
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: hookah.id }).expect(403)
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id }).expect(200)
  state.conflict = true
  await request(state.app).patch(`/api/cart/items/${item.id}`).set('Cookie', state.cookie).send({ quantity: 2 }).expect(409)
  state.ProductModel.records.delete(item.id)
  const response = await request(state.app).get('/api/cart').set('Cookie', state.cookie).expect(200)
  assert.equal(response.body.cart.items[0].product, null)
  assert.equal(response.body.cart.items[0].available, false)
  assert.equal(response.body.cart.items[0].productId, item.id)
  await request(state.app).delete(`/api/cart/items/${item.id}`).set('Cookie', state.cookie).expect(200)
})

test('cart operations cannot access another user cart and client ownership/price fields are rejected', async () => {
  const state = fixture()
  const item = await product(state)
  const otherUser = new mongoose.Types.ObjectId()
  const foreign = await state.CartModel.create({ user: otherUser, items: [{ product: item._id, quantity: 2 }] })
  await request(state.app).post('/api/cart/items').set('Cookie', state.cookie).send({ productId: item.id, user: otherUser.toString() }).expect(400)
  await request(state.app).patch(`/api/cart/items/${item.id}`).set('Cookie', state.cookie).send({ quantity: 1 }).expect(404)
  await request(state.app).delete('/api/cart').set('Cookie', state.cookie).expect(200)
  assert.equal(state.CartModel.records.get(foreign.id).items[0].quantity, 2)
})

test('address saving replaces only the current user address with validated data', async () => {
  const state = fixture()
  const response = await request(state.app).put('/api/users/me/address').set('Cookie', state.cookie)
    .send({ ...shippingAddress, line1: ' New address ' }).expect(200)
  assert.equal(response.body.address.line1, 'New address')
  assert.equal(state.UserModel.records.get(state.user.id).address.line1, 'New address')
  assert.equal(state.UserModel.records.get(state.user.id).role, 'user')
  await request(state.app).put('/api/users/me/address').set('Cookie', state.cookie).send({ city: 'Incomplete' }).expect(400)
  await request(state.app).put('/api/users/me/address').set('Cookie', state.cookie).send({ ...shippingAddress, role: 'admin' }).expect(400)
})

test('checkout creates a COD order from trusted server prices, snapshots data, clears the cart, and decrements stock', async () => {
  const state = fixture({ ageConfirmed: true })
  const apples = await product(state, { name: 'Apples', price: 2.5, stock: 4 })
  const hose = await product(state, { name: 'Silicone Hose', price: 15, stock: 3, productType: 'hookah' })
  await addToCart(state, apples.id, 2)
  await addToCart(state, hose.id, 1)
  state.ProductModel.records.get(apples.id).price = 2.8
  state.ProductModel.records.get(apples.id).description = 'Updated'
  const response = await request(state.app).post('/api/orders').set('Cookie', state.cookie).send({ paymentMethod: 'cod' }).expect(201)
  assert.equal(response.body.order.paymentMethod, 'cod')
  assert.equal(response.body.order.total, 20.6)
  assert.equal(response.body.order.items[0].price, 2.8)
  assert.equal(response.body.order.items[0].name, 'Apples')
  assert.equal(response.body.order.items[0].quantity, 2)
  assert.equal(response.body.order.statusHistory[0].status, 'pending')
  assert.ok(response.body.order.statusHistory[0].at)
  assert.deepEqual(response.body.order.address, shippingAddress)
  assert.equal(state.ProductModel.records.get(apples.id).stock, 2)
  assert.equal(state.ProductModel.records.get(hose.id).stock, 2)
  const cart = await request(state.app).get('/api/cart').set('Cookie', state.cookie).expect(200)
  assert.deepEqual(cart.body.cart.items, [])
  const started = state.events.lastIndexOf('transaction:start')
  const committed = state.events.lastIndexOf('transaction:commit')
  assert.ok(started >= 0)
  assert.ok(committed > started)
  assert.equal(state.events.includes('transaction:commit'), true)
})

test('checkout supports explicit addresses, requires one when the account has none, and rejects invalid methods', async () => {
  const state = fixture()
  const apples = await product(state)
  await addToCart(state, apples.id, 1)
  const custom = { ...shippingAddress, city: 'Bahir Dar' }
  const order = await request(state.app).post('/api/orders').set('Cookie', state.cookie).send({ paymentMethod: 'cod', address: custom }).expect(201)
  assert.equal(order.body.order.address.city, 'Bahir Dar')
  const noAddress = fixture()
  delete noAddress.UserModel.records.get(noAddress.user.id).address
  const item = await product(noAddress)
  await addToCart(noAddress, item.id, 1)
  await request(noAddress.app).post('/api/orders').set('Cookie', noAddress.cookie).send({ paymentMethod: 'cod' }).expect(400)
  await request(state.app).post('/api/orders').set('Cookie', state.cookie).send({ paymentMethod: 'bank' }).expect(400)
})

test('checkout rolls back stock/cart when stock checks fail, products disappear, or order persistence errors occur', async (context) => {
  context.mock.method(console, 'error', () => {})
  const state = fixture()
  const apples = await product(state, { stock: 1 })
  await addToCart(state, apples.id, 1)
  state.ProductModel.records.get(apples.id).stock = 0
  await request(state.app).post('/api/orders').set('Cookie', state.cookie).send({ paymentMethod: 'cod' }).expect(409)
  assert.equal(state.CartModel.records.values().next().value.items.length, 1)
  state.ProductModel.records.delete(apples.id)
  await request(state.app).post('/api/orders').set('Cookie', state.cookie).send({ paymentMethod: 'cod' }).expect(409)
  const hookahState = fixture({ ageConfirmed: false })
  const hookah = await product(hookahState, { productType: 'hookah' })
  hookahState.ProductModel.records.get(hookah.id).stock = 5
  hookahState.CartModel.records.set('manual', { _id: 'manual', user: hookahState.user._id, items: [{ product: hookah._id, quantity: 1 }], __v: 0 })
  await request(hookahState.app).post('/api/orders').set('Cookie', hookahState.cookie).send({ paymentMethod: 'cod' }).expect(403)
  const failing = fixture()
  const item = await product(failing)
  await addToCart(failing, item.id, 1)
  failing.failOrder = true
  await request(failing.app).post('/api/orders').set('Cookie', failing.cookie).send({ paymentMethod: 'cod' }).expect(500)
  assert.equal(failing.ProductModel.records.get(item.id).stock, 10)
  assert.equal(failing.events.includes('transaction:rollback'), true)
})

test('history lists only current user orders with pagination and optional status filters', async () => {
  const state = fixture()
  const now = Date.now()
  const own = await state.OrderModel.create({ user: state.user._id, items: [{ product: new mongoose.Types.ObjectId(), name: 'Apples', price: 2.5, quantity: 1, productType: 'grocery' }], address: shippingAddress, paymentMethod: 'cod', total: 2.5, orderStatus: 'pending', createdAt: new Date(now - 1000) })
  await state.OrderModel.create({ user: new mongoose.Types.ObjectId(), items: [{ product: new mongoose.Types.ObjectId(), name: 'Foreign', price: 2, quantity: 1, productType: 'grocery' }], address: shippingAddress, paymentMethod: 'cod', total: 2, orderStatus: 'pending', createdAt: new Date(now) })
  const filtered = await request(state.app).get('/api/orders/history').set('Cookie', state.cookie).query({ orderStatus: 'pending', page: '1', limit: '1' }).expect(200)
  assert.equal(filtered.body.orders.length, 1)
  assert.equal(filtered.body.orders[0]._id, own.id)
  assert.deepEqual(filtered.body.pagination, { page: 1, limit: 1, total: 1, pages: 1 })
  await request(state.app).get('/api/orders/history').set('Cookie', state.cookie).query({ user: state.user.id }).expect(400)
})

test('admin order listing and status updates enforce role and valid transitions only', async () => {
  const admin = fixture({ role: 'admin' })
  const user = fixture()
  const item = { product: new mongoose.Types.ObjectId(), name: 'Apples', price: 2.5, quantity: 1, productType: 'grocery' }
  const pending = await admin.OrderModel.create({ user: admin.user._id, items: [item], address: shippingAddress, paymentMethod: 'cod', total: 2.5, orderStatus: 'pending' })
  await admin.OrderModel.create({ user: admin.user._id, items: [item], address: shippingAddress, paymentMethod: 'cod', total: 2.5, orderStatus: 'shipped' })
  await request(user.app).get('/api/orders/admin').set('Cookie', user.cookie).expect(403)
  const list = await request(admin.app).get('/api/orders/admin').set('Cookie', admin.cookie).query({ orderStatus: 'pending' }).expect(200)
  assert.equal(list.body.orders.length, 1)
  const confirmed = await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'confirmed' }).expect(200)
  assert.equal(confirmed.body.order.orderStatus, 'confirmed')
  assert.equal(confirmed.body.order.statusHistory[0].status, 'confirmed')
  await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'shipped' }).expect(409)
  await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'processing' }).expect(200)
  const shipped = await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'shipped' }).expect(200)
  assert.equal(shipped.body.order.paymentStatus, 'pending')
  const delivered = await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'delivered' }).expect(200)
  assert.equal(delivered.body.order.paymentStatus, 'paid')
  await request(admin.app).patch(`/api/orders/admin/${pending.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'cancelled' }).expect(409)
  await request(admin.app).patch('/api/orders/admin/invalid/status').set('Cookie', admin.cookie).send({ orderStatus: 'pending' }).expect(400)
})

test('admin cancellation restores stock once and runs in a transaction', async () => {
  const admin = fixture({ role: 'admin' })
  const apples = await product(admin, { stock: 2 })
  const order = await admin.OrderModel.create({
    user: admin.user._id,
    items: [{ product: apples._id, name: 'Apples', price: 2.5, quantity: 2, productType: 'grocery' }],
    address: shippingAddress,
    paymentMethod: 'cod',
    total: 5,
    orderStatus: 'confirmed',
  })
  await request(admin.app).patch(`/api/orders/admin/${order.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'cancelled' }).expect(200)
  assert.equal(admin.ProductModel.records.get(apples.id).stock, 4)
  await request(admin.app).patch(`/api/orders/admin/${order.id}/status`).set('Cookie', admin.cookie).send({ orderStatus: 'cancelled' }).expect(200)
  assert.equal(admin.ProductModel.records.get(apples.id).stock, 4)
  assert.equal(admin.events.includes('transaction:commit'), true)
})

test('order history and admin lists reject foreign filters and invalid pagination', async () => {
  const admin = fixture({ role: 'admin' })
  const user = fixture()
  await request(user.app).get('/api/orders/history').set('Cookie', user.cookie).query({ page: '0' }).expect(400)
  await request(admin.app).get('/api/orders/admin').set('Cookie', admin.cookie).query({ limit: '100' }).expect(400)
  await request(admin.app).get('/api/orders/admin').set('Cookie', admin.cookie).query({ user: user.user.id }).expect(400)
})

test('admin KPI endpoint returns UTC orders today, paid revenue, pending orders, and available low stock', async () => {
  const user = new User({ name: 'Admin', email: 'admin@example.com', passwordHash: 'hash', isVerified: true, role: 'admin' })
  const config = { nodeEnv: 'test', corsOrigins: [], jwtSecret: 'a-test-secret-with-at-least-32-bytes', jwtTtlSeconds: 3600 }
  const app = createApp(config, {
    UserModel: { findById() { return { select: async () => user } } },
    OrderModel: {
      async aggregate(pipeline) { assert.deepEqual(pipeline[0].$group.revenue.$sum.$cond[0], { $eq: ['$paymentStatus', 'paid'] }); return [{ orders: 10, revenue: 25, pending: 4 }] },
      async countDocuments(filter) { assert.equal(filter.createdAt.$gte.getUTCHours(), 0); return 2 },
    },
    ProductModel: { async countDocuments(filter) { assert.equal(filter.$expr.$lte[1], 3); return 3 } },
  })
  await request(app).get('/api/orders/admin/stats').expect(401)
  const response = await request(app).get('/api/orders/admin/stats').set('Cookie', `freshcart_session=${signSession(user, config)}`).expect(200)
  assert.deepEqual(response.body.stats, { orders: 10, revenue: 25, pending: 4, ordersToday: 2, lowStock: 3 })
})