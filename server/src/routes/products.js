import { Router } from 'express'
import Category from '../models/Category.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import { validate } from '../auth/validation.js'
import { buildProductQuery, createProductSchema, idSchema, productListSchema, updateProductSchema } from '../catalog/validation.js'
import { cleanupImages, productImagesUpload, replaceCatalogImages } from '../catalog/images.js'
import { requireAdmin, requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { createCloudinaryImageService } from '../services/cloudinary.js'

export function createProductRouter(config, {
  CategoryModel = Category, ProductModel = Product, OrderModel = Order, imageService = createCloudinaryImageService(config),
} = {}) {
  const router = Router()
  const adminWrite = [rejectCrossSiteMutation, requireAuth, requireAdmin]

  router.get('/best-sellers', async (_req, res) => {
    const sold = await OrderModel.aggregate([
      { $match: { paymentStatus: 'paid', orderStatus: { $ne: 'cancelled' } } },
      { $unwind: '$items' }, { $group: { _id: '$items.product', quantity: { $sum: '$items.quantity' } } },
      { $sort: { quantity: -1, _id: 1 } }, { $limit: 4 },
    ])
    const products = sold.length ? await ProductModel.find({ _id: { $in: sold.map((item) => item._id) } }).populate('category', 'name slug image') : []
    const byId = new Map(products.map((product) => [product.id, product]))
    res.json({ products: sold.map((item) => byId.get(item._id.toString())).filter(Boolean) })
  })

  router.get('/', validate(productListSchema, 'query'), async (req, res) => {
    const { filter, sort, skip, limit } = buildProductQuery(req.validated)
    const [products, total] = await Promise.all([
      ProductModel.find(filter).sort(sort).skip(skip).limit(limit).populate('category', 'name slug image'),
      ProductModel.countDocuments(filter),
    ])
    const { page } = req.validated
    res.json({ products, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })

  router.get('/:id', validate(idSchema, 'params'), async (req, res) => {
    const product = await ProductModel.findById(req.params.id).populate('category', 'name slug description image')
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } })
    res.json({ product })
  })

  router.post('/', ...adminWrite, validate(createProductSchema), async (req, res) => {
    if (!await CategoryModel.exists({ _id: req.validated.category })) {
      return res.status(400).json({ error: { message: 'Category does not exist' } })
    }
    const product = await ProductModel.create(req.validated)
    res.status(201).json({ product })
  })

  router.patch('/:id', ...adminWrite, validate(idSchema, 'params'), validate(updateProductSchema), async (req, res) => {
    const product = await ProductModel.findById(req.params.id)
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } })
    if (req.validated.category && !await CategoryModel.exists({ _id: req.validated.category })) {
      return res.status(400).json({ error: { message: 'Category does not exist' } })
    }
    if (req.validated.stock !== undefined && req.validated.stock < product.reservedStock) return res.status(409).json({ error: { message: 'Stock cannot be lower than active payment reservations' } })
    product.set(req.validated)
    await product.save()
    res.json({ product })
  })

  router.post('/:id/images', ...adminWrite, authRateLimit(20), validate(idSchema, 'params'), productImagesUpload, async (req, res) => {
    const product = await ProductModel.findById(req.params.id).select('+imageAssets')
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } })
    const { cleanupFailed } = await replaceCatalogImages({
      files: req.files,
      folder: `${config.cloudinaryFolder || 'freshcart'}/products/${product.id}`,
      oldPublicIds: product.imageAssets.map((asset) => asset.publicId), imageService,
      async persist(assets) {
        product.set({ images: assets.map((asset) => asset.url), imageAssets: assets })
        await product.save()
      },
    })
    res.json({ product, cleanupFailed })
  })

  router.delete('/:id', ...adminWrite, validate(idSchema, 'params'), async (req, res) => {
    const product = await ProductModel.findById(req.params.id).select('+imageAssets')
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } })
    if (product.reservedStock > 0) return res.status(409).json({ error: { message: 'Products with active payment reservations cannot be deleted' } })
    const deleted = await ProductModel.findOneAndDelete({ _id: product._id, __v: product.__v, reservedStock: 0 })
    if (!deleted) return res.status(409).json({ error: { message: 'Product changed. Please retry your request.' } })
    const cleanupFailed = await cleanupImages(product.imageAssets.map((asset) => asset.publicId), imageService)
    if (cleanupFailed) return res.json({ message: 'Product deleted', cleanupFailed: true })
    res.sendStatus(204)
  })

  return router
}