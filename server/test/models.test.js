import assert from 'node:assert/strict'
import { test } from 'node:test'
import mongoose from 'mongoose'
import User from '../src/models/User.js'
import Category from '../src/models/Category.js'
import Product from '../src/models/Product.js'
import Cart from '../src/models/Cart.js'
import Order from '../src/models/Order.js'

function objectId() {
  return new mongoose.Types.ObjectId()
}

function address() {
  return { fullName: 'Sample Customer', line1: '12 Market Road', city: 'Addis Ababa', country: 'ET' }
}

function product(values = {}) {
  return new Product({ name: 'Apples', price: 2.5, category: objectId(), ...values })
}

function order(values = {}) {
  return new Order({
    user: objectId(),
    items: [{ product: objectId(), name: 'Apples', price: 2.5, quantity: 2, productType: 'grocery' }],
    address: address(),
    paymentMethod: 'cod',
    total: 5,
    ...values,
  })
}

test('User normalizes email, applies safe defaults, and hides password hashes in JSON', async () => {
  const user = new User({ name: ' Sample Customer ', email: ' CUSTOMER@Example.com ', passwordHash: 'already-hashed-password' })
  await user.validate()
  assert.equal(user.name, 'Sample Customer')
  assert.equal(user.email, 'customer@example.com')
  assert.equal(user.role, 'user')
  assert.equal(user.isVerified, false)
  assert.equal(user.ageConfirmed, false)
  assert.equal(user.address, undefined)
  assert.equal(user.toJSON().passwordHash, undefined)
  assert.equal(User.schema.path('passwordHash').options.select, false)
  assert.ok(User.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique))
})

test('User validates required fields, email, role, and an optional supplied address', async () => {
  await assert.rejects(new User({}).validate(), { name: 'ValidationError' })
  for (const values of [{ email: 'invalid' }, { role: 'superadmin' }, { passwordHash: '' }, { address: { city: 'Addis Ababa' } }]) {
    const user = new User({ name: 'Customer', email: 'customer@example.com', passwordHash: 'hash', ...values })
    await assert.rejects(user.validate(), { name: 'ValidationError' })
  }
  await new User({ name: 'Admin', email: 'admin@example.com', passwordHash: 'hash', role: 'admin', address: address() }).validate()
})

test('Category validates its slug and declares a unique slug index', async () => {
  const category = new Category({ name: ' Fresh Fruit ', slug: ' FRESH-FRUIT ' })
  await category.validate()
  assert.equal(category.name, 'Fresh Fruit')
  assert.equal(category.slug, 'fresh-fruit')
  assert.ok(Category.schema.indexes().some(([fields, options]) => fields.slug === 1 && options.unique))
  await assert.rejects(new Category({ name: 'Fruit', slug: 'invalid slug' }).validate())
  await assert.rejects(new Category({}).validate())
})

test('Product supports both types and flexible nested attributes with independent defaults', async () => {
  const grocery = product({ images: [' /apples.jpg '], attributes: { weight: 1, organic: true, origin: { country: 'ET' } } })
  const hookah = product({ productType: 'hookah', attributes: { material: 'steel', sizes: [30, 40] } })
  await grocery.validate()
  await hookah.validate()
  assert.equal(grocery.productType, 'grocery')
  assert.equal(grocery.images[0], '/apples.jpg')
  assert.equal(grocery.attributes.origin.country, 'ET')
  assert.equal(hookah.productType, 'hookah')
  const first = product()
  const second = product()
  first.attributes.weight = 1
  assert.deepEqual(second.attributes, {})
  assert.deepEqual(second.images.toObject(), [])
  assert.equal(second.stock, 0)
})

test('Product rejects invalid references, amounts, stock, types, and non-object attributes', async () => {
  for (const values of [
    { name: '' }, { price: -1 }, { price: Infinity }, { price: NaN }, { category: undefined },
    { category: 'not-an-id' }, { stock: -1 }, { stock: 1.5 }, { stock: Infinity },
    { productType: 'other' }, { attributes: [] }, { attributes: 'invalid' }, { attributes: null },
  ]) {
    await assert.rejects(product(values).validate(), { name: 'ValidationError' })
  }
})

