import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: 'The requested API route does not exist.' },
    requestId: req.id,
  });
}

export function errorHandler(error, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong while processing the request.';
  let details;

  if (error instanceof AppError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'The submitted data is invalid.';
    details = error.flatten();
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with those details already exists.';
    } else if (error.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'The requested record could not be found.';
    }
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  }

  req.log?.error({ err: error, code, requestId: req.id }, 'request failed');
  const body = { success: false, error: { code, message }, requestId: req.id };
  if (details && process.env.NODE_ENV !== 'production') body.error.details = details;
  res.status(status).json(body);
}

