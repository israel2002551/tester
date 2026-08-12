export function formatMoney(value: number | string | undefined | null, currency = 'NGN') {
  const amount = typeof value === 'string' ? Number(value) : value ?? 0;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function nairaToKoboString(value: FormDataEntryValue | string | number | null | undefined) {
  const normalized = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a valid naira amount with no more than two decimal places.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  return (BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2))).toString();
}

export function formatDate(value: string | Date | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function titleFromSlug(value: string) {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
