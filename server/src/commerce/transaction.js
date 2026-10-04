import mongoose from 'mongoose'
import { commerceError } from './rules.js'

export async function runCommerceTransaction(operation) {
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(async () => { result = await operation(session) })
    return result
  } catch (error) {
    if (error.code === 20 || error.message?.includes('Transaction numbers are only allowed')) {
      throw commerceError('Checkout requires MongoDB Atlas or a replica set', 503)
    }
    throw error
  } finally {
    await session.endSession()
  }
}