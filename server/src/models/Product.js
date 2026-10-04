import mongoose from 'mongoose'

const imageAssetSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
}, { _id: false })

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  price: { type: Number, required: true, min: 0, validate: Number.isFinite },
  stock: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  reservedStock: { type: Number, min: 0, default: 0, validate: Number.isSafeInteger },
  images: { type: [{ type: String, trim: true, required: true }], default: [] },
  imageAssets: { type: [imageAssetSchema], default: [], select: false },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  productType: { type: String, enum: ['grocery', 'hookah'], default: 'grocery', required: true },
  attributes: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
    validate: {
      validator: (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
      message: 'Attributes must be a plain object',
    },
  },
}, {
  timestamps: true,
  optimisticConcurrency: true,
  toJSON: {
    transform(_document, result) {
      delete result.imageAssets
      return result
    },
  },
})

productSchema.index({ name: 'text', description: 'text' }, {
  name: 'product_text_search',
  weights: { name: 10, description: 2 },
})
productSchema.index({ category: 1, productType: 1 })

export default mongoose.models.Product || mongoose.model('Product', productSchema)