import { expect } from '@playwright/test';

export class LoginPage {
  constructor(page) { this.page = page; }
  async open(email, password) {
    await this.page.goto('/login');
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  }
  async signOut() {
    await this.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(this.page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  }
}
export class ShopPage {
  constructor(page) { this.page = page; }
  async add(sku) {
    await this.page.getByRole('link', { name: 'Shop', exact: true }).click();
    await this.page.getByTestId('add-' + sku).click();
    await expect(this.page.getByText('Added to cart', { exact: true })).toBeVisible();
    await this.page.getByRole('link', { name: 'Cart', exact: true }).click();
  }
}
export class CartPage {
  constructor(page) { this.page = page; }
  async checkout() { await this.page.getByRole('link', { name: 'Checkout', exact: true }).click(); }
}
export class CheckoutPage {
  constructor(page) { this.page = page; }
  async address() {
    for (const [field, text] of Object.entries({
      'Full name': 'Sample Buyer', Phone: '555-1234', 'Street address': '1 Sample Lane', City: 'Sample City', 'Postal code': '10001',
    })) await this.page.getByLabel(field, { exact: true }).fill(text);
  }
  async charge(parts) {
    await this.page.getByLabel('Test card number').fill(parts.join(' '));
    await this.page.getByRole('button', { name: 'Place order' }).click();
  }
}
export class OrdersPage {
  constructor(page) { this.page = page; }
  async confirmation() {
    await expect(this.page.getByText('Your order was placed.')).toBeVisible();
    return this.page.getByRole('heading', { level: 1 }).innerText();
  }
  async open(number) {
    await this.page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My orders' }).click();
    await this.page.getByRole('link', { name: number, exact: true }).click();
  }
}
export class AdminOrdersPage {
  constructor(page) { this.page = page; }
  async ship(number, tracking) {
    await this.page.getByRole('link', { name: 'Administration' }).click();
    await expect(this.page.getByRole('heading', { name: 'Sales dashboard' })).toBeVisible();
    await this.page.getByRole('link', { name: 'Orders', exact: true }).click();
    await this.page.getByRole('link', { name: number, exact: true }).click();
    await this.page.getByLabel('Carrier').fill('Sample Carrier');
    await this.page.getByLabel('Tracking number').fill(tracking);
    await this.page.getByRole('button', { name: 'Mark as Shipped' }).click();
    await expect(this.page.getByRole('heading', { name: 'Shipped' })).toBeVisible();
  }
}
export class ChatWidget {
  constructor(page) { this.page = page; }
  async open() { await this.page.getByRole('button', { name: 'Support chat', exact: true }).click(); }
  async send(message) {
    await this.page.getByLabel('Message', { exact: true }).fill(message);
    await this.page.getByRole('button', { name: 'Send message' }).click();
  }
  answer() { return this.page.getByTestId('chat-messages').getByText(/\[MOCK RESPONSE\]/).last(); }
}
