import { randomUUID } from 'node:crypto';

export function requestContext(req, res, next) {
  const incoming = String(req.get('x-request-id') || '');
  req.id = /^[a-zA-Z0-9._:-]{8,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

