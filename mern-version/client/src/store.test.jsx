import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckoutForm, RequestState, Totals } from './store.jsx';

afterEach(cleanup);
const totals = { subtotal: 1000, shipping: 500, tax: 80, total: 1580 };
const cart = { items: [{}], totals, expressTotals: { ...totals, shipping: 1200, total: 2280 } };

test('renders trusted cart totals in dollars', () => {
  render(<Totals totals={totals} />);
  expect(screen.getByText('$15.80')).toBeTruthy();
  expect(screen.getByText('$5.00')).toBeTruthy();
});

test('requires shipping fields and safely submits COD fields with express delivery', () => {
  const submit = vi.fn();
  render(<CheckoutForm cart={cart} submit={submit} />);
  fireEvent.click(screen.getByText('Place order'));
  expect(submit).not.toHaveBeenCalled();
  for (const [label, value] of [['Full name', 'Sample Buyer'], ['Phone', '555-0102'], ['Street address', '1 Test Lane'], ['City', 'Sample City'], ['Postal code', '10001']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText('Delivery'), { target: { value: 'express' } });
  fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'cod' } });
  expect(screen.getByText('$22.80')).toBeTruthy();
  fireEvent.click(screen.getByText('Place order'));
  expect(submit).toHaveBeenCalledWith({ method: 'cod', delivery: 'express', address: {
    name: 'Sample Buyer', phone: '555-0102', street: '1 Test Lane', city: 'Sample City', postalCode: '10001',
  } });
});

test('exposes loading, request errors, and checkout errors accessibly', () => {
  const view = render(<RequestState query={{ isPending: true }} />);
  expect(screen.getByRole('status').textContent).toMatch(/Loading/);
  view.rerender(<RequestState query={{ isError: true, error: new Error('Network error') }} />);
  expect(screen.getByRole('alert').textContent).toBe('Network error');
  view.rerender(<CheckoutForm cart={cart} error="Card declined." busy />);
  expect(screen.getByRole('alert').textContent).toBe('Card declined.');
  expect(screen.getByRole('button').disabled).toBe(true);
});
