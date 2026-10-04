import { Router } from 'express'
import { createPaymentService } from '../services/payments.js'
import { validate } from '../auth/validation.js'
import { orderIdSchema } from '../commerce/validation.js'
import { requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'

export function createPaymentRouter(config, dependencies = {}) {
  const router = Router()
  const payments = createPaymentService(config, dependencies)
  const protection = [rejectCrossSiteMutation, requireAuth, authRateLimit(20)]
  router.post('/:id/checkout-session', ...protection, validate(orderIdSchema, 'params'), async (req, res) => {
    res.json(await payments.createSession(req.params.id, req.user._id))
  })
  router.post('/:id/cancel-payment', ...protection, validate(orderIdSchema, 'params'), async (req, res) => {
    res.json({ order: await payments.cancel(req.params.id, req.user._id) })
  })
  return router
}

export function stripeWebhook(config, dependencies = {}) {
  const payments = createPaymentService(config, dependencies)
  return async (req, res) => {
    if (!payments.stripe || !config.stripeWebhookSecret) return res.status(503).json({ error: { message: 'Stripe is not configured' } })
    let event
    try {
      event = payments.stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret)
    } catch {
      return res.status(400).json({ error: { message: 'Invalid Stripe signature' } })
    }
    if (event.type === 'checkout.session.completed') await payments.processSession(event.data.object, true)
    if (event.type === 'checkout.session.expired') await payments.processSession(event.data.object, false)
    res.json({ received: true })
  }
}