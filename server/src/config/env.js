import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

export function parseEnvironment(values) {
  const nodeEnv = values.NODE_ENV || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production')
  }

  const port = Number(values.PORT || 5000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  const mongoUri = values.MONGODB_URI?.trim()
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
    throw new Error('MONGODB_URI must be a MongoDB connection URI')
  }

  const corsOrigins = [...new Set((values.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean))]
  for (const origin of corsOrigins) {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes')
    }
  }

  const jwtSecret = values.JWT_SECRET?.trim()
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes of random secret material')
  }
  const jwtTtlSeconds = Number(values.JWT_TTL_SECONDS || 86400)
  if (!Number.isInteger(jwtTtlSeconds) || jwtTtlSeconds < 60 || jwtTtlSeconds > 604800) {
    throw new Error('JWT_TTL_SECONDS must be between 60 and 604800')
  }
  const verificationTtlMinutes = Number(values.VERIFICATION_TOKEN_TTL_MINUTES || 60)
  if (!Number.isInteger(verificationTtlMinutes) || verificationTtlMinutes < 1 || verificationTtlMinutes > 1440) {
    throw new Error('VERIFICATION_TOKEN_TTL_MINUTES must be between 1 and 1440')
  }
  const apiPublicUrl = values.API_PUBLIC_URL || `http://localhost:${port}`
  const publicUrl = new URL(apiPublicUrl)
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.origin !== apiPublicUrl) {
    throw new Error('API_PUBLIC_URL must be an HTTP(S) origin without a path or trailing slash')
  }
  if (nodeEnv === 'production' && publicUrl.protocol !== 'https:') {
    throw new Error('API_PUBLIC_URL must use HTTPS in production')
  }
  const brevoApiKey = values.BREVO_API_KEY?.trim()
  const brevoSenderEmail = values.BREVO_SENDER_EMAIL?.trim()
  if (!brevoApiKey) throw new Error('BREVO_API_KEY is required')
  if (!brevoSenderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brevoSenderEmail)) {
    throw new Error('BREVO_SENDER_EMAIL must be a valid verified sender email')
  }

  const cloudinaryCloudName = values.CLOUDINARY_CLOUD_NAME?.trim()
  const cloudinaryApiKey = values.CLOUDINARY_API_KEY?.trim()
  const cloudinaryApiSecret = values.CLOUDINARY_API_SECRET?.trim()
  const cloudinaryFolder = values.CLOUDINARY_FOLDER?.trim() || 'freshcart'
  if (!cloudinaryCloudName || !/^[a-z0-9_-]+$/i.test(cloudinaryCloudName)) throw new Error('CLOUDINARY_CLOUD_NAME is required and must be valid')
  if (!cloudinaryApiKey) throw new Error('CLOUDINARY_API_KEY is required')
  if (!cloudinaryApiSecret) throw new Error('CLOUDINARY_API_SECRET is required')
  if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(cloudinaryFolder)) throw new Error('CLOUDINARY_FOLDER must be a valid folder path')
  const storefrontUrl = values.STOREFRONT_URL || 'http://localhost:5173'
  const storefrontOrigin = new URL(storefrontUrl)
  if (storefrontOrigin.origin !== storefrontUrl || !['http:', 'https:'].includes(storefrontOrigin.protocol)) throw new Error('STOREFRONT_URL must be an HTTP(S) origin')
  if (nodeEnv === 'production' && storefrontOrigin.protocol !== 'https:') throw new Error('STOREFRONT_URL must use HTTPS in production')
  const cookieSameSite = values.COOKIE_SAME_SITE || 'lax'
  if (!['lax', 'none'].includes(cookieSameSite) || (cookieSameSite === 'none' && nodeEnv !== 'production')) throw new Error('COOKIE_SAME_SITE must be lax, or none in HTTPS production')
  const trustProxy = Number(values.TRUST_PROXY || 0)
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) throw new Error('TRUST_PROXY must be an integer from 0 to 5')
  const stripeSecretKey = values.STRIPE_SECRET_KEY?.trim()
  const stripeWebhookSecret = values.STRIPE_WEBHOOK_SECRET?.trim()
  if (Boolean(stripeSecretKey) !== Boolean(stripeWebhookSecret)) throw new Error('Configure both Stripe secrets or leave both blank to disable card payments')

  return {
    nodeEnv, port, mongoUri, corsOrigins, jwtSecret, jwtTtlSeconds,
    verificationTtlMinutes, apiPublicUrl, brevoApiKey, brevoSenderEmail,
    brevoSenderName: values.BREVO_SENDER_NAME?.trim() || 'FreshCart',
    cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret, cloudinaryFolder,
    storefrontUrl, cookieSameSite, trustProxy, stripeSecretKey, stripeWebhookSecret,
  }
}

export function loadEnvironment() {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
  return parseEnvironment(process.env)
}