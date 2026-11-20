import { expect, test as base } from '@playwright/test';
import { AdminOrdersPage, CartPage, ChatWidget, CheckoutPage, LoginPage, OrdersPage, ShopPage } from '../pages.js';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', entry => {
      if (entry.type() !== 'error') return;
      const status = /responded with a status of (\d+)/.exec(entry.text());
      const path = new URL(entry.location().url || 'http://127.0.0.1').pathname;
      if (status && ((status[1] === '401' && path === '/api/auth/me') || (status[1] === '402' && path === '/api/checkout'))) return;
      errors.push(entry.text());
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

test('customer checks out, admin ships, and customer tracks the order in chat', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open('alice@example.com', 'Customer@123');
  await new ShopPage(page).add('PRD-103');
  await new CartPage(page).checkout();
  const checkout = new CheckoutPage(page);
  await checkout.address();
  await checkout.charge(['4242', '4242', '4242', '4242']);
  const orders = new OrdersPage(page);
  const number = await orders.confirmation();
  await orders.open(number);
  await expect(page.getByText('Payment: Paid')).toBeVisible();

  await login.signOut();
  await login.open('admin@qa.local', 'Admin@123');
  await new AdminOrdersPage(page).ship(number, 'CEDAR-4728');
  await login.signOut();

  await login.open('alice@example.com', 'Customer@123');
  await orders.open(number);
  await expect(page.getByTestId('tracking')).toContainText('CEDAR-4728');
  const chat = new ChatWidget(page);
  await chat.open();
  await chat.send('Where is my order ' + number + '?');
  await expect(chat.answer()).toContainText('CEDAR-4728');
  await chat.send('What is the payment status of ORD-1004?');
  await expect(chat.answer()).toContainText("don't belong to your account");
});

test('both failed test cards display their own error and preserve checkout', async ({ page }) => {
  const login = new LoginPage(page);
  await login.open('bob@example.com', 'Customer@123');
  await new ShopPage(page).add('PRD-101');
  await new CartPage(page).checkout();
  const checkout = new CheckoutPage(page);
  await checkout.address();
  await checkout.charge(['4000', '0000', '0000', '0002']);
  await expect(page.getByRole('alert')).toHaveText('Card declined.');
  await checkout.charge(['4000', '0000', '0000', '9995']);
  await expect(page.getByRole('alert')).toHaveText('Insufficient funds.');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
});

test('admin sees all imported deterministic Promptfoo results', async ({ page }) => {
  test.skip(!process.env.PROMPTFOO_NODE_BINARY && Number(process.versions.node.split('.')[0]) < 22, 'Promptfoo requires Node 22.22+.');
  test.setTimeout(120000);
  await new LoginPage(page).open('admin@qa.local', 'Admin@123');
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByRole('link', { name: 'AI Quality' }).click();
  await page.getByRole('button', { name: 'Run Promptfoo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'completed · MOCK' })).toBeVisible({ timeout: 95000 });
  await expect(page.getByText(/total: 18 · passed: 18 · failed: 0 · errors: 0/)).toBeVisible();
  await expect(page.getByText('Normal: own order status · Passed')).toBeVisible();
});
