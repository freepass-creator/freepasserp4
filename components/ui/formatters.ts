export function won(value: unknown): string {
  const number = Number(value);
  return Number.isNaN(number) ? '—' : number.toLocaleString();
}

export function fmtNumber(value: unknown): string {
  const source = String(value ?? '');
  if (source === '') return '';
  const number = Number(source.replace(/,/g, ''));
  return Number.isNaN(number) ? source : number.toLocaleString();
}

/**
 * 시각 표기 SSOT — `M/D HH:mm` 24시간.
 * 화면마다 toLocaleString 옵션을 따로 넘기면 '7. 31. 오전 07:57' 처럼 형식이 갈린다.
 */
export function fmtAt(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
