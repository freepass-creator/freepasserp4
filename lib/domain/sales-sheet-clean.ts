/**
 * **판매시트 값 정제 — 적는 법만 맞춘다. 값은 안 바꾼다.**
 *
 * ★왜(사장님 2026-08-14 — 「그거만 하자, 정제는 해야지」)
 *   공급사 시트를 그대로 옮기면 같은 뜻이 공급사마다 다른 말로 선다.
 *   실측 2026-08-13: 1만+ 가 「10」129대 · 「100,000」58대 · 「150,000」12대로 셋이었고,
 *   연주행이 「3만Km」·「연 20,000km」·「2만Km 주행」으로 갈려 있었다.
 *
 * ★**바꾸는 것과 안 바꾸는 것**
 *   바꾼다   적는 법 — 만원 단위 · 콤마 · 어순 · 「없음」 표시
 *   안 바꾼다 숫자 자체 · 뜻 · 공급사가 쓴 말(「불가」·「협의」·「문의」·「10%」)
 *   ⚠ 돈(대여료·보증금)은 **콤마만** 채운다. 500000 을 50 으로 접지 마라 — 그건 면책금 칸 규칙이다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 트림 자리에 앉은 «트림이 아닌 말» — 그 차는 트림이 없다는 뜻이다(요즘 제네시스가 그렇다). */
export const NOT_A_TRIM = /^\(?세부등급\s*없음\)?$|^없음$|^-$|^해당없음$/;

/** 돈 — 숫자면 천단위 콤마를 채운다. 숫자가 아닌 말은 그대로 둔다(「연수×대여료」·「협의」·「-」). */
export function wonCell(v: unknown): string {
  const s = S(v);
  if (!s) return '';
  if (!/^[\d,]+$/.test(s)) return s;
  const n = Number(s.replace(/,/g, ''));
  return n > 0 ? n.toLocaleString('ko-KR') : s;
}

/**
 * 면책금·할증 — **만원 단위 숫자 하나로** 맞춘다. 500000 은 50만원이고 그걸 「50」으로 쓴다.
 * ⚠ 만원으로 안 떨어지는 값(5,000·33,000)은 손대지 않는다. 반올림하면 없는 값이 생긴다.
 * ⚠ 「불가」·「협의」·「10%」는 숫자가 아니다. 그대로 둔다.
 */
export function manOnly(v: unknown): string {
  const s = S(v);
  if (!s || s === '없음') return s;
  const m = s.match(/([\d,]+)\s*만/);
  if (m) return m[1];
  if (!/^[\d,]+$/.test(s)) return s;
  const n = Number(s.replace(/,/g, ''));
  if (!n) return s;
  if (n >= 10000 && n % 10000 === 0) return String(n / 10000);
  return n.toLocaleString('ko-KR');
}

/** 「무한/500000」처럼 앞뒤가 붙은 칸 — 슬래시 뒤(면책금)만 만원 단위로 맞춘다. */
export function limitCell(v: unknown): string {
  const s = S(v).replace(/원$/, '');
  if (!s.includes('/')) return s;
  const [head, ...rest] = s.split('/');
  const tail = rest.join('/');
  // 「50~100」 같은 범위도 각 쪽을 맞춘다.
  const fixed = tail.split('~').map((x) => manOnly(x)).join('~');
  return head.trim() ? `${head.trim()}/${fixed}` : fixed;
}

/** 연주행 — 「연 20,000km」·「2만Km 주행」·「2만Km」가 섞인다. 「2만km」로 맞춘다. */
export function yearlyKm(v: unknown): string {
  const s = S(v).replace(/^연간?\s*/, '').replace(/\s*주행\s*$/, '').trim();
  const m = s.match(/^([\d,]+)\s*km$/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 10000 && n % 1000 === 0) return `${n / 10000}만km`;
  }
  return s.replace(/Km$/i, 'km');
}

