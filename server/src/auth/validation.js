import { z } from 'zod'

const email = z.string().trim().toLowerCase().max(254).pipe(z.email())
const password = z.string().min(8).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
  message: 'Password must not exceed 72 UTF-8 bytes',
})

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email,
  password,
  ageConfirmed: z.boolean().optional().default(false),
})

export const loginSchema = z.strictObject({ email, password })
export const resendVerificationSchema = z.strictObject({ email })
export const verifyEmailSchema = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) })

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      return res.status(400).json({
        error: {
          message: 'Invalid request',
          issues: result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
        },
      })
    }
    req.validated = result.data
    next()
  }
}