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

/** 주민등록번호·법인등록번호 — `900101-1234567` */
export function fmtRrn(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

/** 사업자등록번호 — `000-00-00000` */
export function fmtBizNo(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** 운전면허번호 — `11-02-123456-01`. 지역명(서울 등)이 있으면 손대지 않는다. */
export function fmtLicense(value: unknown): string {
  const raw = String(value ?? '');
  if (/[가-힣A-Za-z]/.test(raw)) return raw.slice(0, 30);
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 10)}-${digits.slice(10)}`;
}
