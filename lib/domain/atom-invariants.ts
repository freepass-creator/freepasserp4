/**
 * 원자 불변식(SSOT) — «절대 실수할 수 없는 엔진»의 심장 (사장님 2026-09-05).
 *
 * 「엔진부터 확실히. 절대 실수할 수 없는. AI 넷이 머리 맞대 백 년 연구한 것처럼.」
 *
 * ★핵심 사상: 규칙을 «감사(사후 청소)»가 아니라 «게이트(확정 조건)»로 둔다.
 *   원자가 아래 불변식을 어기면 «확정(확정=true)»이 «될 수 없다» — 검수대기로 떨어진다.
 *   그래서 «전기차인데 배기량 3500cc»·«가솔린인데 일렉트리파이드»·«마스터에 없는 세부모델» 같은
 *   모순이 «확정된 채로» 존재하는 것이 구조적으로 불가능하다.
 *
 * ★한 곳에서만 판정한다. ingest(원자화)·audit(전수검사)·check(게이트)가 «이 함수»를 쓴다.
 *   규칙이 세 곳에 흩어지면 한 곳이 언젠가 달라진다 — 그게 2026-09-05 의 일렉트리파이드 사고였다.
 *
 * 순수 함수(서버·스크립트·게이트 어디서나). 마스터 조회는 호출부가 인덱스로 넘긴다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

// ── 공용 파서(원문·연료·인승) — 여기가 유일한 정의. ingest·audit 이 재수입한다. ────────
export const EV_SUB = /일렉트리파이드|일렉트릭|electric|\bev\b/i;
export const FUEL_EV = /^(전기|수소)$|\bev\b|electric|fcev/i;

/** 연료 정규화 — HEV·가솔린+전기 → 하이브리드, lpi·LPG → LPG. 원문·원자를 같은 잣대로. */
export function canonFuel(s: unknown): string {
  const r = N(s);
  if (/phev|플러그인/.test(r)) return '플러그인';
  if (/hev|하이브리드|hybrid|가솔린\+전기|전기\+가솔린/.test(r)) return '하이브리드';
  if (/수소|fcev/.test(r)) return '수소';
  if (/전기|electric|(?:^|[^a-z])ev(?:[^a-z]|$)/.test(r)) return '전기';
  if (/디젤|diesel/.test(r)) return '디젤';
  if (/lpg|lpi|엘피지/.test(r)) return 'LPG';
  if (/가솔린|gasoline|휘발유/.test(r)) return '가솔린';
  return '';
}
/** 원문에서 배기량(L) — 「2.5」「3.5T」. */
export function rawLiter(raw: unknown): number {
  const m = [...S(raw).matchAll(/(\d\.\d)\s*t?\b/gi)].map((x) => Number(x[1])).filter((n) => n >= 0.8 && n <= 6.5);
  return m[0] || 0;
}
/** 원문에서 인승 — 「N인승」·「밴/화물」(=2). 없으면 빈문자(마스터엔 인승이 없다 · 없으면 필수 아님). */
export function rawSeats(raw: unknown): string {
  const s = S(raw); const m = s.match(/(\d{1,2})\s*인승/); if (m) return m[1];
  return /(^|[^가-힣])밴([^가-힣]|$)|화물/.test(s) ? '2' : '';
}
/** 리터 → 표준 배기량(cc). */
const LITER_CC: Record<string, number> = { '1.0': 998, '1.2': 1197, '1.4': 1353, '1.5': 1497, '1.6': 1598, '2.0': 1999, '2.2': 2199, '2.4': 2359, '2.5': 2497, '3.0': 2999, '3.3': 3342, '3.5': 3470, '3.8': 3778 };
export const literToCc = (l: number): number => LITER_CC[l.toFixed(1)] || Math.round(l * 1000);
const hasCc = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) > 0;
const ccNum = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) || 0;

// ── 불변식 판정 ────────────────────────────────────────────────────────────
export type Severity = 'block' | 'warn';
export type Violation = { code: string; severity: Severity; msg: string };

