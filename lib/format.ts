// 금액·숫자 표기 SSOT(표현 계층). 전체 '원' 표기는 components/ui의 won 사용, 여기선 축약·부가 포맷만.

/**
 * **맨 숫자에만 단위를 붙인다** — 「30」 → 「30일」, 이미 「30일」이면 그대로.
 *
 * ★★**단위는 «필드 이름이 말할 때만» 붙인다.** 실측 2026-09-06 — 같은 뜻인데 원천이 제각각이다:
 *   `deposit_return_days` 는 「30일」인데 `buyout_notice_days` 는 「30」, `impound_keep_days` 도 「30」.
 *   이름이 `_days` 니 단위는 «날»이 맞다 — 그래서 맨 숫자에만 붙이고 이미 붙은 것은 건드리지 않는다.
 *
 * ⚠⚠ **비율(`late_fee_rate` 0.12·0.24)에는 쓰지 마라.** 이름이 `rate` 라 단위를 말해 주지 않는다 —
 *   12%인지 하루 0.12%인지 이 데이터만으로는 모른다. **모르는 것을 「%」로 지어내면** 손님에게
 *   틀린 숫자를 말하게 된다. 규격이 정해지면 그때 붙인다.
 *
 * ★★**규칙이 한 곳에 있어야 한다**(2026-09-16). 전에는 이 셈이 `app/api/shop/inside/route.ts` 안에만
 *   있었는데, 그 값들이 손님 기타사항으로 올라오면서 **화면 쪽에 같은 셈을 또 적을 뻔했다.**
 *   두 곳에 적으면 한쪽만 고쳐져서 같은 값이 두 얼굴이 된다(집 규칙 — 규칙은 한 파일에).
 */
export const withUnit = (v: unknown, u: string): string => {
  const t = String(v ?? '').trim();
  return t && /^[0-9]+$/.test(t) ? `${t}${u}` : t;
};

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
 * **손님 화면 금액 — 「1,262,467원」.** 한 원도 안 깎고, 자리마다 «같은 말»로 적는다.
 *
 * 사장님 2026-09-08 「웹에는 대여료 **97만3천원** 이렇게 하든가 아니면 **973,000원** 이렇게 하든가」
 * — 둘 중 하나를 고르라 하셨고, **뒤쪽으로 간다.** 이유는 데이터가 정해 줬다.
 *
 * ⚠⚠ **처음엔 「97만3천원」으로 갔다가 하루 만에 뒤집었다. 내가 «옛 원장»을 재고 정했기 때문이다.**
 *   그날 「대여료의 99.98%가 천원 단위로 딱 떨어진다」고 재서 만·천 표기를 골랐는데,
 *   그 값은 **폐기된 RTDB** 것이었다(화면이 거기를 읽고 있었다 — `firestore-ref-shim` 머리말).
 *   함수를 서울로 옮겨 **정본(파이어스토어)** 을 읽자 실제 분포가 드러났다 —
 *   **대여료 4,452건 중 2,706건(61%)이 원 단위**다(1,262,467 · 994,206 · 870,343 …).
 *   ⇒ 만·천 표기는 이제 **소수파(39%)** 다. 그대로 두면 한 목록에 「59만4천원」과 「594,207원」이
 *     나란히 서서, 없애려던 «두 얼굴»이 오히려 늘어난다.
 *
 * ★★**반올림해서 통일하지 않는다.** 「126만2천원」으로 적으려면 467원을 버려야 하는데,
 *   그건 §1 반올림 금지를 푸는 일이라 우리가 정할 값이 아니다.
 *   ⇒ **한 원도 안 깎으면서 통일하는 길은 콤마 숫자 하나뿐**이다. 그래서 이쪽이다.
 * ★사장님이 「숫자에 0 들어가는 거 안 해도 될 듯」 하신 것은 **「97만 3,000원」처럼 만·천·원이
 *   섞여 `,000` 이 붙던 꼴**이다. 콤마 숫자 한 벌은 그 꼴이 아니다 — 그분이 직접 든 선택지다.
 *
 * ⚠ 카드의 **보증금은 여전히 `manShort`**(「178만원」 · 뒤를 뗀다) — 2026-09-05 에 따로 정한 것이라
 *   여기 바뀜과 무관하다(`ShopCard` 머리말).
 */
