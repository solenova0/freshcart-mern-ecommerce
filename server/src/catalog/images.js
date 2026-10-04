import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'

const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxFileSize = 5 * 1024 * 1024

function imageError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function createImageUpload(maxFiles) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize, files: maxFiles, fields: 0, parts: maxFiles },
    fileFilter(_req, file, callback) {
      if (!imageMimeTypes.has(file.mimetype)) return callback(imageError('Only JPEG, PNG, and WebP images are allowed', 415))
      callback(null, true)
    },
  })
}

export const productImagesUpload = createImageUpload(5).array('images', 5)
export const categoryImageUpload = createImageUpload(1).single('image')

export async function cleanupImages(publicIds, imageService) {
  let failed = false
  for (const publicId of new Set(publicIds.filter(Boolean))) {
    try {
      await imageService.remove(publicId)
    } catch {
      failed = true
      console.error('Cloudinary cleanup failed for asset:', publicId)
    }
  }
  return failed
}

export async function replaceCatalogImages({ files, folder, oldPublicIds, imageService, persist }) {
  if (!files?.length) throw imageError('At least one image is required', 400)
  for (const file of files) {
    if (file.buffer.length > maxFileSize) throw imageError('File too large', 413)
    let type
    try {
      type = await fileTypeFromBuffer(file.buffer)
    } catch {
      throw imageError('Invalid image data', 415)
    }
    if (!type || !imageMimeTypes.has(type.mime) || type.mime !== file.mimetype) {
      throw imageError('Image data must match its JPEG, PNG, or WebP content type', 415)
    }
  }

  const assets = []
  try {
    for (const file of files) assets.push(await imageService.upload(file.buffer, folder))
    await persist(assets)
  } catch (error) {
    await cleanupImages(assets.map((asset) => asset.publicId), imageService)
    throw error
  }
  const cleanupFailed = await cleanupImages(oldPublicIds, imageService)
  return { assets, cleanupFailed }
}