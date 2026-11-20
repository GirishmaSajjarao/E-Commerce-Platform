const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const card = /(?<!\d)(?:\d[ -]?){12,18}\d(?![ -]?\d)/g;
const phone = /(?<![\w-])\+?\d[\d\- ().]{5,}\d(?!\w)/g;
const isPhone = value => value.replace(/\D/g, '').length >= 7 && !/^\d{4}-\d{2}-\d{2}$/.test(value);

export function redactCard(text) {
  return text.replace(card, '[number removed]');
}
export function redactPii(text) {
  return redactCard(text).replace(email, '[email removed]').replace(phone, value => isPhone(value) ? '[phone removed]' : value);
}
