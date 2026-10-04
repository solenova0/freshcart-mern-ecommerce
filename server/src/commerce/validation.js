import { z } from 'zod'
import { maxItemQuantity, orderTransitions } from './rules.js'

const objectId = z.string().regex(/^[a-f0-9]{24}$/i)
const quantity = z.number().int().min(1).max(maxItemQuantity)
const optionalAddressText = (maximum) => z.string().trim().max(maximum).optional()

export const shippingAddressSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(100),
  phone: optionalAddressText(30),
  line1: z.string().trim().min(1).max(200),
  line2: optionalAddressText(200),
  city: z.string().trim().min(1).max(100),
  state: optionalAddressText(100),
  postalCode: optionalAddressText(30),
  country: z.string().trim().min(1).max(100),
})

export const cartProductParamsSchema = z.strictObject({ productId: objectId })
export const addCartItemSchema = z.strictObject({ productId: objectId, quantity: quantity.default(1) })
export const updateCartItemSchema = z.strictObject({ quantity })
export const checkoutSchema = z.strictObject({
  paymentMethod: z.enum(['cod', 'stripe']).default('cod'),
  address: shippingAddressSchema.optional(),
})
export const orderIdSchema = z.strictObject({ id: objectId })
export const updateOrderStatusSchema = z.strictObject({ orderStatus: z.enum(Object.keys(orderTransitions)) })

function positiveQueryInteger(maximum) {
  return z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(maximum))
}

export const orderListSchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  page: positiveQueryInteger(10000).default(1),
  limit: positiveQueryInteger(50).default(20),
  orderStatus: z.enum(Object.keys(orderTransitions)).optional(),
})