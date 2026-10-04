import Stripe from 'stripe'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import { runCommerceTransaction } from '../commerce/transaction.js'
import { commerceError, priceToMinorUnits } from '../commerce/rules.js'

export function createPaymentService(config, dependencies = {}) {
  const OrderModel = dependencies.OrderModel || Order
  const ProductModel = dependencies.ProductModel || Product
  const transaction = dependencies.runTransaction || runCommerceTransaction
  const stripe = dependencies.stripeClient || (config.stripeSecretKey ? new Stripe(config.stripeSecretKey, { maxNetworkRetries: 2, timeout: 15000 }) : null)

  async function release(order, session) {
    if (order.stockReserved) {
      for (const item of order.items) {
        const result = await ProductModel.updateOne({ _id: item.product, reservedStock: { $gte: item.quantity } }, {
          $inc: { reservedStock: -item.quantity, __v: 1 },
        }, { session })
        if (!result.modifiedCount) throw commerceError('Stock reservation requires reconciliation', 503)
      }
      order.stockReserved = false
    }
    order.orderStatus = 'cancelled'
    order.statusHistory.push({ status: 'cancelled', at: new Date() })
    order.paymentStatus = 'failed'
    await order.save({ session })
  }

  async function processSession(checkout, completed) {
    const orderId = checkout.metadata?.orderId
    if (!/^[a-f0-9]{24}$/i.test(orderId || '')) throw commerceError('Invalid payment metadata', 400)
    return transaction(async (session) => {
      const order = await OrderModel.findById(orderId).session(session)
      if (!order || order.paymentMethod !== 'stripe') throw commerceError('Payment order not found', 404)
      if (order.stripeSessionId && order.stripeSessionId !== checkout.id) throw commerceError('Checkout session does not match order', 400)
      if (completed && (checkout.payment_status !== 'paid' || checkout.currency !== 'usd' || checkout.amount_total !== priceToMinorUnits(order.total) || checkout.client_reference_id !== order.user.toString())) {
        throw commerceError('Payment amount, currency, owner, or status does not match', 400)
      }
      if (order.paymentStatus === 'paid' || order.orderStatus === 'cancelled') return order
      order.stripeSessionId = checkout.id
      if (!completed) { await release(order, session); return order }
      if (!order.stockReserved) throw commerceError('Payment stock reservation is missing', 503)
      for (const item of order.items) {
        const result = await ProductModel.updateOne({
          _id: item.product, stock: { $gte: item.quantity }, reservedStock: { $gte: item.quantity },
        }, { $inc: { stock: -item.quantity, reservedStock: -item.quantity, __v: 1 } }, { session })
        if (!result.modifiedCount) throw commerceError('Paid order requires inventory reconciliation', 503)
      }
      order.stockReserved = false
      order.stockDeducted = true
      order.paymentStatus = 'paid'
      await order.save({ session })
      return order
    })
  }

  return {
    stripe,
    processSession,
    async createSession(orderId, userId) {
      if (!stripe) throw commerceError('Card payments are not configured', 503)
      const order = await transaction(async (session) => {
        const current = await OrderModel.findOne({ _id: orderId, user: userId }).session(session)
        if (!current) throw commerceError('Order not found', 404)
        if (current.paymentMethod !== 'stripe' || current.paymentStatus !== 'pending' || current.orderStatus !== 'pending') throw commerceError('Order is not eligible for Stripe Checkout')
        if (!current.stockReserved) {
          for (const item of current.items) {
            const product = await ProductModel.findById(item.product).session(session)
            if (!product || product.stock - product.reservedStock < item.quantity) throw commerceError(`Insufficient stock for ${item.name}`)
            const changed = await ProductModel.updateOne({
              _id: item.product, stock: product.stock, reservedStock: product.reservedStock,
            }, { $inc: { reservedStock: item.quantity, __v: 1 } }, { session })
            if (!changed.modifiedCount) throw commerceError('Stock changed. Retry checkout.')
          }
          current.stockReserved = true
          await current.save({ session })
        }
        return current
      })
      let checkout
      try {
        checkout = order.stripeSessionId
          ? await stripe.checkout.sessions.retrieve(order.stripeSessionId)
          : await stripe.checkout.sessions.create({
            mode: 'payment', payment_method_types: ['card'],
            client_reference_id: order.user.toString(), metadata: { orderId: order.id },
            line_items: order.items.map((item) => ({ quantity: item.quantity, price_data: {
              currency: 'usd', unit_amount: priceToMinorUnits(item.price), product_data: { name: item.name },
            } })),
            success_url: `${config.storefrontUrl}/orders?payment=success`,
            cancel_url: `${config.storefrontUrl}/orders?payment=cancelled&order=${order.id}`,
            expires_at: Math.floor(Date.now() / 1000) + 1800,
          }, { idempotencyKey: `freshcart-order-${order.id}` })
      } catch {
        throw commerceError('Stripe is temporarily unavailable; retry this order to reconcile the session', 503)
      }
      if (checkout.status !== 'open' || !checkout.url) throw commerceError('Checkout session is no longer open')
      await transaction(async (session) => {
        const current = await OrderModel.findById(order.id).session(session)
        current.stripeSessionId = checkout.id
        await current.save({ session })
      })
      return { url: checkout.url, sessionId: checkout.id }
    },
    async cancel(orderId, userId) {
      if (!stripe) throw commerceError('Card payments are not configured', 503)
      const order = await OrderModel.findOne({ _id: orderId, user: userId })
      if (!order) throw commerceError('Order not found', 404)
      if (order.paymentMethod !== 'stripe' || order.paymentStatus === 'paid') throw commerceError('Paid or COD orders cannot use this cancellation endpoint')
      if (order.orderStatus === 'cancelled') return order
      if (order.stripeSessionId) {
        let checkout = await stripe.checkout.sessions.retrieve(order.stripeSessionId)
        if (checkout.status === 'complete') throw commerceError('Payment completed; awaiting payment confirmation')
        if (checkout.status === 'open') checkout = await stripe.checkout.sessions.expire(checkout.id)
        return processSession(checkout, false)
      }
      if (order.stockReserved) throw commerceError('Retry Checkout session creation before cancellation to reconcile its state', 503)
      return transaction(async (session) => {
        const current = await OrderModel.findById(order.id).session(session)
        await release(current, session)
        return current
      })
    },
  }
}