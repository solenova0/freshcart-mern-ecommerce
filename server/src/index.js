import mongoose from 'mongoose'
import { createApp } from './app.js'
import { loadEnvironment } from './config/env.js'
import { connectDatabase } from './config/db.js'
import User from './models/User.js'
import Category from './models/Category.js'
import Product from './models/Product.js'
import Cart from './models/Cart.js'
import Order from './models/Order.js'

async function start() {
  const config = loadEnvironment()
  await connectDatabase(config.mongoUri)
  await Promise.all([User.init(), Category.init(), Product.init(), Cart.init(), Order.init()])
  const server = createApp(config).listen(config.port, () => {
    console.log(`FreshCart API listening on http://localhost:${config.port}`)
  })
  server.on('error', async () => {
    console.error('HTTP server failed to start; check PORT and availability')
    await mongoose.disconnect()
    process.exit(1)
  })

  let shuttingDown = false
  function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    const timeout = setTimeout(() => process.exit(1), 10000)
    timeout.unref()
    server.close(async () => {
      try {
        await mongoose.disconnect()
        clearTimeout(timeout)
        process.exit(0)
      } catch {
        process.exit(1)
      }
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch(async () => {
  console.error('API startup failed. Check the server environment, MongoDB availability, and indexes.')
  try {
    await mongoose.disconnect()
  } finally {
    process.exitCode = 1
  }
})