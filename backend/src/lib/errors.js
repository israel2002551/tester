export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication is required.') => new AppError(401, 'AUTH_REQUIRED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} could not be found.`);
export const conflict = (code, message) => new AppError(409, code, message);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const tooManyRequests = (message = 'Too many requests.') => new AppError(429, 'RATE_LIMITED', message);
export const unavailable = (code, message) => new AppError(503, code, message);
