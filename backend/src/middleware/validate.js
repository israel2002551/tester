export function validate(schema, target = 'body') {
  return (req, _res, next) => {
    const value = schema.parse(req[target]);
    if (target === 'query') {
      for (const key of Object.keys(req.query)) delete req.query[key];
      Object.assign(req.query, value);
    } else {
      req[target] = value;
    }
    next();
  };
}
