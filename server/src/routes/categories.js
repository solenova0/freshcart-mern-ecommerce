import { Router } from 'express'
import Category from '../models/Category.js'
import Product from '../models/Product.js'
import { validate } from '../auth/validation.js'
import { createCategorySchema, idSchema, updateCategorySchema } from '../catalog/validation.js'
import { categoryImageUpload, productImagesUpload, cleanupImages, replaceCatalogImages } from '../catalog/images.js'
import { requireAdmin, requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { createCloudinaryImageService } from '../services/cloudinary.js'

export function createCategoryRouter(config, {
  CategoryModel = Category, ProductModel = Product, imageService = createCloudinaryImageService(config),
} = {}) {
  const router = Router()
  const adminWrite = [rejectCrossSiteMutation, requireAuth, requireAdmin]

  router.get('/', async (_req, res) => {
    const categories = await CategoryModel.find().sort({ name: 1, _id: 1 })
    res.json({ categories })
  })

  router.get('/:id', validate(idSchema, 'params'), async (req, res) => {
    const category = await CategoryModel.findById(req.params.id)
    if (!category) return res.status(404).json({ error: { message: 'Category not found' } })
    res.json({ category })
  })

  router.post('/', ...adminWrite, validate(createCategorySchema), async (req, res) => {
    const category = await CategoryModel.create(req.validated)
    res.status(201).json({ category })
  })

  router.patch('/:id', ...adminWrite, validate(idSchema, 'params'), validate(updateCategorySchema), async (req, res) => {
    const category = await CategoryModel.findById(req.params.id)
    if (!category) return res.status(404).json({ error: { message: 'Category not found' } })
    category.set(req.validated)
    await category.save()
    res.json({ category })
  })

  async function replaceImages(req, res) {
    const category = await CategoryModel.findById(req.params.id).select('+imagePublicId +imageAssets')
    if (!category) return res.status(404).json({ error: { message: 'Category not found' } })
    const { cleanupFailed } = await replaceCatalogImages({
      files: req.files || (req.file ? [req.file] : []),
      folder: `${config.cloudinaryFolder || 'freshcart'}/categories/${category.id}`,
      oldPublicIds: [category.imagePublicId, ...category.imageAssets.map((asset) => asset.publicId)], imageService,
      async persist(assets) {
        category.set({ image: assets[0].url, imagePublicId: assets[0].publicId, images: assets.map((asset) => asset.url), imageAssets: assets })
        await category.save()
      },
    })
    res.json({ category, cleanupFailed })
  }
  router.post('/:id/image', ...adminWrite, authRateLimit(20), validate(idSchema, 'params'), categoryImageUpload, replaceImages)
  router.post('/:id/images', ...adminWrite, authRateLimit(20), validate(idSchema, 'params'), productImagesUpload, replaceImages)

  router.delete('/:id', ...adminWrite, validate(idSchema, 'params'), async (req, res) => {
    const category = await CategoryModel.findById(req.params.id).select('+imagePublicId +imageAssets')
    if (!category) return res.status(404).json({ error: { message: 'Category not found' } })
    if (await ProductModel.exists({ category: category._id })) {
      return res.status(409).json({ error: { message: 'Move or delete the category products first' } })
    }
    const deleted = await CategoryModel.findOneAndDelete({ _id: category._id, __v: category.__v })
    if (!deleted) return res.status(409).json({ error: { message: 'Category changed. Please retry your request.' } })
    const cleanupFailed = await cleanupImages([category.imagePublicId, ...category.imageAssets.map((asset) => asset.publicId)], imageService)
    if (cleanupFailed) return res.json({ message: 'Category deleted', cleanupFailed: true })
    res.sendStatus(204)
  })

  return router
}