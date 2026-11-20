import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { CartPage, CheckoutPage, OrderDetail, OrdersPage, ProductDetail, Shop } from './store.jsx';
import { Admin } from './admin.jsx';
import { ChatWidget, Support } from './chat.jsx';
import './style.css';

function App() {
  const cache = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [register, setRegister] = useState(false);
  const session = useQuery({ queryKey: ['session'], queryFn: async () => {
    try { return await api('/auth/me'); }
    catch (error) { if (error.status === 401) return null; throw error; }
  }, retry: false });
  const login = useMutation({ mutationFn: fields => api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: fields }),
    onSuccess: user => { cache.setQueryData(['session'], user); navigate(location.state?.from || '/', { replace: true }); } });
  const logout = useMutation({ mutationFn: () => api('/auth/logout', { method: 'POST' }), onSuccess: () => {
    cache.clear(); cache.setQueryData(['session'], null); navigate('/');
  } });
  const user = session.data;
  const privatePage = element => user ? element : <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const form = <section className="card narrow">
    <h1>{register ? 'Create an account' : 'Sign in'}</h1>
    <form onSubmit={event => {
      event.preventDefault();
      login.mutate(Object.fromEntries(new FormData(event.currentTarget)));
    }}>
      {register && <p><label>Name <input name="name" required autoComplete="name" /></label></p>}
      <p><label>Email <input type="email" name="email" required autoComplete="email" /></label></p>
      <p><label>Password <input type="password" name="password" minLength={8} required autoComplete={register ? 'new-password' : 'current-password'} /></label></p>
      {login.error && <p role="alert">{login.error.message}</p>}
      <button disabled={login.isPending}>{register ? 'Create account' : 'Sign in'}</button>
    </form>
    <p><button type="button" onClick={() => { login.reset(); setRegister(!register); }}>
      {register ? 'Use an existing account' : 'Register'}
    </button></p>
  </section>;
  return <>
    <header><nav className="nav" aria-label="Main navigation">
      <Link className="brand" to="/">Cedar Store</Link><Link to="/">Shop</Link>
      {user ? <><Link to="/cart">Cart</Link><Link to="/orders">My orders</Link>
        <Link to="/support">Support</Link>
        {user.role === 'admin' && <Link to="/admin">Administration</Link>}
        <button className="secondary" disabled={logout.isPending} onClick={() => logout.mutate()}>Sign out</button></> : <Link to="/login">Sign in</Link>}
    </nav></header>
    <main>
      {logout.error && <p role="alert">{logout.error.message}</p>}
      {session.isPending ? <p role="status">Loading account…</p> : session.isError ? <p role="alert">{session.error.message}</p> :
        <Routes>
          <Route path="/" element={<Shop user={user} />} />
          <Route path="/login" element={user ? <Navigate to="/" replace /> : form} />
          <Route path="/products/:sku" element={<ProductDetail user={user} />} />
          <Route path="/cart" element={privatePage(<CartPage user={user} />)} />
          <Route path="/checkout" element={privatePage(<CheckoutPage user={user} />)} />
          <Route path="/orders" element={privatePage(<OrdersPage user={user} />)} />
          <Route path="/orders/:number" element={privatePage(<OrderDetail user={user} confirmed={location.state?.confirmed} />)} />
          <Route path="/support" element={privatePage(<Support user={user} />)} />
          <Route path="/admin/*" element={privatePage(user?.role === 'admin' ? <Admin /> : <p role="alert">Administrator access is required.</p>)} />
          <Route path="*" element={<p>Page not found. <Link to="/">Back to shop</Link></p>} />
        </Routes>}
    </main>
    {!location.pathname.startsWith('/admin') && location.pathname !== '/support' && <ChatWidget key={user?.id} user={user} />}
  </>;
}

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient()}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>,
);
