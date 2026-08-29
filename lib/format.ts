// 금액·숫자 표기 SSOT(표현 계층). 전체 '원' 표기는 components/ui의 won 사용, 여기선 축약·부가 포맷만.

/**
 * 금액 표기 SSOT — **축약하지 않는다.** 655,000 → "655,000원".
 *
 * ★사장님 2026-08-28 「그냥 655,000원으로 하자」. 만원 축약(「69만」)은 685,000 과 694,000 을
 *   같은 글자로 만들어, 목록을 훑는 영업자가 만원 아래를 못 봤다. 소수점 한 자리(「68.5만」)도
 *   거쳐 봤지만 결국 사람이 손님에게 말하는 단위는 «원»이라 그대로 적는다.
 *
 * 화면 넷(엑셀·간단·상세·모바일)이 이 한 함수를 쓴다. 자리마다 따로 찍지 말 것 —
 * 따로 찍으면 같은 값이 화면마다 다른 글자로 선다.
 * 실측(2026-08-28): 대여료 최대 4,988,000 · 보증금 최대 10,000,000 — 열 폭은 이 값이 기준이다.
 */
export const wonText = (n: unknown): string => {
  const v = Number(n);
  return `${Math.round(v || 0).toLocaleString('ko-KR')}원`;
};

/**
 * 모바일 매물 목록용 월 대여료 — 999,000 → "99.9만".
 *
 * 목록은 빠르게 훑는 자리라 한 자리 소수의 만원 단위만 쓴다. 이 값은
 * `PriceAmounts`에서만 사용하며, 웹 목록·상세·계약/정산 문서는 정확한 원 단위를 유지한다.
 */
export const rentMan = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0만';
  return `${(Math.round(v / 1000) / 10).toFixed(1)}만`;
};

/**
 * 만원 단위 축약 — **보증금 전용**. 1,210,000 → "121만원". 0/빈값 → "0원".
 *
 * ★사장님 2026-08-28 「대여료만 원단위로 · 보증금은 그냥 똑같이 121만 이렇게」.
 *   대여료는 매달 나가는 돈이라 만원 아래가 협상거리지만, 보증금은 목돈이라 «얼마쯤»이면 된다.
 *   한 줄에 둘이 나란히 서므로 단위가 갈리는 것이 오히려 눈에 «다른 값»이라고 말해 준다.
 */
export const man = (n: unknown): string => {
  const v = Number(n);
  return v ? `${Math.round(v / 10000).toLocaleString()}만원` : '0원';
};

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
