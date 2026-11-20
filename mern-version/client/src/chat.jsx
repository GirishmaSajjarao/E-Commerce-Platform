import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { RequestState } from './store.jsx';

function Transcript({ query }) {
  return <><RequestState query={query} />
    {query.data?.length === 0 && <p>Ask about your order, delivery, or a product.</p>}
    <div className="transcript" aria-live="polite" data-testid="chat-messages">
      {query.data?.map(item => <p key={item.id || item._id}><strong>{item.role === 'user' ? 'You' : 'ShopAssist'}</strong> · {item.content}</p>)}
    </div></>;
}
function Chat({ user, orderNumber, customerId }) {
  const [selected, setSelected] = useState('');
  const [content, setContent] = useState('');
  const cache = useQueryClient();
  const key = ['conversations', user.id];
  const convos = useQuery({ queryKey: key, queryFn: () => api('/chat/conversations') });
  const messages = useQuery({
    queryKey: [...key, selected], queryFn: () => api(`/chat/conversations/${selected}/messages`), enabled: !!selected,
  });
  const send = useMutation({
    mutationFn: async () => {
      let id = selected;
      if (!id) {
        const conversation = await api('/chat/conversations', { method: 'POST', body: {
          ...(orderNumber ? { orderNumber } : {}), ...(customerId ? { customerId } : {}),
        } });
        id = conversation.id;
        setSelected(id);
      }
      return api(`/chat/conversations/${id}/messages`, { method: 'POST', body: { content } });
    },
    onSuccess: () => setContent(''),
    onSettled: () => cache.invalidateQueries({ queryKey: key }),
  });
  return <div className="fieldset">
    <div className="line">
      <label>Conversation<select value={selected} disabled={send.isPending} onChange={event => setSelected(event.target.value)}>
        <option value="">New conversation</option>
        {convos.data?.map(conversation => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
      </select></label>
      {orderNumber && !selected && <span>About {orderNumber}</span>}
      {customerId && !selected && <span>Testing as {customerId}</span>}
    </div>
    {convos.isError && <RequestState query={convos} />}
    {selected && <Transcript query={messages} />}
    <form className="fieldset" onSubmit={event => { event.preventDefault(); if (content.trim() && !send.isPending) send.mutate(); }}>
      <label>Message<textarea value={content} maxLength={2000} required onChange={event => setContent(event.target.value)} /></label>
      {send.error && <p role="alert">{send.error.message}</p>}
      <button disabled={send.isPending || !content.trim()}>{send.isPending ? 'Sending…' : 'Send message'}</button>
    </form>
  </div>;
}
export function Support({ user }) {
  const [params] = useSearchParams();
  const orderNumber = params.get('order');
  const customerId = user.role === 'admin' ? params.get('customer') : null;
  return <><h1>Support</h1><section className="card"><Chat key={(orderNumber || '') + (customerId || '')} user={user} orderNumber={orderNumber} customerId={customerId} /></section></>;
}
export function ChatWidget({ user }) {
  const [open, setOpen] = useState(false);
  return <aside className="chat-widget">
    <button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close chat' : 'Support chat'}</button>
    {open && <section className="card"><h2>Support chat</h2>
      {user ? <Chat user={user} /> : <Link to="/login">Sign in to use support chat</Link>}
    </section>}
  </aside>;
}

export function AdminChats() {
  const [selected, setSelected] = useState('');
  const conversations = useQuery({ queryKey: ['admin', 'chats'], queryFn: () => api('/admin/chats') });
  const customers = useQuery({ queryKey: ['admin', 'customers'], queryFn: () => api('/admin/customers') });
  const messages = useQuery({ queryKey: ['admin', 'chats', selected], queryFn: () => api('/admin/chats/' + selected), enabled: !!selected });
  return <><h1>Support insights</h1><RequestState query={conversations} /><RequestState query={customers} />
    {customers.data && <p>Chat as customer: {customers.data.map(customer =>
      <React.Fragment key={customer._id}><Link to={'/support?customer=' + encodeURIComponent(customer.customerId)}>{customer.name}</Link>{' · '}</React.Fragment>)}</p>}
    {conversations.data?.length === 0 && <p>No conversations recorded.</p>}
    {!!conversations.data?.length && <label className="narrow">Review conversation<select value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose a conversation</option>
      {conversations.data.map(item => <option key={item._id} value={item._id}>{item.title} · {item.customer?.name || 'Account'}{item.order ? ' · ' + item.order.number : ''}</option>)}
    </select></label>}
    {selected && <RequestState query={messages} />}
    {messages.data?.map(item => <article key={item._id} className="card order">
      <h2>{item.role}{item.isMock ? ' · MOCK' : ''}{item.flagged ? ' · Flagged' : ''}</h2><p>{item.content}</p>
      {!!item.context?.length && <details><summary>Retrieved context</summary><ul>{item.context.map(fact => <li key={fact}>{fact}</li>)}</ul></details>}
    </article>)}
  </>;
}
export function SecurityPage() {
  const [id, setId] = useState('');
  const runs = useQuery({ queryKey: ['qa', 'runs'], queryFn: () => api('/qa/runs'), refetchInterval: 2000 });
  const detail = useQuery({ queryKey: ['qa', id], queryFn: () => api('/qa/runs/' + id), enabled: !!id, refetchInterval: 2000 });
  const trigger = useMutation({ mutationFn: () => api('/qa/security/run', { method: 'POST' }), onSuccess: run => setId(run._id) });
  return <><h1>AI Quality</h1><button disabled={trigger.isPending} onClick={() => trigger.mutate()}>Run security checks</button>
    {trigger.error && <p role="alert">{trigger.error.message}</p>}<RequestState query={runs} />
    {runs.data?.length === 0 && <p>No runs recorded.</p>}
    {!!runs.data?.length && <label className="narrow">Recent runs<select value={id} onChange={event => setId(event.target.value)}>
      <option value="">Choose a run</option>{runs.data.map(run => <option key={run._id} value={run._id}>{run.kind} · {run.status}{run.isMock ? ' · MOCK' : ''} · {new Date(run.createdAt).toLocaleString()}</option>)}
    </select></label>}
    {id && <RequestState query={detail} />}
    {detail.data && <section className="card"><h2>{detail.data.run.status}{detail.data.run.isMock ? ' · MOCK' : ''}</h2>
      {detail.data.run.error && <p role="alert">{detail.data.run.error}</p>}
      {detail.data.run.summary && <p>{Object.entries(detail.data.run.summary).map(([key, value]) => key + ': ' + value).join(' · ')}</p>}
      {detail.data.results.map(row => <details key={row._id}><summary>{row.key} · {row.passed ? 'Passed' : 'Failed'}{row.isMock ? ' · MOCK' : ''}</summary>
        <p>{row.answer}</p><ul>{row.findings.map(finding => <li key={finding}>{finding}</li>)}</ul></details>)}</section>}
  </>;
}
