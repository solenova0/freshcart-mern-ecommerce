import { Router } from 'express'
import Cart from '../models/Cart.js'
import Product from '../models/Product.js'
import { validate } from '../auth/validation.js'
import { requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { addCartItemSchema, cartProductParamsSchema, updateCartItemSchema } from '../commerce/validation.js'
import {
  assertPurchasable, commerceError, lineMinorUnits, maxCartItems,
  maxItemQuantity, priceToMinorUnits, totalMinorUnits,
} from '../commerce/rules.js'

export function createCartRouter(_config, { CartModel = Cart, ProductModel = Product } = {}) {
  const router = Router()
  router.use(rejectCrossSiteMutation, requireAuth, authRateLimit(100))
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  async function cartResponse(cart, user) {
    const products = cart?.items.length
      ? await ProductModel.find({ _id: { $in: cart.items.map((item) => item.product) } })
      : []
    const byId = new Map(products.map((product) => [product.id, product]))
    const amounts = []
    const items = (cart?.items || []).map((item) => {
      const product = byId.get(item.product.toString()) || null
      const amount = product ? lineMinorUnits(priceToMinorUnits(product.price), item.quantity) : null
      if (amount !== null) amounts.push(amount)
      return {
        productId: item.product.toString(), product, quantity: item.quantity,
        lineTotal: amount === null ? null : amount / 100,
        available: Boolean(product && product.stock - product.reservedStock >= item.quantity && (product.productType !== 'hookah' || user.ageConfirmed)),
      }
    })
    return { id: cart?.id || null, items, total: totalMinorUnits(amounts) / 100 }
  }

  router.get('/', async (req, res) => {
    const cart = await CartModel.findOne({ user: req.user._id })
    res.json({ cart: await cartResponse(cart, req.user) })
  })

  router.post('/items', validate(addCartItemSchema), async (req, res) => {
    const { productId, quantity } = req.validated
    const product = await ProductModel.findById(productId)
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } })
    const cart = await CartModel.findOneAndUpdate({ user: req.user._id }, {
      $setOnInsert: { user: req.user._id, items: [] },
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true })
    const item = cart.items.find((entry) => entry.product.toString() === productId)
    const nextQuantity = (item?.quantity || 0) + quantity
    if (nextQuantity > maxItemQuantity) throw commerceError(`Quantity must not exceed ${maxItemQuantity}`, 400)
    assertPurchasable(product, nextQuantity, req.user)
    if (item) item.quantity = nextQuantity
    else {
      if (cart.items.length >= maxCartItems) throw commerceError(`A cart can contain at most ${maxCartItems} products`, 400)
      cart.items.push({ product: product._id, quantity: nextQuantity })
    }
    await cart.save()
    res.json({ cart: await cartResponse(cart, req.user) })
  })

  router.patch('/items/:productId', validate(cartProductParamsSchema, 'params'), validate(updateCartItemSchema), async (req, res) => {
    const cart = await CartModel.findOne({ user: req.user._id })
    const item = cart?.items.find((entry) => entry.product.toString() === req.params.productId)
    if (!item) return res.status(404).json({ error: { message: 'Cart item not found' } })
    const product = await ProductModel.findById(req.params.productId)
    assertPurchasable(product, req.validated.quantity, req.user)
    item.quantity = req.validated.quantity
    await cart.save()
    res.json({ cart: await cartResponse(cart, req.user) })
  })

  router.delete('/items/:productId', validate(cartProductParamsSchema, 'params'), async (req, res) => {
    const cart = await CartModel.findOne({ user: req.user._id })
    const exists = cart?.items.some((entry) => entry.product.toString() === req.params.productId)
    if (!exists) return res.status(404).json({ error: { message: 'Cart item not found' } })
    cart.items = cart.items.filter((entry) => entry.product.toString() !== req.params.productId)
    await cart.save()
    res.json({ cart: await cartResponse(cart, req.user) })
  })

  router.delete('/', async (req, res) => {
    const cart = await CartModel.findOneAndUpdate({ user: req.user._id }, {
      $set: { items: [] }, $inc: { __v: 1 },
    }, { new: true, runValidators: true })
    res.json({ cart: await cartResponse(cart, req.user) })
  })

  return router
}