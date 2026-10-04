import mongoose from 'mongoose'

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  },
  description: { type: String, trim: true, default: '' },
  image: { type: String, trim: true },
  imagePublicId: { type: String, select: false },
  images: { type: [String], default: [] },
  imageAssets: { type: [new mongoose.Schema({ url: String, publicId: String }, { _id: false })], default: [], select: false },
}, {
  timestamps: true,
  optimisticConcurrency: true,
  toJSON: {
    transform(_document, result) {
      delete result.imagePublicId
      delete result.imageAssets
      return result
    },
  },
})

export default mongoose.models.Category || mongoose.model('Category', categorySchema)