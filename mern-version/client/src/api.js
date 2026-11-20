export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api' + path, {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Request failed.'), { status: response.status });
  return data;
}
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const date = value => new Date(value).toLocaleDateString();
