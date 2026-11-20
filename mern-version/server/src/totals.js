export function calculateTotals(items, delivery, taxRate) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shipping = delivery === 'express' ? 1200 : subtotal > 5000 || !subtotal ? 0 : 500;
  const tax = Math.round(subtotal * taxRate);
  return { subtotal, shipping, tax, total: subtotal + shipping + tax };
}