test('Product declares weighted name/description text search and category/type indexes', () => {
  const indexes = Product.schema.indexes()
  const textIndexes = indexes.filter(([fields]) => Object.values(fields).includes('text'))
  assert.equal(textIndexes.length, 1)
  assert.deepEqual(textIndexes[0][0], { name: 'text', description: 'text' })
  assert.deepEqual(textIndexes[0][1].weights, { name: 10, description: 2 })
  assert.ok(indexes.some(([fields]) => fields.category === 1 && fields.productType === 1))
  assert.equal(Product.schema.path('category').options.ref, 'Category')
})

test('Cart permits empty carts, enforces one cart per user, and references products', async () => {
  const cart = new Cart({ user: objectId() })
  await cart.validate()
  assert.equal(cart.items.length, 0)
  assert.ok(Cart.schema.indexes().some(([fields, options]) => fields.user === 1 && options.unique))
  assert.equal(Cart.schema.path('user').options.ref, 'User')
  assert.equal(Cart.schema.path('items').schema.path('product').options.ref, 'Product')
  await new Cart({ user: objectId(), items: [{ product: objectId(), quantity: 2 }] }).validate()
})

test('Cart rejects missing owners, duplicate products, and invalid quantities', async () => {
  await assert.rejects(new Cart({}).validate())
  for (const quantity of [0, -1, 1.5, Infinity, undefined]) {
    await assert.rejects(new Cart({ user: objectId(), items: [{ product: objectId(), quantity }] }).validate())
  }
  const productId = objectId()
  await assert.rejects(new Cart({ user: objectId(), items: [
    { product: productId, quantity: 1 }, { product: productId, quantity: 2 },
  ] }).validate(), /Each product can appear only once/)
})

test('Order requires checkout data and validates payment and order status enums', async () => {
  const purchase = order()
  await purchase.validate()
  assert.equal(purchase.paymentStatus, 'pending')
  assert.equal(purchase.orderStatus, 'pending')
  await order({ paymentMethod: 'stripe', paymentStatus: 'paid', orderStatus: 'confirmed' }).validate()
  for (const values of [
    { user: undefined }, { items: [] }, { items: undefined }, { address: undefined },
    { address: { city: 'Addis Ababa' } }, { paymentMethod: 'cash' }, { paymentMethod: undefined },
    { paymentStatus: 'unknown' }, { orderStatus: 'unknown' }, { total: -1 }, { total: Infinity }, { total: undefined },
    { items: [{ product: objectId(), quantity: 1 }] },
  ]) {
    await assert.rejects(order(values).validate(), { name: 'ValidationError' })
  }
})

test('Order item and address snapshots survive changes to source documents', async () => {
  const source = product({ attributes: { weight: 1 }, images: ['/apples.jpg'] })
  const customer = new User({ name: 'Customer', email: 'customer@example.com', passwordHash: 'hash', address: address() })
  const purchase = order({
    user: customer._id,
    address: customer.address.toObject(),
    items: [{
      product: source._id,
      name: source.name,
      price: source.price,
      quantity: 2,
      image: source.images[0],
      productType: source.productType,
      attributes: structuredClone(source.attributes),
    }],
  })
  source.name = 'Renamed apples'
  source.price = 10
  source.attributes.weight = 5
  customer.address.line1 = 'A new address'
  await purchase.validate()
  assert.equal(purchase.items[0].name, 'Apples')
  assert.equal(purchase.items[0].price, 2.5)
  assert.equal(purchase.items[0].attributes.weight, 1)
  assert.equal(purchase.items[0].image, '/apples.jpg')
  assert.equal(purchase.address.line1, '12 Market Road')
  assert.equal(purchase.address._id, undefined)
  assert.equal(purchase.items[0]._id, undefined)
})

test('Order snapshots reject invalid quantities, prices, types, and attributes', async () => {
  const snapshot = { product: objectId(), name: 'Apples', price: 2.5, quantity: 1, productType: 'grocery' }
  for (const values of [{ quantity: 0 }, { quantity: 1.5 }, { price: -1 }, { price: Infinity }, { productType: 'other' }, { attributes: [] }]) {
    await assert.rejects(order({ items: [{ ...snapshot, ...values }] }).validate())
  }
})

test('All models enable creation/update timestamps and Order indexes purchase history', () => {
  for (const model of [User, Category, Product, Cart, Order]) {
    assert.equal(model.schema.options.timestamps, true)
    assert.equal(model.schema.path('createdAt').instance, 'Date')
    assert.equal(model.schema.path('updatedAt').instance, 'Date')
  }
  assert.ok(Order.schema.indexes().some(([fields]) => fields.user === 1 && fields.createdAt === -1))
})