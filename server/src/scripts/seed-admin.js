import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { z } from 'zod'
import User from '../models/User.js'
import { connectDatabase } from '../config/db.js'

export function adminSeedValues(values) {
  const production = values.NODE_ENV === 'production'
  const email = values.DEMO_ADMIN_EMAIL || (production ? '' : 'admin@freshcart.test')
  const password = values.DEMO_ADMIN_PASSWORD || (production ? '' : 'FreshCartDemo!2026')
  if (production && (email === 'admin@freshcart.test' || password === 'FreshCartDemo!2026')) throw new Error('Public demo credentials cannot be used in production')
  return z.object({ email: z.email(), password: z.string().min(16).refine((value) => Buffer.byteLength(value) <= 72) }).parse({ email, password })
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  const { email, password } = adminSeedValues(process.env)
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('A valid MONGODB_URI is required')
  try {
    await connectDatabase(uri)
    await User.init()
    const existing = await User.findOne({ email })
    if (existing) {
      if (existing.role !== 'admin' || !existing.isVerified) throw new Error('Existing account is not a verified administrator; refusing to escalate it')
      console.log('Administrator already exists; credentials were not changed.')
      return
    }
    await User.create({ name: 'Demo Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', isVerified: true })
    console.log('Administrator created. Credentials were not logged.')
  } finally {
    await mongoose.disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Admin seed failed. Check its environment, MongoDB, and existing account.'); process.exitCode = 1 })
}