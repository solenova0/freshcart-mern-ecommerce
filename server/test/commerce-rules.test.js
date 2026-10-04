import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertOrderTransition, assertPurchasable, lineMinorUnits, orderTransitions,
  priceToMinorUnits, totalMinorUnits,
} from '../src/commerce/rules.js'
import {
  addCartItemSchema, checkoutSchema, orderListSchema, shippingAddressSchema,
  updateCartItemSchema, updateOrderStatusSchema,
} from '../src/commerce/validation.js'

const address = { fullName: ' Customer ', line1: ' 12 Market Road ', city: 'Addis Ababa', country: 'ET' }

test('commerce schemas reject client prices, ownership, arbitrary payments, and malformed quantities', () => {
  const item = { productId: 'a'.repeat(24) }
  assert.equal(addCartItemSchema.parse(item).quantity, 1)
  for (const values of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: 1000 }, { price: 1 }, { user: 'a'.repeat(24) }]) {
    assert.equal(addCartItemSchema.safeParse({ ...item, ...values }).success, false)
  }
  assert.equal(updateCartItemSchema.safeParse({ quantity: '2' }).success, false)
  assert.deepEqual(checkoutSchema.parse({}), { paymentMethod: 'cod' })
  for (const values of [{ paymentMethod: 'bank' }, { total: 1 }, { items: [] }, { user: 'a'.repeat(24) }]) {
    assert.equal(checkoutSchema.safeParse(values).success, false)
  }
  assert.equal(updateOrderStatusSchema.safeParse({ orderStatus: 'delivered', paymentStatus: 'paid' }).success, false)
})

test('shipping addresses are normalized, complete, bounded, and reject privileged fields', () => {
  assert.equal(shippingAddressSchema.parse(address).fullName, 'Customer')
  assert.equal(shippingAddressSchema.parse(address).line1, '12 Market Road')
  assert.equal(shippingAddressSchema.safeParse({ city: 'Addis Ababa' }).success, false)
  assert.equal(shippingAddressSchema.safeParse({ ...address, role: 'admin' }).success, false)
  assert.equal(shippingAddressSchema.safeParse({ ...address, line1: 'a'.repeat(201) }).success, false)
})

test('checkout pricing uses exact minor units and defined half-up currency rounding', () => {
  assert.equal(priceToMinorUnits(0.1), 10)
  assert.equal(priceToMinorUnits(0.2), 20)
  assert.equal(priceToMinorUnits(10.005), 1001)
  assert.equal(totalMinorUnits([lineMinorUnits(10, 3), lineMinorUnits(20, 2)]) / 100, 0.7)
  assert.equal(priceToMinorUnits(0), 0)
  for (const price of [-1, Infinity, NaN, Number.MAX_VALUE]) assert.throws(() => priceToMinorUnits(price))
  assert.throws(() => lineMinorUnits(Number.MAX_SAFE_INTEGER, 2), /supported amount/)
  assert.throws(() => totalMinorUnits([Number.MAX_SAFE_INTEGER, 1]), /supported amount/)
})

test('order status transitions allow only sequential progress or pre-shipment cancellation', () => {
  for (const [current, allowed] of Object.entries(orderTransitions)) {
    for (const next of Object.keys(orderTransitions)) {
      if (allowed.includes(next)) assert.doesNotThrow(() => assertOrderTransition(current, next))
      else assert.throws(() => assertOrderTransition(current, next), { status: 409 })
    }
  }
})

test('purchase rules check product availability, stock, and hookah age confirmation', () => {
  const product = { name: 'Apples', stock: 2, productType: 'grocery' }
  assert.doesNotThrow(() => assertPurchasable(product, 2, { ageConfirmed: false }))
  assert.throws(() => assertPurchasable(product, 3, {}), /Insufficient stock/)
  assert.throws(() => assertPurchasable(null, 1, {}), /no longer available/)
  assert.throws(() => assertPurchasable({ ...product, productType: 'hookah' }, 1, { ageConfirmed: false }), { status: 403 })
  assert.doesNotThrow(() => assertPurchasable({ ...product, productType: 'hookah' }, 1, { ageConfirmed: true }))
})

test('order listing accepts bounded pagination and rejects foreign ownership filters', () => {
  assert.deepEqual(orderListSchema.parse({}), { page: 1, limit: 20 })
  for (const values of [{ user: 'a'.repeat(24) }, { page: '0' }, { limit: '51' }, { orderStatus: 'unknown' }]) {
    assert.equal(orderListSchema.safeParse(values).success, false)
  }
})