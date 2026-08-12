export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: error.message || 'Internal server error',
    ...(error.details ? { details: error.details } : {})
  });
}