const FUEL = '가솔린|디젤|하이브리드|전기|수소|LPG';
const DRIVE = '2WD|4WD|AWD|4MATIC|xDrive|콰트로';
/**
 * 파워트레인 — **어순만 돌리고 남의 값은 떼어 낸다.**
 *   「1.6T가솔린 2WD」 → 「가솔린 1.6T 2WD」
 *   「가솔린 1.6T 2WD 트렌드」 → 파워트레인 「가솔린 1.6T 2WD」 + 꼬리 「트렌드」
 * ⚠ 4MATIC·xDrive·콰트로를 AWD 로 바꾸지 마라 — 차종마스터가 브랜드 말을 그대로 쓴다.
 * ⚠ 배기량 자리가 「2WD」의 2 나 「66kWh」의 66 을 먹으면 안 된다.
 */
export function splitPowertrain(raw: unknown): { power: string; rest: string } {
  const v = S(raw).replace(new RegExp(`^([\\d.]+T?)\\s*(${FUEL})`, 'i'), '$2 $1').replace(/\s{2,}/g, ' ').trim();
  if (!v) return { power: '', rest: '' };
  const m = v.match(new RegExp(`^((?:${FUEL})(?:\\s+[\\d.]+T?(?![\\d.]*(?:WD|kWh)))?(?:\\s+(?:${DRIVE}))?(?:\\s+[\\d.]+\\s*kWh)?(?:\\s+\\d+인승)?)\\s*(.*)$`, 'i'));
  if (!m) return { power: v, rest: '' };
  return { power: m[1].trim(), rest: m[2].trim() };
}

/** 주행거리·배기량 — 숫자면 콤마. 「12,000km」처럼 단위가 붙어 있으면 그대로 둔다. */
export function plainNumber(v: unknown): string {
  const s = S(v);
  if (!/^[\d,]+$/.test(s)) return s;
  const n = Number(s.replace(/,/g, ''));
  return n > 0 ? n.toLocaleString('ko-KR') : s;
}

/**
 * 구분 — **세 가지로만 선다**(사장님 2026-08-14 — 「신차렌트 / 중고렌트 / 중고구독」).
 * 캐논은 `lib/intake/entities.PRODUCT_TYPES` 다. 공급사 시트에는 「신차」·「재렌트」·「신차(선출고)」
 * 처럼 옛 표기가 섞여 있어, 옮길 때 갈아 넣지 않으면 같은 상품이 네 가지 이름으로 선다.
 * ⚠ 모르는 말은 **그대로 둔다** — 「구독」 하나만 적힌 칸을 중고구독으로 단정하지 않는다.
 */
export function productType(v: unknown): string {
  const s = S(v).replace(/\s|\(.*?\)/g, '');
  if (!s) return '';
  if (/^신차구독$/.test(s)) return '신차구독';
  if (/^(중고구독|재구독)$/.test(s)) return '중고구독';
  if (/^(중고렌트|재렌트|중고)$/.test(s)) return '중고렌트';
  if (/^(신차렌트|신차)$/.test(s)) return '신차렌트';
  return S(v);
}

/** 돈 칸 · 면책금 칸 · 그 밖 — 열 이름으로 가른다. */
const MONEY_COL = /^(단기보증|장기보증|보증금|보증금 반납형|보증금 인수형|\d+개월(\(인수형\))?|소비자가격)$/;
const LIMIT_COL = /^(대인|대물|자차|자손|무보험)$/;
const MAN_COL = /^(21세|23세|1만\+|분납)$/;

/**
 * 한 칸을 정제한다. **열 이름이 규칙을 고른다.**
 * ⚠ 여기 없는 열은 **손대지 않는다** — 모르는 칸을 건드리는 게 곧 «우리가 만든 오류»다.
 */
export function cleanCell(column: string, value: unknown): string {
  const s = S(value);
  if (!s) return '';
  if (MONEY_COL.test(column)) return wonCell(s);
  if (LIMIT_COL.test(column)) return limitCell(s);
  if (MAN_COL.test(column)) return manOnly(s);
  if (column === '연주행') return yearlyKm(s);
  if (column === 'Km' || column === '주행거리' || column === '배기량') return plainNumber(s);
  if (column === '세부트림' || column === '트림') return NOT_A_TRIM.test(s) ? '' : s;
  if (column === '구분' || column === '상품구분') return productType(s);
  return s;
}
