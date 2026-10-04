export function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.path}`)
  error.status = 404
  next(error)
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)

  let status = error.status || error.statusCode || 500
  if (error.name === 'ValidationError' || error.name === 'CastError') status = 400
  if (error.code === 11000) status = 409
  if (error.name === 'VersionError') status = 409
  if (error.name === 'MulterError') status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500

  const isProduction = req.app.get('env') === 'production'
  const message = status >= 500 && isProduction
    ? 'Internal server error'
    : error.name === 'VersionError' ? 'Resource changed. Please retry your request.'
      : error.code === 11000 ? 'Resource already exists' : error.message || 'Internal server error'

  if (status >= 500) console.error({ name: error.name, status, message: 'Server request failed' })
  res.status(status).json({
    error: {
      message,
      ...(!isProduction && error.stack ? { stack: error.stack } : {}),
    },
  })
}