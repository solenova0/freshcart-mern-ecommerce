import mongoose from 'mongoose'
import addressSchema from './address.js'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  passwordHash: { type: String, required: true, select: false },
  verificationTokenHash: { type: String, select: false },
  verificationTokenExpiresAt: { type: Date, select: false },
  verificationEmailSentAt: { type: Date, select: false },
  sessionVersion: { type: Number, default: 0, min: 0, select: false, validate: Number.isSafeInteger },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  address: { type: addressSchema, default: undefined },
  ageConfirmed: { type: Boolean, default: false },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, result) {
      delete result.passwordHash
      delete result.verificationTokenHash
      delete result.verificationTokenExpiresAt
      delete result.verificationEmailSentAt
      delete result.sessionVersion
      return result
    },
  },
})

userSchema.index({ verificationTokenHash: 1 }, { sparse: true })

export default mongoose.models.User || mongoose.model('User', userSchema)