export function wonKo(n: unknown): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `${v.toLocaleString('ko-KR')}원`;
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

/**
 * **오늘 — «한국 시간»으로 잰다.** 기계용(`todayKst`)과 사람용(`todayKo`) 한 짝.
 *
 * ⚠⚠ **`new Date()` 를 그냥 찍으면 하루가 어긋난다.** 서버(Vercel)는 UTC 로 돌고 손님 기기는
 *   KST 다 — 한국 시각 **자정~오전 9시** 사이에는 서버가 «어제»를 그린다. 그 HTML 이 내려간 뒤
 *   화면이 «오늘»로 다시 그리면 날짜가 눈앞에서 바뀌고(hydration 불일치), 「오늘 하루 안 보기」는
 *   저장한 날과 읽는 날이 갈려 **매일 아침 9시간 동안 안 먹는다.**
 * ⇒ 양쪽 다 `timeZone: 'Asia/Seoul'` 로 못박는다. 어디서 재든 같은 값이다.
 * ★둘이 «같은 시계»를 본다 — 화면에 적는 날짜와 저장하는 열쇠가 따로 놀면 안 된다.
 */
const KST = { timeZone: 'Asia/Seoul' } as const;

/** 기계용 — `2026-09-09`. 저장 열쇠·비교에 쓴다(`en-CA` 가 곧 ISO 차림이다). */
export function todayKst(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', KST);
}

/** 사람용 — `2026. 9. 9.`. 화면에 적는 값. */
export function todayKo(now: Date = new Date()): string {
  return now.toLocaleDateString('ko-KR', { ...KST, year: 'numeric', month: 'numeric', day: 'numeric' });
}

/**
 * **보증금 한 줄** — 손님 화면(목록 카드·상세·공유 미리보기)이 같은 규칙으로 말한다.
 *
 * ★2026-09-16 실측 — 보증금이 «숫자 0 + 규칙 글자»인 상품(오토플러스 「국산: 월 대여료×2」 ·
 *   손오공 구독 「월 대여료 × 약정연수(최대 3개월)」)에서 화면이 「보증금 없음」이라고 말하고 있었다.
 *   시트·하허호 시트는 규칙 글자로 나가는데 손님 화면만 «없다»고 한 것이다 — 그건 곧 약속이 된다.
 * ⇒ 금액이 있으면 금액 · 0인데 규칙 글자가 있으면 그 글자 · 둘 다 없으면 「보증금 없음」.
 *   「무보증」이라고 적힌 규칙은 말 그대로 없는 것이라 「보증금 없음」으로 둔다(색·굵기도 그대로).
 *
 * ★★**`rule` 을 같이 돌려준다 — 「금액」과 「문장」은 «폭이 다른 물건»이기 때문이다.**
 *   금액은 「보증금 178만원」처럼 짧아 한 줄에 붙지만, 규칙은 「보증금 월 대여료 × 약정연수
 *   (최대 3개월)」로 **210px** 이나 된다(웹 실측). 부르는 쪽이 둘을 같은 규칙으로 세우면
 *   좁은 카드에서 문장이 칸을 넘어 **옆 카드 위로 흘러 글자가 겹친다**(2026-09-18 운영 실측:
 *   창 900px · 카드폭 167px · 45px 넘침). 그래서 «무엇인지»를 여기서 알려 준다.
 * ⚠ 자르라는 뜻이 아니다 — 보증금은 **안 자른다**(2026-09-05 확정: 「보증금 103만 5,…」로
 *   끝이 잘려 있던 것을 그때 고쳤다). 넘치면 **줄을 바꾼다.**
 */
export function depositLine(deposit: unknown, note: unknown, money: (n: unknown) => string): { text: string; none: boolean; rule: boolean } {
  const amount = Number(deposit) || 0;
  const rule = String(note ?? '').trim();
  if (amount > 0) return { text: `보증금 ${money(amount)}`, none: false, rule: false };
  if (rule && !/무보증/.test(rule)) return { text: `보증금 ${rule}`, none: false, rule: true };
  return { text: '보증금 없음', none: true, rule: false };
}
