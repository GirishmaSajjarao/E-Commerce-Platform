export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
export const route = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);

export function rejectUnsafeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new HttpError(400, 'INVALID_INPUT', 'Unsupported field name.');
    }
    rejectUnsafeKeys(nested);
  }
}

export function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.name === 'ZodError') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check the submitted fields.', details: error.issues.map(({ path, message }) => ({ path, message })) } });
  }
  if (error.code === 11000) return res.status(409).json({ error: { code: 'CONFLICT', message: 'This record already exists.' } });
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res.status(error.status).json({ error: { code: 'INVALID_BODY', message: 'Request body is invalid or too large.' } });
  }
  req.log?.error({ errorType: error.name }, 'Request failed');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
}
