import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import mongoose from 'mongoose'
import cookieParser from 'cookie-parser'
import User from './models/User.js'
import { createAuthRouter } from './routes/auth.js'
import { createCategoryRouter } from './routes/categories.js'
import { createProductRouter } from './routes/products.js'
import { createCartRouter } from './routes/cart.js'
import { createOrderRouter } from './routes/orders.js'
import { createPaymentRouter, stripeWebhook } from './routes/payments.js'
import { createUserRouter } from './routes/users.js'
import { errorHandler, notFound } from './middleware/error-handler.js'

export function createApp(config, dependencies = {}) {
  const { nodeEnv, corsOrigins } = config
  const app = express()
  const allowedOrigins = new Set(corsOrigins)
  app.locals.auth = { config, UserModel: dependencies.UserModel || User }
  app.set('env', nodeEnv)
  app.set('trust proxy', config.trustProxy || false)
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true)
      const error = new Error('Origin is not allowed by CORS')
      error.status = 403
      callback(error)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }))
  app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '100kb' }), stripeWebhook(config, dependencies))
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.get('/api/ready', (_req, res) => {
    const connected = mongoose.connection.readyState === 1
    res.status(connected ? 200 : 503).json({ status: connected ? 'ready' : 'not_ready' })
  })

  app.use('/api/auth', createAuthRouter(config, dependencies))
  app.use('/api/categories', createCategoryRouter(config, dependencies))
  app.use('/api/products', createProductRouter(config, dependencies))
  app.use('/api/cart', createCartRouter(config, dependencies))
  app.use('/api/orders', createPaymentRouter(config, dependencies))
  app.use('/api/orders', createOrderRouter(config, dependencies))
  app.use('/api/users', createUserRouter(config, dependencies))
  app.use(notFound)
  app.use(errorHandler)
  return app
}