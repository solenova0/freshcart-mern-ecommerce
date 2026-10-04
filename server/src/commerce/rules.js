import Decimal from 'decimal.js'

export const maxCartItems = 100
export const maxItemQuantity = 999
export const orderTransitions = Object.freeze({
  pending: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['processing', 'cancelled']),
  processing: Object.freeze(['shipped', 'cancelled']),
  shipped: Object.freeze(['delivered']),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([]),
})

export function commerceError(message, status = 409) {
  const error = new Error(message)
  error.status = status
  return error
}

export function assertOrderTransition(current, next) {
  if (!orderTransitions[current]?.includes(next)) {
    throw commerceError(`Order cannot transition from ${current} to ${next}`)
  }
}

export function priceToMinorUnits(price) {
  if (!Number.isFinite(price) || price < 0) throw commerceError('Product price is invalid')
  const minor = new Decimal(price).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  if (!Number.isSafeInteger(minor)) throw commerceError('Product price exceeds the supported amount')
  return minor
}

export function lineMinorUnits(priceMinor, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maxItemQuantity) {
    throw commerceError(`Quantity must be between 1 and ${maxItemQuantity}`)
  }
  const amount = BigInt(priceMinor) * BigInt(quantity)
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw commerceError('Order total exceeds the supported amount')
  return Number(amount)
}

export function totalMinorUnits(amounts) {
  const amount = amounts.reduce((total, value) => total + BigInt(value), 0n)
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw commerceError('Order total exceeds the supported amount')
  return Number(amount)
}

export function assertPurchasable(product, quantity, user) {
  if (!product) throw commerceError('A cart product is no longer available')
  if (!Number.isSafeInteger(product.stock) || product.stock - (product.reservedStock || 0) < quantity) {
    throw commerceError(`Insufficient stock for ${product.name}`)
  }
  if (product.productType === 'hookah' && !user.ageConfirmed) {
    throw commerceError('Age confirmation is required for hookah products', 403)
  }
}