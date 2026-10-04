import { Router } from 'express'
import User from '../models/User.js'
import { validate } from '../auth/validation.js'
import { requireAuth, rejectCrossSiteMutation } from '../middleware/auth.js'
import { shippingAddressSchema } from '../commerce/validation.js'

export function createUserRouter(_config, { UserModel = User } = {}) {
  const router = Router()
  router.use(rejectCrossSiteMutation, requireAuth)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  router.put('/me/address', validate(shippingAddressSchema), async (req, res) => {
    const user = await UserModel.findOneAndUpdate({ _id: req.user._id }, { $set: { address: req.validated } }, {
      new: true, runValidators: true,
    })
    if (!user) return res.status(404).json({ error: { message: 'User not found' } })
    res.json({ address: user.address })
  })

  return router
}