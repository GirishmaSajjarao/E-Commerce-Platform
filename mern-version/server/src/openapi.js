const str = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const choices = (...values) => ({ ...str, enum: values });
const json = schema => ({ 'application/json': { schema } });
const credentials = { email: { ...str, format: 'email' }, password: { ...str, format: 'password', minLength: 8 } };
const address = object({ name: str, phone: str, street: str, city: str, postalCode: str });
const payment = { idempotencyKey: { ...str, format: 'uuid' }, delivery: choices('standard', 'express'), address };
const checkout = { oneOf: [
  object({ ...payment, method: choices('card'), card: { ...str, description: 'Simulated test card only' } }),
  object({ ...payment, method: choices('upi'), upi: choices('success', 'failure') }),
  object({ ...payment, method: choices('cod') }),
] };
const product = { name: str, description: str, category: str, price: { ...integer, description: 'USD cents' }, stock: integer, active: boolean };
const thresholds = object({ threshold: { type: 'number', minimum: 0, maximum: 1 }, hallucination: { type: 'number', minimum: 0, maximum: 1 } });
const checkoutOperations = [['post', '/checkout'], ['post', '/payments/confirm']].map(([method, path]) => [method, path, 'Confirm checkout with an idempotency key', 'customer', 201, checkout]);
const endpoints = [
  ['get', '/health', 'Check API and database readiness'],
  ['post', '/auth/register', 'Create a customer account', '', 201, object({ ...credentials, name: str })],
  ['post', '/auth/login', 'Start a cookie session', '', 200, object(credentials)],
  ['post', '/auth/logout', 'Clear the cookie session', '', 204],
  ['get', '/auth/me', 'Read the active account', 'customer'],
  ['get', '/products', 'Search and sort active products'],
  ['get', '/products/{sku}', 'Read a product'],
  ['get', '/cart', 'Read the current cart and totals', 'customer'],
  ['put', '/cart/items/{sku}', 'Set a cart item quantity', 'customer', 200, object({ quantity: { ...integer, minimum: 1, maximum: 10 } })],
  ['delete', '/cart/items/{sku}', 'Remove a cart item', 'customer'],
  ...checkoutOperations,
  ['get', '/my/orders', 'List your orders', 'customer'],
  ['get', '/my/orders/{number}', 'Read your order and payment status', 'customer'],
  ['post', '/my/orders/{number}/cancel', 'Cancel an unshipped order', 'customer'],
  ['post', '/my/orders/{number}/return', 'Request a return for a delivered order', 'customer'],
  ['get', '/chat/conversations', 'List your conversations', 'customer'],
  ['post', '/chat/conversations', 'Start a conversation. Impersonation requires an admin session', 'customer', 201, object({ title: str, orderNumber: str, customerId: str }, [])],
  ['get', '/chat/conversations/{id}/messages', 'Read a conversation transcript', 'customer'],
  ['post', '/chat/conversations/{id}/messages', 'Send a customer support message', 'customer', 200, object({ content: { ...str, maxLength: 2000 } })],
  ['get', '/admin/orders', 'List orders', 'admin'],
  ['get', '/admin/orders/{number}', 'Read an order', 'admin'],
  ['patch', '/admin/orders/{number}/status', 'Advance an order to the next status', 'admin', 200,
    object({ status: choices('Processing', 'Shipped', 'Delivered'), carrier: str, tracking: str }, ['status'])],
  ['patch', '/admin/orders/{number}/return', 'Resolve a pending return', 'admin', 200, object({ decision: choices('Approved', 'Rejected') })],
  ...['payments', 'carts', 'customers', 'products', 'sales-summary', 'chats'].map(resource => ['get', '/admin/' + resource, 'Read ' + resource, 'admin']),
  ['get', '/admin/chats/{id}', 'Review conversation context and flags', 'admin'],
  ['post', '/admin/products', 'Add a product', 'admin', 201, object({ sku: str, ...product })],
  ['patch', '/admin/products/{sku}', 'Edit or disable a product', 'admin', 200, object(product, [])],
  ['post', '/qa/security/run', 'Queue response security checks', 'admin', 202],
  ['post', '/qa/promptfoo/run', 'Queue Promptfoo checks', 'admin', 202, object({ rubric: boolean }, [])],
  ['post', '/qa/eval/run', 'Queue external judging', 'admin', 202, object({ framework: choices('deepeval', 'ragas'), limit: integer }, ['framework'])],
  ['post', '/qa/eval-results', 'Ingest evaluation scores', 'evaluator', 204, object({
    runId: str, framework: choices('deepeval', 'ragas'), status: choices('completed', 'completed_with_errors', 'failed', 'skipped'), error: str,
    rows: { type: 'array', items: object({ key: str, metrics: { type: 'array', items: object({
      name: str, score: { type: 'number' }, threshold: { type: 'number' }, passed: boolean, reason: str,
    }, ['name', 'score', 'threshold', 'passed']) } }) },
  }, ['runId', 'framework', 'status', 'rows'])],
  ['get', '/qa/runs', 'List QA run history', 'admin'],
  ['get', '/qa/runs/{id}', 'Read a QA run and its saved results', 'admin'],
  ['get', '/qa/reports/{id}', 'Download a saved QA run as JSON', 'admin'],
  ['get', '/qa/settings', 'Read thresholds and model configuration', 'admin'],
  ['put', '/qa/settings', 'Set evaluation thresholds', 'admin', 200, thresholds],
  ['post', '/qa/test-connection', 'Test the configured chatbot provider', 'admin'],
];
const errors = {
  400: 'Invalid input', 401: 'Authentication required', 402: 'Payment declined', 403: 'Access denied',
  404: 'Record not found', 409: 'Conflict', 429: 'Too many requests', 500: 'Internal error',
};
const queries = { '/products': ['search', 'category', 'sort'], '/admin/orders': ['status'] };
const paths = {};
for (const [method, path, summary, role, success = 200, schema] of endpoints) {
  paths[path] ??= {};
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: str }));
  if (method === 'get') for (const name of queries[path] || []) parameters.push({ name, in: 'query', schema: str });
  paths[path][method] = {
    summary, tags: [path.split('/')[1]], parameters,
    ...(role ? { security: [{ [role === 'evaluator' ? 'evaluatorToken' : 'session']: [] }] } : {}),
    ...(schema ? { requestBody: { required: path !== '/qa/promptfoo/run', content: json(schema) } } : {}),
    responses: { [success]: { description: 'Success' }, ...Object.fromEntries(Object.entries(errors).map(([status, description]) =>
      [status, { description, content: json({ $ref: '#/components/schemas/Error' }) }])) },
  };
}

export const openapi = {
  openapi: '3.0.3', info: { title: 'Cedar Store and Support API', version: '1.0.0' }, servers: [{ url: '/api' }], paths,
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'session' }, evaluatorToken: { type: 'apiKey', in: 'header', name: 'X-Eval-Token' } },
    schemas: { Error: object({ error: object({ code: str, message: str, details: { type: 'array', items: { type: 'object' } } }, ['code', 'message']) }) },
  },
};
