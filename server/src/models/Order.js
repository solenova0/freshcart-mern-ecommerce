import mongoose from 'mongoose'
import addressSchema from './address.js'

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0, validate: Number.isFinite },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  image: { type: String, trim: true },
  productType: { type: String, enum: ['grocery', 'hookah'], required: true },
  attributes: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
    validate: {
      validator: (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
      message: 'Attributes must be a plain object',
    },
  },
}, { _id: false })

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: {
    type: [orderItemSchema],
    required: true,
    validate: { validator: (items) => items.length > 0, message: 'An order must contain at least one item' },
  },
  address: { type: addressSchema, required: true },
  paymentMethod: { type: String, enum: ['cod', 'stripe'], required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  orderStatus: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  total: { type: Number, required: true, min: 0, validate: Number.isFinite },
  stripeSessionId: { type: String },
  stockReserved: { type: Boolean, default: false },
  stockDeducted: { type: Boolean, default: false },
  statusHistory: {
    type: [new mongoose.Schema({
      status: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], required: true },
      at: { type: Date, required: true },
    }, { _id: false })],
    default: [],
  },
}, { timestamps: true, optimisticConcurrency: true })

orderSchema.index({ user: 1, createdAt: -1 })
orderSchema.index({ orderStatus: 1, createdAt: -1 })
orderSchema.index({ stripeSessionId: 1 }, { unique: true, sparse: true })

export default mongoose.models.Order || mongoose.model('Order', orderSchema)