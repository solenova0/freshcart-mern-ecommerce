import mongoose from 'mongoose'

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false })

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: {
    type: [cartItemSchema],
    default: [],
    validate: {
      validator: (items) => new Set(items.map((item) => item.product?.toString())).size === items.length,
      message: 'Each product can appear only once in a cart',
    },
  },
}, { timestamps: true, optimisticConcurrency: true })

export default mongoose.models.Cart || mongoose.model('Cart', cartSchema)