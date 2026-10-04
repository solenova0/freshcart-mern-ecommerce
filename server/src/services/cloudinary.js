import { v2 as cloudinary } from 'cloudinary'
import { randomUUID } from 'node:crypto'
import { Readable, pipeline } from 'node:stream'

function uploadError() {
  const error = new Error('Image storage is temporarily unavailable')
  error.status = 503
  return error
}

export function createCloudinaryImageService(config, uploader = cloudinary.uploader) {
  const credentials = {
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
  }

  return {
    upload(buffer, folder) {
      const publicId = `${folder}/${randomUUID()}`
      return new Promise((resolve, reject) => {
        try {
          const stream = uploader.upload_stream({
            ...credentials,
            public_id: publicId,
            overwrite: false,
            resource_type: 'image',
            allowed_formats: ['jpg', 'png', 'webp'],
            transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
            timeout: 10000,
          }, (error, result) => {
            if (error || !result?.secure_url?.startsWith('https://') || result.public_id !== publicId) {
              return reject(uploadError())
            }
            resolve({ url: result.secure_url, publicId: result.public_id })
          })
          pipeline(Readable.from(buffer), stream, (error) => {
            if (error) reject(uploadError())
          })
        } catch {
          reject(uploadError())
        }
      }).catch(async (error) => {
        try {
          await this.remove(publicId)
        } catch {
          console.error('Cloudinary cleanup failed for asset:', publicId)
        }
        throw error
      })
    },
    async remove(publicId) {
      try {
        const response = await uploader.destroy(publicId, { ...credentials, resource_type: 'image', invalidate: true, timeout: 10000 })
        if (!['ok', 'not found'].includes(response.result)) throw uploadError()
      } catch {
        throw uploadError()
      }
    },
  }
}