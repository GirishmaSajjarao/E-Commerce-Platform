import React, { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, date, money } from './api.js';

export function RequestState({ query }) {
  if (query.isPending) return <p role="status">Loading…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  return null;
}
export function Totals({ totals }) {
  return <dl className="totals">{Object.entries(totals).map(([key, value]) =>
    <div key={key}><dt>{key}</dt><dd>{money(value)}</dd></div>)}</dl>;
}
function Stock({ stock }) {
  return <span className="stock">{stock === 0 ? 'Out of stock' : stock <= 5 ? `Only ${stock} left` : 'In stock'}</span>;
}
function Add({ product, user }) {
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const cart = await api('/cart');
      const quantity = (cart.items.find(item => item.sku === product.sku)?.quantity || 0) + 1;
      return api('/cart/items/' + product.sku, { method: 'PUT', body: { quantity } });
    },
    onSuccess: cart => cache.setQueryData(['cart', user.id], cart),
  });
  if (!user) return <Link to="/login">Sign in to shop</Link>;
  return <div><button data-testid={`add-${product.sku}`} disabled={!product.stock || mutation.isPending} onClick={() => mutation.mutate()}>
    {mutation.isSuccess ? 'Add another' : 'Add to cart'}
  </button>
  {mutation.isSuccess && <span role="status"> Added to cart</span>}
  {mutation.error && <p role="alert">{mutation.error.message}</p>}</div>;
}

