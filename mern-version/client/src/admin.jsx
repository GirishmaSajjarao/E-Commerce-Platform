import React, { useState } from 'react';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { api, date, money } from './api.js';
import { RequestState, Totals } from './store.jsx';
import { AdminChats, SecurityPage } from './chat.jsx';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);
const queryFor = path => ({ queryKey: ['admin', path], queryFn: () => api('/admin/' + path) });
function Table({ columns, rows }) {
  if (!rows.length) return <p>No records to display.</p>;
  return <div className="table-scroll"><table>
    <thead><tr>{columns.map(([heading]) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row._id}>{columns.map(([heading, value]) => <td key={heading}>{value(row) ?? '—'}</td>)}</tr>)}</tbody>
  </table></div>;
}
const fields = (...names) => names.map(name => [name[0].toUpperCase() + name.slice(1), row => row[name]]);
const columns = {
  payments: [['Order', row => row.order?.number], ...fields('provider', 'method', 'status'), ['Amount', row => money(row.amount)], ['Date', row => date(row.createdAt)]],
  customers: fields('customerId', 'name', 'email', 'phone'),
  carts: [['Customer', row => row.user?.name], ['Items', row => row.items.map(item => `${item.quantity} × ${item.product?.name || 'Unavailable'}`).join(', ')], ...fields('state'), ['Updated', row => date(row.updatedAt)]],
};
function Records({ resource }) {
  const query = useQuery(queryFor(resource));
  return <><h1>{resource[0].toUpperCase() + resource.slice(1)}</h1><RequestState query={query} />
    {query.data && <Table columns={columns[resource]} rows={query.data} />}</>;
}
function Sales() {
  const query = useQuery(queryFor('sales-summary'));
  const sales = query.data;
  return <><h1>Sales dashboard</h1><RequestState query={query} />
    {sales && <><div className="cards">
      <section className="card"><h2>Revenue</h2><strong>{money(sales.revenue)}</strong></section>
      <section className="card"><h2>Payment success rate</h2><strong>{sales.paymentSuccessRate === null ? 'No completed attempts' : `${(sales.paymentSuccessRate * 100).toFixed(1)}%`}</strong></section>
    </div><div className="split admin-block">
      <section className="card"><h2>Orders per day</h2>
      {sales.ordersPerDay.length ? <Bar role="img" aria-label="Orders per day" data={{
        labels: sales.ordersPerDay.map(row => row.date), datasets: [{ label: 'Orders', data: sales.ordersPerDay.map(row => row.count), backgroundColor: '#35735e' }],
      }} options={{ scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} /> : <p>No orders recorded.</p>}</section>
      <section className="card"><h2>Top products</h2><Table rows={sales.topProducts} columns={fields('name', 'quantity')} />
        <h2>Low stock</h2><Table rows={sales.lowStock} columns={fields('sku', 'name', 'stock')} /></section>
    </div></>}
  </>;
}
const statuses = ['PendingPayment', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'PaymentFailed'];
function AdminOrders() {
  const [status, setStatus] = useState('');
  const query = useQuery(queryFor('orders' + (status ? '?status=' + status : '')));
  return <><h1>Orders</h1><label className="narrow">Filter by status<select value={status} onChange={e => setStatus(e.target.value)}>
    <option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
    <RequestState query={query} />{query.data && <Table rows={query.data} columns={[
      ['Order', row => <Link to={`/admin/orders/${row.number}`}>{row.number}</Link>],
      ...fields('status', 'returnStatus'), ['Total', row => money(row.total)],
    ]} />}</>;
}
function AdminOrder() {
  const { number } = useParams();
  const path = 'orders/' + number;
  const cache = useQueryClient();
  const query = useQuery(queryFor(path));
  const update = useMutation({
    mutationFn: ({ action, ...body }) => api('/admin/' + path + '/' + action, { method: 'PATCH', body }),
    onSuccess: order => {
      cache.invalidateQueries({ queryKey: ['admin'] });
      cache.setQueryData(queryFor(path).queryKey, order);
    },
  });
  const order = query.data;
  if (!order) return <RequestState query={query} />;
  const next = { PendingPayment: 'Processing', Processing: 'Shipped', Shipped: 'Delivered' }[order.status];
  return <><Link to="/admin/orders">All orders</Link><h1>{number}</h1><div className="split">
    <section className="card"><h2>{order.status}</h2><p>Payment: {order.payment?.status || 'Unavailable'}</p>
      {order.tracking && <p>{order.carrier} · {order.tracking}</p>}
      {next && <form className="fieldset" onSubmit={event => {
        event.preventDefault();
        update.mutate({ action: 'status', status: next, ...Object.fromEntries(new FormData(event.currentTarget)) });
      }}>
        {next === 'Shipped' && <><label>Carrier<input name="carrier" maxLength={100} required /></label><label>Tracking number<input name="tracking" maxLength={100} required /></label></>}
        <button disabled={update.isPending}>Mark as {next}</button>
      </form>}
      {order.returnStatus !== 'None' && <p>Return: {order.returnStatus}</p>}
      {order.returnStatus === 'Requested' && <div className="line">{['Approved', 'Rejected'].map(decision =>
        <button key={decision} disabled={update.isPending} onClick={() => update.mutate({ action: 'return', decision })}>{decision === 'Approved' ? 'Approve return' : 'Reject return'}</button>)}</div>}
      {update.error && <p role="alert">{update.error.message}</p>}
      <h3>Status history</h3><ol>{order.statusHistory.map((entry, index) => <li key={index}>{entry.status} · {date(entry.at)}</li>)}</ol>
    </section><aside className="card"><h2>Details</h2>
      {order.address?.name && <p>{[order.address.name, order.address.street, order.address.city, order.address.postalCode].join(', ')}</p>}
      <ul>{order.items.map(item => <li key={item.product}>{item.quantity} × {item.name}</li>)}</ul>
      <Totals totals={{ subtotal: order.subtotal, shipping: order.shipping, tax: order.tax, total: order.total }} />
    </aside></div></>;
}
function ProductForm({ product, save, busy, close }) {
  return <form className="card fieldset" onSubmit={event => {
    event.preventDefault();
    const { price, stock, active, ...data } = Object.fromEntries(new FormData(event.currentTarget));
    save({ ...data, price: Math.round(Number(price) * 100), stock: Number(stock), active: active === 'on' });
  }}>
    <h2>{product ? 'Edit ' + product.sku : 'Add product'}</h2>
    {!product && <label>SKU<input name="sku" pattern="[A-Z0-9-]+" maxLength={32} required /></label>}
    {['name', 'description', 'category'].map(key => <label key={key}>{key[0].toUpperCase() + key.slice(1)}
      <input name={key} defaultValue={product?.[key]} required /></label>)}
    <label>Price in USD<input type="number" name="price" min="0" step=".01" required defaultValue={product ? product.price / 100 : ''} /></label>
    <label>Stock<input type="number" name="stock" min="0" required defaultValue={product?.stock} /></label>
    <label className="line"><input className="check" type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Listed in shop</label>
    <div className="line"><button disabled={busy}>Save product</button><button className="secondary" type="button" onClick={close}>Close</button></div>
  </form>;
}
function Inventory() {
  const [editing, setEditing] = useState(null);
  const cache = useQueryClient();
  const query = useQuery(queryFor('products'));
  const update = useMutation({
    mutationFn: fields => api('/admin/products' + (editing?.sku ? '/' + editing.sku : ''), { method: editing?.sku ? 'PATCH' : 'POST', body: fields }),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['admin'] }); cache.invalidateQueries({ queryKey: ['catalog'] }); cache.invalidateQueries({ queryKey: ['product'] }); setEditing(null); },
  });
  return <><h1>Inventory</h1><button onClick={() => { update.reset(); setEditing({}); }}>Add product</button>
    {editing && <div className="admin-block"><ProductForm key={editing.sku || 'new'} product={editing.sku ? editing : null} save={update.mutate} busy={update.isPending} close={() => setEditing(null)} />
      {update.error && <p role="alert">{update.error.message}</p>}</div>}
    <RequestState query={query} />{query.data && <Table rows={query.data} columns={[
      ...fields('sku', 'name', 'stock'), ['Price', row => money(row.price)], ['Listed', row => row.active ? 'Yes' : 'No'],
      ['Action', row => <button className="secondary" onClick={() => { update.reset(); setEditing(row); }}>Edit {row.sku}</button>],
    ]} />}</>;
}
export function Admin() {
  return <><nav className="admin-nav" aria-label="Administration">
    <NavLink to="/admin" end>Sales</NavLink><NavLink to="/admin/orders">Orders</NavLink><NavLink to="/admin/payments">Payments</NavLink>
    <NavLink to="/admin/carts">Carts</NavLink><NavLink to="/admin/customers">Customers</NavLink><NavLink to="/admin/products">Inventory</NavLink>
    <NavLink to="/admin/chats">Support insights</NavLink><NavLink to="/admin/qa">AI Quality</NavLink>
  </nav><Routes>
    <Route index element={<Sales />} />
    <Route path="orders" element={<AdminOrders />} /><Route path="orders/:number" element={<AdminOrder />} />
    {Object.keys(columns).map(resource => <Route key={resource} path={resource} element={<Records resource={resource} />} />)}
    <Route path="products" element={<Inventory />} />
    <Route path="chats" element={<AdminChats />} /><Route path="qa" element={<SecurityPage />} />
    <Route path="*" element={<p>Admin page unavailable. <Link to="/admin">Sales dashboard</Link></p>} />
  </Routes></>;
}
