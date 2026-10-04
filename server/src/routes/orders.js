import { Router } from 'express'
import User from '../models/User.js'
import { runCommerceTransaction } from '../commerce/transaction.js'
import Cart from '../models/Cart.js'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import { validate } from '../auth/validation.js'
import { requireAdmin, requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { checkoutSchema, orderIdSchema, orderListSchema, updateOrderStatusSchema } from '../commerce/validation.js'
import {
  assertOrderTransition, assertPurchasable, commerceError, lineMinorUnits,
  priceToMinorUnits, totalMinorUnits,
} from '../commerce/rules.js'

function buildOrderItems(cartItems, productsById, user) {
  const items = []
  const amounts = []
  for (const cartItem of cartItems) {
    const product = productsById.get(cartItem.product.toString())
    assertPurchasable(product, cartItem.quantity, user)
    const priceMinor = priceToMinorUnits(product.price)
    amounts.push(lineMinorUnits(priceMinor, cartItem.quantity))
    items.push({
      product: product._id,
      name: product.name,
      price: priceMinor / 100,
      quantity: cartItem.quantity,
      image: product.images[0],
      productType: product.productType,
      attributes: structuredClone(product.attributes),
    })
  }
  return { items, total: totalMinorUnits(amounts) / 100 }
}

function searchOrders(search) {
  if (!search) return {}
  if (/^[a-f0-9]{24}$/i.test(search)) return { _id: search }
  const expression = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return { $or: [{ 'address.fullName': { $regex: expression, $options: 'i' } }, { 'address.city': { $regex: expression, $options: 'i' } }] }
}

export function createOrderRouter(config, {
  OrderModel = Order, CartModel = Cart, ProductModel = Product, UserModel = User, runTransaction,
} = {}) {
  const router = Router()
  const inTransaction = runTransaction || runCommerceTransaction

  router.post('/', rejectCrossSiteMutation, requireAuth, authRateLimit(20), validate(checkoutSchema), async (req, res) => {
    const order = await inTransaction(async (session) => {
      if (req.validated.paymentMethod === 'stripe' && !config.stripeSecretKey) throw commerceError('Card payments are not configured', 503)
      const user = await UserModel.findById(req.user._id).session(session)
      if (!user?.isVerified) throw commerceError('Verified account required', 403)
      const address = req.validated.address || user.address?.toObject()
      if (!address) throw commerceError('A shipping address is required', 400)
      const cart = await CartModel.findOne({ user: req.user._id }).session(session)
      if (!cart || cart.items.length === 0) throw commerceError('Cart is empty', 400)
      const products = await ProductModel.find({ _id: { $in: cart.items.map((item) => item.product) } }).session(session)
      const byId = new Map(products.map((product) => [product.id, product]))
      const { items, total } = buildOrderItems(cart.items, byId, user)
      for (const cartItem of req.validated.paymentMethod === 'cod' ? cart.items : []) {
        const product = byId.get(cartItem.product.toString())
        const changed = await ProductModel.updateOne({
          _id: product._id,
          stock: { $gte: cartItem.quantity },
          reservedStock: product.reservedStock,
        }, { $inc: { stock: -cartItem.quantity, __v: 1 } }, { session })
        if (!changed.modifiedCount) throw commerceError(`Insufficient stock for ${product.name}`)
      }
      const [created] = await OrderModel.create([{ user: req.user._id, items, address, paymentMethod: req.validated.paymentMethod, total, stockDeducted: req.validated.paymentMethod === 'cod', statusHistory: [{ status: 'pending', at: new Date() }] }], { session })
      if (!created.address) throw commerceError('A shipping address is required to place an order', 400)
      cart.items = []
      await cart.save({ session })
      return created
    })
    res.status(201).json({ order })
  })

  router.get('/history', requireAuth, validate(orderListSchema, 'query'), async (req, res) => {
    const { page, limit, orderStatus } = req.validated
    const filter = { user: req.user._id, ...(orderStatus ? { orderStatus } : {}), ...searchOrders(req.validated.search) }
    const [orders, total] = await Promise.all([
      OrderModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      OrderModel.countDocuments(filter),
    ])
    res.json({ orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })

  router.get('/admin', requireAuth, requireAdmin, validate(orderListSchema, 'query'), async (req, res) => {
    const { page, limit, orderStatus } = req.validated
    const filter = { ...(orderStatus ? { orderStatus } : {}), ...searchOrders(req.validated.search) }
    const [orders, total] = await Promise.all([
      OrderModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      OrderModel.countDocuments(filter),
    ])
    res.json({ orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })

  router.get('/admin/stats', requireAuth, requireAdmin, async (_req, res) => {
    const [stats] = await OrderModel.aggregate([{ $group: {
      _id: null, orders: { $sum: 1 },
      revenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] } },
      pending: { $sum: { $cond: [{ $eq: ['$orderStatus', 'pending'] }, 1, 0] } },
    } }])
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const ordersToday = await OrderModel.countDocuments({ createdAt: { $gte: today } })
    const lowStock = await ProductModel.countDocuments({ $expr: { $lte: [{ $subtract: ['$stock', { $ifNull: ['$reservedStock', 0] }] }, 3] } })
    res.json({ stats: { ...(stats || { orders: 0, revenue: 0, pending: 0 }), ordersToday, lowStock } })
  })

  router.patch('/admin/:id/status', rejectCrossSiteMutation, requireAuth, requireAdmin,
    validate(orderIdSchema, 'params'), validate(updateOrderStatusSchema), async (req, res) => {
      const { orderStatus } = req.validated
      const order = await inTransaction(async (session) => {
        const current = await OrderModel.findById(req.params.id).session(session)
        if (!current) throw commerceError('Order not found', 404)
        if (current.orderStatus === orderStatus) return current
        if (current.paymentMethod === 'stripe' && (current.paymentStatus !== 'paid' || orderStatus === 'cancelled')) throw commerceError('Stripe fulfillment requires payment; paid cancellations require a refund workflow')
        assertOrderTransition(current.orderStatus, orderStatus)
        current.orderStatus = orderStatus
        current.statusHistory.push({ status: orderStatus, at: new Date() })
        if (orderStatus === 'delivered' && current.paymentMethod === 'cod') current.paymentStatus = 'paid'
        if (orderStatus === 'cancelled' && current.paymentMethod === 'cod') {
          for (const item of current.items) {
            await ProductModel.updateOne({ _id: item.product }, { $inc: { stock: item.quantity, __v: 1 } }, { session })
          }
        }
        await current.save({ session })
        return current
      })
      res.json({ order })
    })

  return router
}