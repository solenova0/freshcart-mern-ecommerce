import mongoose from 'mongoose'
import { sessionCookieName, sessionCookieOptions, verifySession } from '../auth/session.js'

export async function requireAuth(req, res, next) {
  const { config, UserModel } = req.app.locals.auth
  const token = req.cookies?.[sessionCookieName]
  if (!token) return res.status(401).json({ error: { message: 'Authentication required' } })

  let payload
  try {
    payload = verifySession(token, config)
    if (!mongoose.isObjectIdOrHexString(payload.sub) || !Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw new Error('Invalid session claims')
    }
  } catch {
    res.clearCookie(sessionCookieName, sessionCookieOptions(config))
    return res.status(401).json({ error: { message: 'Invalid or expired session' } })
  }

  const user = await UserModel.findById(payload.sub).select('+sessionVersion')
  if (!user || user.sessionVersion !== payload.version) {
    res.clearCookie(sessionCookieName, sessionCookieOptions(config))
    return res.status(401).json({ error: { message: 'Invalid or expired session' } })
  }
  if (!user.isVerified) return res.status(403).json({ error: { message: 'Email verification required' } })

  req.user = user
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: { message: 'Authentication required' } })
  if (req.user.role !== 'admin' || !req.user.isVerified) {
    return res.status(403).json({ error: { message: 'Admin access required' } })
  }
  next()
}

export function rejectCrossSiteMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('Origin')
  const { corsOrigins, cookieSameSite } = req.app.locals.auth.config
  if (cookieSameSite === 'none' && !origin) {
    return res.status(403).json({ error: { message: 'Origin header is required for cross-site cookie requests' } })
  }
  if ((origin && !corsOrigins.includes(origin)) || (!origin && req.get('Sec-Fetch-Site') === 'cross-site')) {
    return res.status(403).json({ error: { message: 'Cross-site request denied' } })
  }
  next()
}