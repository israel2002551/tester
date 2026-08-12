function jsonSafe(value, seen = new WeakSet()) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return null;
    seen.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item, seen)]));
  }
  return value;
}

export function success(res, data, meta, status = 200) {
  const body = { success: true, data: jsonSafe(data) };
  if (meta && Object.keys(meta).length) body.meta = jsonSafe(meta);
  return res.status(status).json(body);
}

export function created(res, data, meta) {
  return success(res, data, meta, 201);
}

export function pageMeta(page, limit, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function pagination(query, { defaultLimit = 24, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

