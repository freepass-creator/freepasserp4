// 금액·숫자 표기 SSOT(표현 계층). 전체 '원' 표기는 components/ui의 won 사용, 여기선 축약·부가 포맷만.

/** 만원 단위 축약 — 카드/집계 서브바 등 좁은 자리. 예: 1,250,000 → "125만". 0/빈값 → "0". */
export const man = (n: unknown): string => {
  const v = Number(n);
  return v ? `${Math.round(v / 10000).toLocaleString()}만` : '0';
};

/**
 * **손님에게 보이는 금액** — 「39만 8,000원」처럼 한 원도 안 깎고 적는다.
 *
 * ⚠ `man()` 을 손님 화면 «가격»에 쓰면 안 된다. 그건 **반올림**이라 398,000원이 「40만」이 된다
 *   (업무동 요약·통계에는 그 축약이 맞다). 손님이 카드에서 본 금액과 상담에서 듣는 금액이
 *   다르면 그 자리에서 신뢰가 깨진다.
 */
export function manWon(n: unknown): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (!v) return '0원';
  const m = Math.floor(v / 10000);
  const rest = v % 10000;
  if (!m) return `${v.toLocaleString()}원`;
  return rest ? `${m.toLocaleString()}만 ${rest.toLocaleString()}원` : `${m.toLocaleString()}만원`;
}

/** 주행거리 표시 SSOT — 축약하지 않고 실제 km를 그대로 표시한다. */
export function kmDisplay(raw: unknown): string {
  const source = String(raw ?? '').trim();
  if (!source) return '';
  const normalized = source.replace(/,/g, '').replace(/\s*km\s*$/i, '').trim();
  const value = Number(normalized);
  if (Number.isFinite(value) && value >= 0) return `${value.toLocaleString('ko-KR')}km`;
  return source;
}

/** 첨부 크기 표기 SSOT — `1.2MB` / `340KB`. 0·비수는 빈 문자열(자리를 만들지 않는다). */
export function fileSizeText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

/**
 * 날짜 표기 SSOT — `YYYY-MM-DD`.
 *
 * 공급사마다 원본이 제각각이다(`25-11-5` · `2025.11.5` · `20251105` · `2025년 11월 5일`).
 * 그대로 찍으면 같은 화면에서 자릿수가 흔들려 «최초등록 25-11-5» 같은 줄이 나온다.
 *
 * ★못 읽으면 **원본을 그대로 돌려준다.** 날짜를 지어내지 않는다 —
 *   차령·등록일은 손님 안내와 계약에 쓰이는 값이라, 틀린 날짜가 빈칸보다 위험하다.
 *   두 자리 연도는 70을 기준으로 가른다(70~99=19xx, 00~69=20xx).
 */
export function ymdDisplay(raw: unknown): string {
  const src = String(raw ?? '').trim();
  if (!src) return '';
  const m = src.match(/^(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/)
    || src.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return src;
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (m[1].length <= 2) y = y >= 70 ? 1900 + y : 2000 + y;
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return src;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 채팅 버블 시각 — 오늘=`HH:mm`, 아니면 `M/D HH:mm`. `dateOnly`면 비오늘은 `M/D`만. */
export function msgClock(ms: unknown, opts?: { dateOnly?: boolean }): string {
  const n = Number(ms);
  if (!n) return '';
  const d = new Date(n);
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return opts?.dateOnly ? md : `${md} ${hm}`;
}