export function Shop({ user }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('name');
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api('/products') });
  const query = new URLSearchParams({ search, sort });
  if (category) query.set('category', category);
  const results = useQuery({ queryKey: ['catalog', query.toString()], queryFn: () => api('/products?' + query) });
  return <>
    <section className="hero"><h1>Shop the store</h1><p>Find electronics, home essentials, and outdoor gear.</p></section>
    <div className="filters">
      <label>Search <input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Category <select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>
        {[...new Set((catalog.data || []).map(product => product.category))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Sort <select value={sort} onChange={e => setSort(e.target.value)}>
        <option value="name">Name</option><option value="price-asc">Price low to high</option><option value="price-desc">Price high to low</option>
      </select></label>
    </div>
    <RequestState query={results} />
    {results.data?.length === 0 && <p>No products match your filters.</p>}
    <div className="cards">{results.data?.map(product => <article className="card" key={product.sku}>
      <p className="muted">{product.category}</p><h2><Link to={`/products/${product.sku}`}>{product.name}</Link></h2>
      <p>{product.description}</p><div className="price"><strong>{money(product.price)}</strong><Stock stock={product.stock} /></div>
      <Add product={product} user={user} />
    </article>)}</div>
  </>;
}

export function ProductDetail({ user }) {
  const { sku } = useParams();
  const product = useQuery({ queryKey: ['product', sku], queryFn: () => api('/products/' + sku) });
  if (!product.data) return <RequestState query={product} />;
  return <article className="card"><Link to="/">Back to shop</Link><h1>{product.data.name}</h1><p>{product.data.description}</p>
    <p>{money(product.data.price)} · <Stock stock={product.data.stock} /></p><Add product={product.data} user={user} /></article>;
}

const cartQuery = user => ({ queryKey: ['cart', user.id], queryFn: () => api('/cart') });
export function CartPage({ user }) {
  const cache = useQueryClient();
  const cart = useQuery(cartQuery(user));
  const change = useMutation({
    mutationFn: ({ sku, quantity }) => api('/cart/items/' + sku, { method: quantity ? 'PUT' : 'DELETE', body: quantity ? { quantity } : undefined }),
    onSuccess: data => cache.setQueryData(['cart', user.id], data),
  });
  return <><h1>Your cart</h1><RequestState query={cart} />
    {cart.data?.items.length === 0 && <p>Your cart is empty. <Link to="/">Continue shopping</Link></p>}
    {!!cart.data?.items.length && <div className="split"><section className="card">
      {cart.data.items.map(item => <div className="line" key={item.sku}>
        <div><Link to={`/products/${item.sku}`}>{item.name}</Link><p>{money(item.unitPrice)} each</p></div>
        <label>Quantity for {item.name}<select value={item.quantity} disabled={change.isPending}
          onChange={e => change.mutate({ sku: item.sku, quantity: Number(e.target.value) })}>
          {Array.from({ length: Math.max(item.quantity, Math.min(10, item.stock)) }, (_, i) => i + 1).map(value => <option key={value}>{value}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={change.isPending} onClick={() => change.mutate({ sku: item.sku, quantity: 0 })}>Remove</button>
      </div>)}
      {change.error && <p role="alert">{change.error.message}</p>}
    </section><aside className="card"><h2>Order summary</h2><Totals totals={cart.data.totals} /><Link className="button" to="/checkout">Checkout</Link></aside></div>}
  </>;
}

export function CheckoutForm({ cart, submit, error, busy }) {
  const [delivery, setDelivery] = useState('standard');
  const [method, setMethod] = useState('card');
  return <form className="split" onSubmit={event => {
    event.preventDefault();
    const { name, phone, street, city, postalCode, card, upi } = Object.fromEntries(new FormData(event.currentTarget));
    submit({ address: { name, phone, street, city, postalCode }, method, delivery,
      ...(method === 'card' ? { card } : method === 'upi' ? { upi } : {}) });
  }}>
    <section className="card fieldset">
      <h2>Shipping address</h2>
      <label>Full name<input name="name" autoComplete="name" required maxLength={100} /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={20} /></label>
      <label>Street address<input name="street" autoComplete="street-address" required minLength={3} maxLength={200} /></label>
      <label>City<input name="city" autoComplete="address-level2" required maxLength={100} /></label>
      <label>Postal code<input name="postalCode" autoComplete="postal-code" required minLength={3} maxLength={16} /></label>
      <label>Delivery<select value={delivery} onChange={e => setDelivery(e.target.value)}>
        <option value="standard">Standard · 3–5 days</option><option value="express">Express · 1–2 days</option>
      </select></label>
      <h2>Payment · TEST MODE</h2>
      <label>Payment method<select value={method} onChange={e => setMethod(e.target.value)}>
        <option value="card">Test card</option><option value="upi">Simulated UPI</option><option value="cod">Cash on delivery</option>
      </select></label>
      {method === 'card' && <label>Test card number<input name="card" inputMode="numeric" autoComplete="off" required maxLength={25} /></label>}
      {method === 'upi' && <label>Simulated result<select name="upi"><option value="success">Success</option><option value="failure">Failure</option></select></label>}
    </section>
    <aside className="card"><h2>Order summary</h2><Totals totals={delivery === 'express' ? cart.expressTotals : cart.totals} />
      {error && <p role="alert">{error}</p>}<button disabled={busy || !cart.items.length}>{busy ? 'Placing order…' : 'Place order'}</button></aside>
  </form>;
}

export function CheckoutPage({ user }) {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const cart = useQuery(cartQuery(user));
  const attempt = useRef(null);
  const locked = useRef(false);
  const checkout = useMutation({
    mutationFn: async fields => {
      if (!attempt.current) attempt.current = crypto.randomUUID();
      try { return await api('/checkout', { method: 'POST', body: { ...fields, idempotencyKey: attempt.current } }); }
      catch (error) { if (error.status && error.status < 500) attempt.current = null; throw error; }
    },
    onSuccess: result => {
      cache.removeQueries({ queryKey: ['cart', user.id] });
      cache.invalidateQueries({ queryKey: ['orders', user.id] });
      navigate('/orders/' + result.order.number, { state: { confirmed: true } });
    },
    onSettled: () => { locked.current = false; },
  });
  return <><h1>Checkout</h1><RequestState query={cart} />
    {cart.data?.items.length ? <CheckoutForm cart={cart.data} busy={checkout.isPending} error={checkout.error?.message} submit={fields => {
      if (locked.current) return;
      locked.current = true;
      checkout.mutate(fields);
    }} /> : cart.data && <p>Your cart is empty. <Link to="/">Continue shopping</Link></p>}
  </>;
}

export function OrdersPage({ user }) {
  const orders = useQuery({ queryKey: ['orders', user.id], queryFn: () => api('/my/orders') });
  return <><h1>My orders</h1><RequestState query={orders} />
    {orders.data?.length === 0 && <p>You haven’t placed any orders.</p>}
    {orders.data?.map(order => <article className="card order" key={order.number}>
      <h2><Link to={`/orders/${order.number}`}>{order.number}</Link></h2>
      <p>{order.status} · {money(order.total)}</p><p>{order.items.map(item => item.name).join(', ')}</p>
    </article>)}
  </>;
}

export function OrderDetail({ user, confirmed }) {
  const { number } = useParams();
  const cache = useQueryClient();
  const key = ['orders', user.id, number];
  const query = useQuery({ queryKey: key, queryFn: () => api('/my/orders/' + number) });
  const mutation = useMutation({
    mutationFn: action => api(`/my/orders/${number}/${action}`, { method: 'POST' }),
    onSuccess: data => { cache.setQueryData(key, data); cache.invalidateQueries({ queryKey: ['orders', user.id], exact: true }); },
  });
  const order = query.data;
  if (!order) return <RequestState query={query} />;
  const returnable = order.status === 'Delivered' && order.returnStatus === 'None' && Date.now() - Date.parse(order.deliveredAt) <= 30 * 86_400_000;
  return <><Link to="/orders">My orders</Link>{confirmed && <p role="status">Your order was placed.</p>}<h1>{order.number}</h1>
    <div className="split"><section className="card">
      <h2>{order.status}</h2><p>Payment: {order.payment?.status || 'Unavailable'}</p>
      {order.deliveryEstimate?.from && <p>Estimated delivery: {date(order.deliveryEstimate.from)} – {date(order.deliveryEstimate.to)}</p>}
      {order.tracking && <p data-testid="tracking">Tracking: {order.carrier} · {order.tracking}</p>}
      {order.returnStatus !== 'None' && <p>Return: {order.returnStatus}</p>}
      <h3>Order timeline</h3><ol>{order.statusHistory.map((entry, index) => <li key={index}>{entry.status} · {date(entry.at)}</li>)}</ol>
      {['Processing', 'PendingPayment'].includes(order.status) && <button className="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('cancel')}>Cancel order</button>}
      {returnable && <button className="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('return')}>Request return</button>}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </section><aside className="card"><h2>Items</h2><ul>{order.items.map(item => <li key={item.product}>{item.quantity} × {item.name}</li>)}</ul>
      <Totals totals={{ subtotal: order.subtotal, shipping: order.shipping, tax: order.tax, total: order.total }} /></aside></div></>;
}
