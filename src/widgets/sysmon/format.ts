const num = (digits: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const one = num(1);
const zero = num(0);

/** "8,2 GB" (1024 tabanı, Windows gibi). */
export function bytes(n: number) {
  const gb = n / 1024 ** 3;
  if (gb >= 100) return `${zero.format(gb)} GB`;
  if (gb >= 1) return `${one.format(gb)} GB`;
  return `${zero.format(n / 1024 ** 2)} MB`;
}

/** "2,4 MB/sn", "180 KB/sn". */
export function rate(n: number) {
  const mb = n / 1024 ** 2;
  if (mb >= 1) return `${one.format(mb)} MB/sn`;
  return `${zero.format(n / 1024)} KB/sn`;
}

export const percent = (used: number, total: number) =>
  total > 0 ? Math.round((used / total) * 100) : 0;

/** %90 ve üstü uyarı renginde. */
export const HIGH = 90;
