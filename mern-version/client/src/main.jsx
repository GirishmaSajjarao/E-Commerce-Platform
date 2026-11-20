import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function api(path, body) {
  const response = await fetch('/api' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'Request failed.'), { status: response.status });
  return payload;
}

function Session() {
  const cache = useQueryClient();
  const [register, setRegister] = useState(false);
  const session = useQuery({ queryKey: ['session'], queryFn: async () => {
    try { return await api('/auth/me'); }
    catch (error) { if (error.status === 401) return null; throw error; }
  }, retry: false });
  const login = useMutation({ mutationFn: fields => api(register ? '/auth/register' : '/auth/login', fields),
    onSuccess: user => cache.setQueryData(['session'], user) });
  const logout = useMutation({ mutationFn: () => api('/auth/logout', {}), onSuccess: () => cache.setQueryData(['session'], null) });
  if (session.isPending) return <p>Loading account…</p>;
  if (session.isError) return <p role="alert">{session.error.message}</p>;
  if (session.data) return <main>
    <h1>Welcome, {session.data.name}</h1><p>Account role: {session.data.role}</p>
    <button onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</button>
    {logout.error && <p role="alert">{logout.error.message}</p>}
  </main>;
  return <main>
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
  </main>;
}

createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><Session /></QueryClientProvider>);
