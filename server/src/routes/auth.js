import { Router } from 'express'
import bcrypt from 'bcrypt'
import User from '../models/User.js'
import { createVerificationToken, hashVerificationToken } from '../auth/tokens.js'
import { publicUser, sessionCookieName, sessionCookieOptions, signSession } from '../auth/session.js'
import { loginSchema, registerSchema, resendVerificationSchema, validate, verifyEmailSchema } from '../auth/validation.js'
import { requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rate-limit.js'
import { createVerificationMailer } from '../services/brevo.js'

const registrationMessage = 'Check your email for a verification link. If you already have an account, sign in or request a new link.'
const resendMessage = 'If this account needs verification and is eligible, a new link has been sent.'
const dummyPasswordHash = '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW'

export function createAuthRouter(config, { UserModel = User, sendVerificationEmail = createVerificationMailer(config) } = {}) {
  const router = Router()
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.use(authRateLimit(100))
  router.use(rejectCrossSiteMutation)

  async function deliverVerification(user, verification) {
    try {
      await sendVerificationEmail({ email: user.email, name: user.name, token: verification.token })
    } catch (error) {
      await UserModel.updateOne({ _id: user._id, isVerified: false, verificationTokenHash: verification.tokenHash }, {
        $unset: { verificationTokenHash: 1, verificationTokenExpiresAt: 1, verificationEmailSentAt: 1 },
      })
      throw error
    }
  }

  router.post('/register', authRateLimit(5, 60 * 60000), validate(registerSchema), async (req, res) => {
    const { name, email, password, ageConfirmed } = req.validated
    const passwordHash = await bcrypt.hash(password, 12)
    const verification = createVerificationToken(config.verificationTtlMinutes)
    let user
    try {
      user = await UserModel.create({
        name, email, passwordHash, ageConfirmed,
        role: 'user', isVerified: false,
        verificationTokenHash: verification.tokenHash,
        verificationTokenExpiresAt: verification.expiresAt,
        verificationEmailSentAt: new Date(),
      })
    } catch (error) {
      if (error.code === 11000) return res.status(202).json({ message: registrationMessage })
      throw error
    }
    await deliverVerification(user, verification)
    res.status(202).json({ message: registrationMessage })
  })

  router.get('/verify-email', authRateLimit(20), validate(verifyEmailSchema, 'query'), async (req, res) => {
    const user = await UserModel.findOneAndUpdate({
      verificationTokenHash: hashVerificationToken(req.validated.token),
      verificationTokenExpiresAt: { $gt: new Date() },
      isVerified: false,
    }, {
      $set: { isVerified: true },
      $unset: { verificationTokenHash: 1, verificationTokenExpiresAt: 1, verificationEmailSentAt: 1 },
    }, { new: true, runValidators: true })
    if (!user) return res.status(400).json({ error: { message: 'Invalid or expired verification link' } })
    res.json({ message: 'Email verified. You can now sign in.' })
  })

  router.post('/login', authRateLimit(10), validate(loginSchema), async (req, res) => {
    const { email, password } = req.validated
    const user = await UserModel.findOne({ email }).select('+passwordHash +sessionVersion')
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash || dummyPasswordHash)
    if (!user || !passwordMatches) return res.status(401).json({ error: { message: 'Invalid email or password' } })
    if (!user.isVerified) return res.status(403).json({ error: { message: 'Email verification required' } })
    res.cookie(sessionCookieName, signSession(user, config), {
      ...sessionCookieOptions(config), maxAge: config.jwtTtlSeconds * 1000,
    })
    res.json({ user: publicUser(user) })
  })

  router.post('/logout', requireAuth, async (req, res) => {
    await UserModel.updateOne({ _id: req.user._id, sessionVersion: req.user.sessionVersion }, { $inc: { sessionVersion: 1 } })
    res.clearCookie(sessionCookieName, sessionCookieOptions(config))
    res.sendStatus(204)
  })

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) })
  })

  router.post('/resend-verification', authRateLimit(5), validate(resendVerificationSchema), async (req, res) => {
    const verification = createVerificationToken(config.verificationTtlMinutes)
    const user = await UserModel.findOneAndUpdate({
      email: req.validated.email,
      isVerified: false,
      $or: [
        { verificationEmailSentAt: { $exists: false } },
        { verificationEmailSentAt: null },
        { verificationEmailSentAt: { $lte: new Date(Date.now() - 60000) } },
      ],
    }, {
      $set: {
        verificationTokenHash: verification.tokenHash,
        verificationTokenExpiresAt: verification.expiresAt,
        verificationEmailSentAt: new Date(),
      },
    }, { new: true, runValidators: true })
    if (user) await deliverVerification(user, verification)
    res.status(202).json({ message: resendMessage })
  })

  return router
}