/** 원자가 참조하는 최소 필드. */
export type AtomView = {
  maker?: unknown; model?: unknown; sub_model?: unknown; trim_name?: unknown;
  fuel_type?: unknown; engine_cc?: unknown; seats?: unknown;
  source?: unknown; source_schema?: unknown; provider_company_code?: unknown; partner_code?: unknown;
  원문?: { 차명?: unknown } | unknown;
};
/** 마스터 조회 — 호출부가 인덱스로 넘긴다(순수 유지). */
export type MasterIndex = {
  validSub: (maker: unknown, model: unknown, sub: unknown) => boolean;   // (제조사·모델·세부모델)이 마스터 실재?
  trimsOf: (maker: unknown, model: unknown, sub: unknown) => string[];   // 그 세부모델의 마스터 트림[]
};

const rawOf = (a: AtomView): string => S((a.원문 as { 차명?: unknown } | undefined)?.차명);

/**
 * 원자의 불변식 위반 목록. block 이 하나라도 있으면 «확정 불가»(검수대기).
 * warn 은 확정은 되나 눈에 띄게 남긴다.
 */
export function atomViolations(a: AtomView, m: MasterIndex): Violation[] {
  const v: Violation[] = [];
  const sub = S(a.sub_model), fuel = canonFuel(a.fuel_type), cc = S(a.engine_cc);
  const raw = rawOf(a);
  const subEv = EV_SUB.test(sub);
  const evFuel = fuel === '전기' || fuel === '수소';

  // 1) 정체 실재 — 세부모델이 있으면 마스터 실재값이어야 한다.
  if (sub && !m.validSub(a.maker, a.model, sub)) v.push({ code: 'IDENT', severity: 'block', msg: `세부모델 「${sub}」이 차종마스터에 없다` });

  // 2) 전기 ↔ 배기량 배타 — 전기·수소차엔 배기량이 없고, 배기량이 있으면 전기차가 아니다(사장님 규칙).
  if (evFuel && hasCc(cc)) v.push({ code: 'EV_CC', severity: 'block', msg: `연료 ${S(a.fuel_type)} 인데 배기량 ${cc}` });
  if (subEv && hasCc(cc)) v.push({ code: 'EVSUB_CC', severity: 'block', msg: `세부모델 EV(${sub}) 인데 배기량 ${cc} = 내연차` });
  if (subEv && !evFuel && fuel) v.push({ code: 'EVSUB_FUEL', severity: 'block', msg: `세부모델 EV 인데 연료 ${S(a.fuel_type)}` });

  // 3) 연료 원문정합 — 원문에 연료말이 있으면 원자 연료와 같아야 한다.
  const rf = canonFuel(raw);
  if (rf && fuel && rf !== fuel) v.push({ code: 'FUEL_RAW', severity: 'warn', msg: `원문 연료 ${rf} ≠ 원자 ${fuel}` });

  // 4) 배기량 원문정합 — 원문 리터(2.5·3.5)와 배기량이 맞아야 한다(전기·수소 제외).
  const rl = rawLiter(raw);
  if (rl && hasCc(cc) && !evFuel && Math.abs(rl - ccNum(cc) / 1000) > 0.2) v.push({ code: 'CC_RAW', severity: 'warn', msg: `원문 ${rl}L ≠ 배기량 ${cc}cc` });

  // 5) 트림 실재 — 세부트림은 그 세부모델 마스터 트림이거나 비어야 한다.
  const trim = S(a.trim_name);
  if (trim && sub) { const trims = m.trimsOf(a.maker, a.model, sub); if (trims.length && !trims.some((t) => N(t) === N(trim))) v.push({ code: 'TRIM', severity: 'warn', msg: `트림 「${trim}」이 마스터 트림 밖` }); }

  // 6) 인승 — 원문에 있는 것만. 2인은 원문에 밴/2인승 있을 때만.
  const seats = S(a.seats), rs = rawSeats(raw);
  if (rs && seats && rs !== seats) v.push({ code: 'SEATS_RAW', severity: 'warn', msg: `원문 ${rs}인 ≠ 원자 ${seats}인` });
  if (seats === '2' && !rs) v.push({ code: 'SEATS_2', severity: 'warn', msg: `2인인데 원문에 밴/2인승 표기 없음` });

  // 7) 원천 추적 — 어디서 왔는지 있어야 한다(정밀타격).
  if (!S(a.source) && !S(a.source_schema)) v.push({ code: 'PROV', severity: 'warn', msg: `원천(source) 없음` });

  return v;
}

/** 확정 가능? — block 위반이 하나도 없으면 확정 가능. */
export function isConfirmable(a: AtomView, m: MasterIndex): boolean {
  return !atomViolations(a, m).some((x) => x.severity === 'block');
}
