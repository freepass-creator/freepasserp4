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

/**
 * **훑는 자리의 금액 — 「46.7만원」 · 「103만원」.**
 *
 * 사장님 2026-09-05 「**간단하게 보는 거**에서는 **보증금은 120만원 이렇게 뒤에 거 다 떼내고**,
 * 대여료는 **46.7만원 · 99.9만원** 이런 식으로 **만까지만** 표현하면 되지 않을까?」
 *
 * ★두 값의 자릿수를 다르게 잡는다 —
 *   · **대여료**는 만 단위 **소수 한 자리**(46.7만원). 고를 때 견주는 값이라 천원 자리가 판을 가른다
 *     (34만 5,000 과 34만 9,000 은 카드 두 장에서 실제로 갈린다).
 *   · **보증금**은 **만원 단위**(103만원). 「지금 목돈이 얼마나 드나」를 재는 값이라 자릿수보다
 *     «크기»가 먼저다. 천원 자리까지 붙으면 큰 숫자가 더 길어져 대여료를 가린다.
 * ★**버린다(내림). 반올림하지 않는다** — 올려 쓰면 실제보다 비싸 보이고, 반올림은 어느 쪽으로도
 *   틀릴 수 있다. 내림이면 「적어도 이 값」이 되어 늘 한 방향이다.
 * ⚠⚠ **상세는 이걸 쓰지 않는다.** 거기는 «낼 금액»을 확인하는 자리라 `manWon` 이 원 단위까지 쓴다
 *   (§1 반올림 금지). 이 함수는 **목록 카드처럼 훑는 자리**에만 쓴다.
 */
export function manShort(n: unknown, opts?: { decimal?: boolean }): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (!v) return '0원';
  if (v < 10000) return `${v.toLocaleString('ko-KR')}원`;
  const man = v / 10000;
  if (opts?.decimal) {
    const cut = Math.floor(man * 10) / 10;              // 천원 아래는 버린다
    const text = Number.isInteger(cut) ? String(cut) : cut.toFixed(1);
    return `${Number(text).toLocaleString('ko-KR')}만원`;
  }
  return `${Math.floor(man).toLocaleString('ko-KR')}만원`;
}

/**
 * **손님 화면 금액 — 「97만3천원」.**
 *
 * 사장님 2026-09-08 「**숫자에 0 들어가는 거** 이거 홈페이지에는 안 해도 될 거 같은데???
 * 굳이 해야 되나??」 · 「웹에는 대여료 **97만3천원** 이렇게 하든가 아니면 **973,000원** 이렇게 하든가」
 *
 * ★★그전에는 자리마다 말이 달랐다 — 카드는 「97.3만원」(소수점), 상세는 「97만 3,000원」(0 세 개).
 *   같은 금액을 두 번 다르게 읽어야 했다. **하나로 모은다.**
 * ★소수점을 버린다. 「97.3만」은 «만 단위 소수»라 손님이 머릿속에서 다시 곱해야 한다 —
 *   3,000원인지 30,000원인지 한 번 더 생각하게 만드는 표기다.
 * ★0 을 버린다. 「97만 3,000원」의 `,000` 은 자리만 먹고 아무것도 안 알려 준다.
 *
 * ⚠⚠ **반올림하지 않는다**(§1 반올림 금지). 천원 단위로 «딱 떨어질 때만» 만·천으로 적고,
 *   아니면 **원 단위 그대로** 적는다. 실측(2026-09-08 · 운영 4,455건) —
 *   대여료의 **99.98%**, 보증금의 **100%** 가 천원 단위로 떨어진다.
 *   딱 하나 1,670,500원이 있는데, 그건 「167만500원」으로 뭉개지 않고 **1,670,500원**으로 적는다.
 *   ⇒ 이 함수는 «짧게 보이려고» 값을 바꾸지 않는다. 짧아지는 건 결과일 뿐이다.
 */
export function wonKo(n: unknown): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (!v) return '0원';
  /* 만 미만은 만·천으로 쪼갤 것이 없다 — 그대로 적는다(5,000원). */
  if (v < 10000) return `${v.toLocaleString('ko-KR')}원`;
  /* 천원 단위로 안 떨어지면 «있는 그대로». 뭉개는 순간 카드와 상담의 금액이 갈린다. */
  if (v % 1000 !== 0) return `${v.toLocaleString('ko-KR')}원`;
  const man = Math.floor(v / 10000);
  const chun = (v % 10000) / 1000;
  return chun ? `${man.toLocaleString('ko-KR')}만${chun}천원` : `${man.toLocaleString('ko-KR')}만원`;
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

/**
 * **전기차인가 — 연료 값 하나로 판정하는 SSOT.**
 *
 * ⚠⚠ 2026-09-05 실측. 전기차 42대 중 **9대가 배기량 칸에 엉뚱한 숫자**를 들고 있다
 *   (니로 EV 가 1580cc — 가솔린 니로의 값이다). 상세는 그걸 가렸는데 **목록 카드는 그대로
 *   내보내고 있었다**(코덱스 2026-09-05 검토에서 잡혔다). 같은 차가 목록에서는 「1,580cc」,
 *   상세에서는 배기량 없이 「배터리」로 보였다.
 * ⇒ 판정을 여기 하나로 모은다. 「전기차는 배기량이 없다」는 **한 번만 정해져야** 한다.
 */
export function isEvFuel(fuel: unknown): boolean {
  return /전기|EV|이브이/i.test(String(fuel ?? ''));
}

/**
 * **주행거리 «값» SSOT** — 「83,000km」·「8.3만km」·「83000」을 전부 `83000` 으로 읽는다.
 *
 * ⚠⚠ 2026-09-05 실측 사고. 손님 카탈로그가 `Number(p.mileage)` 로 읽고 있었다.
 *   원천은 96% 가 채워져 있는데(`audit-axis-coverage` Km 시트 95% · ERP 96%)
 *   **손님 화면에는 721대 중 26대**만 주행거리가 떴다. 콤마가 든 「83,000」이 `NaN` → 0 이 되고,
 *   0 은 「값이 없다」로 접혔기 때문이다. 살아남은 26대는 전부 신차(「30」)였다 —
 *   **콤마가 붙을 만큼 큰 값만 골라서 지워지고 있었다.**
 * ★그래서 읽는 자리를 하나로 모은다. `kmDisplay` 는 이미 콤마·단위를 견디는데
 *   «값»을 읽는 쪽이 딴 데서 각자 `Number()` 를 부르면 또 어긋난다.
 * 사장님 2026-09-05 「**주행거리를 안 뗀 경우는 잘못됐지. 주행거리는 거의 다 있을 건데**」 — 맞다.
 */
export function kmValue(raw: unknown): number {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s || /^[-–—.]+$/.test(s)) return 0;
  const man = s.match(/^([\d.]+)\s*만\s*(?:km|킬로)?$/i);
  if (man && Number.isFinite(Number(man[1]))) return Math.round(Number(man[1]) * 10_000);
  const plain = s.match(/^([\d.]+)\s*(?:km|킬로)?$/i);
  if (plain && Number.isFinite(Number(plain[1]))) return Math.round(Number(plain[1]));
  const digits = s.replace(/[^\d.]/g, '');
  return digits && Number.isFinite(Number(digits)) ? Math.round(Number(digits)) : 0;
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
