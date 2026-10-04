import jwt from 'jsonwebtoken'

export const sessionCookieName = 'freshcart_session'

export function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.cookieSameSite || 'lax',
    path: '/api',
  }
}

export function signSession(user, config) {
  return jwt.sign({ version: user.sessionVersion }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: user._id.toString(),
    issuer: 'freshcart-api',
    audience: 'freshcart-user',
    expiresIn: config.jwtTtlSeconds,
  })
}

export function verifySession(token, config) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: 'freshcart-api',
    audience: 'freshcart-user',
  })
}

export function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    address: user.address,
    ageConfirmed: user.ageConfirmed,
  }
}