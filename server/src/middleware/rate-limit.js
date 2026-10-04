import { rateLimit } from 'express-rate-limit'

export function authRateLimit(limit, windowMs = 15 * 60000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many requests. Please try again later.' } },
  })
}