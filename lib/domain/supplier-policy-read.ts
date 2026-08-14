/**
 * **공급사 「정책」 탭을 읽어 차마다 붙일 값으로 만든다.**
 *
 * ★왜(사장님 2026-08-14 — 「상품시트에 옵션 뒷쪽 칸으로 정비 좀 했으면 좋겠는데,
 *   영업자가 어차피 이 부분은 부가 정보 확인하는 곳이라서 공급사 정책 중에
 *   영업자한테 보여줘야 할 항목을 넣어주면 좋거든」)
 *
 *   지금은 뒤쪽 부가정보를 **공급사 재고탭에 우연히 있는 칸에서 낱개로 긁어** 온다. 그래서
 *   실측 2026-08-14 기준 —
 *     차고지·운전자범위·정비  77대(20%) · 값 1종      ← 한 곳만 채워 사실상 죽은 열
 *     대인                  「무한/30」 · 「50만 / 무한」 ← 앞뒤가 뒤집힌 표기가 섞임
 *     자차                  「400/50~100」·「차량/50-100」·「차량/50~100」 ← 같은 뜻 세 표기
 *   같은 값이 「정책」 탭에는 **29항목 · 17곳 전부** 구조적으로 들어 있다. 낱개로 긁을 일이 아니라
 *   **정책코드로 조인**할 일이다.
 *
 * ★정책 탭 생김새 — **행이 항목, 열이 정책**이다(가로가 아니라 세로로 읽는다).
 *     A열=항목이름 │ B열=프리패스 기본 │ C열부터=그 공급사 정책코드별 값
 *   차에 적힌 정책코드로 그 열을 찾고, 없으면 **B열(기본)** 로 떨어진다.
 *
 * ⚠ 여기서 **돈은 안 만든다.** 대여료·보증금은 재고탭 글자 그대로다(절대 규칙 ①).
 *   정책은 «조건»이지 «값»이 아니다.
 * ⚠ 값이 없으면 **비운다.** 기본값을 지어내지 않는다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');

/** 한 공급사의 정책표 — 정책코드 → (항목 → 값). `''` 키가 프리패스 기본이다. */
export type PolicyBook = Map<string, Map<string, string>>;

/**
 * 「정책」 탭 값 표 → 정책표.
 * ★2026-08-14 부터 **가로**다 — 1행이 머리, 2행부터가 정책(첫 줄이 프리패스 기본).
 * ⚠ 세로(행=항목·열=정책)도 계속 읽는다. 아직 안 돌린 시트가 있을 수 있고,
 *   못 읽으면 그 공급사 부가정보가 통째로 비는데 화면엔 아무 말도 안 나온다.
 */
export function readPolicyTab(rows: string[][]): PolicyBook {
  const book: PolicyBook = new Map();
  if (!rows.length) return book;
  // ── 가로: 첫 줄이 「정책코드 · 정책명 · …」
  if (norm(rows[0]?.[0]) === '정책코드' && norm(rows[0]?.[1]) === '정책명' && S(rows[0]?.[2])) {
    const hdr = rows[0].map(S);
    for (const r of rows.slice(1)) {
      if (!r.some((c) => S(c))) continue;
      const code = /프리패스 기본/.test(S(r[0])) ? '' : S(r[0]);
      const m = new Map<string, string>();
      hdr.forEach((h, i) => { if (h && !/^정책코드$|^정책명$/.test(norm(h))) { const v = S(r[i]); if (v) m.set(h, v); } });
      book.set(code, m);
    }
    return book;
  }
  const head = rows.find((r) => norm(r[0]) === '정책코드');
  if (!head) return book;
  // 1열 = 프리패스 기본(코드 없음) · 2열부터 = 실제 정책코드
  const codes: [number, string][] = [[1, '']];
  head.forEach((c, i) => { if (i >= 2 && S(c)) codes.push([i, S(c)]); });
  for (const [, code] of codes) book.set(code, new Map());
  for (const r of rows) {
    const field = S(r[0]);
    if (!field || norm(field) === '정책코드' || norm(field) === '정책명') continue;
    for (const [i, code] of codes) {
      const v = S(r[i]);
      if (v) book.get(code)!.set(field, v);
    }
  }
  return book;
}

/** 정책을 어떻게 골랐나 — 조용히 틀린 값이 나가지 않게 밖에서 셀 수 있어야 한다. */
export type PolicyPick = { p: Map<string, string>; how: '코드' | '유일' | '기본' | '없음' };

/**
 * 그 차에 적용될 정책.
 *
 * ★**코드가 비면 그 공급사의 정책이 하나뿐일 때 그것을 쓴다.**
 *   ⚠ 예전엔 곧장 「프리패스 기본」으로 떨어졌다. 그건 그 공급사 조건이 아니라 **우리 표준값**이라,
 *     205대(57%)가 조용히 남의 조건을 달고 나갔다(실측 2026-08-14).
 *   ⚠ 정책이 **여럿인데** 코드가 비면 못 정한다 — 기본으로 떨어뜨리되 «못 정했다»고 알린다.
 *     빌린카(3개)·손오공(2개)이 그렇다. 짐작해서 아무거나 붙이면 그게 곧 우리가 만든 오류다.
 */
export function pickPolicy(book: PolicyBook, code: string): PolicyPick {
  const c = S(code);
  if (c && book.has(c)) return { p: book.get(c)!, how: '코드' };
  const own = [...book.entries()].filter(([k]) => k);
  if (!c && own.length === 1) return { p: own[0][1], how: '유일' };
  const base = book.get('');
  if (base) return { p: base, how: '기본' };
  return { p: new Map(), how: '없음' };
}

/** 값만 필요할 때. 어떻게 골랐는지도 봐야 하면 `pickPolicy` 를 쓴다. */
export function policyFor(book: PolicyBook, code: string): Map<string, string> {
  return pickPolicy(book, code).p;
}

/**
 * 보상한도와 면책금을 한 칸으로 — 영업자가 보던 「무한/30」 꼴.
 * ⚠ 앞이 보상, 뒤가 면책이다. 뒤집으면 손님에게 정반대로 말하게 된다
 *   (재고탭에는 「50만 / 무한」처럼 뒤집힌 표기가 섞여 있었다).
 * ⚠ 한쪽만 있으면 있는 쪽만 쓴다. 없는 쪽을 0이나 「없음」으로 채우지 않는다.
 */
export function limitPair(cover: string, deduct: string): string {
  const a = S(cover);
  const b = manOnly(S(deduct));
  if (a && b) return `${a}/${b}`;
  return a || b || '';
}

/** 면책금은 만원 단위 숫자 하나로 — 「50만원」→「50」. 말은 그대로 둔다. */
function manOnly(v: string): string {
  if (!v || v === '없음') return v;
  const m = v.match(/([\d,]+)\s*만/);
  if (m) return m[1].replace(/,/g, '');
  if (/^[\d,]+$/.test(v)) {
    const n = Number(v.replace(/,/g, ''));
    if (n >= 10000 && n % 10000 === 0) return String(n / 10000);
  }
  return v;
}

/** 자차는 최소~최대가 따로 있다 — 「차량가액/50~100」. */
export function ownDamageCell(p: Map<string, string>): string {
  const cover = S(p.get('자차보상한도'));
  const lo = manOnly(S(p.get('자차최소면책금')));
  const hi = manOnly(S(p.get('자차최대면책금')));
  const ded = lo && hi && lo !== hi ? `${lo}~${hi}` : (lo || hi);
  return limitPair(cover, ded);
}

/**
 * 연령 하향 — 「만21세까지」처럼 어디까지 내려 주는지와 그 요금이 따로 적혀 있다.
 * 판매시트는 21세·23세 두 칸으로 나눠 보여 준다. 그 나이까지 안 내려 주면 「불가」다.
 */
export function ageCell(p: Map<string, string>, age: 21 | 23): string {
  const scope = S(p.get('연령인하'));
  const fee = S(p.get('연령 하향 요금'));
  if (!scope) return '';
  if (/불가/.test(scope)) return '불가';
  if (/협의/.test(scope)) return '협의';
  const m = scope.match(/(\d{2})/);
  const down = m ? Number(m[1]) : 0;
  if (!down || down > age) return '불가';
  return manOnly(fee) || '가능';
}

/**
 * 승계 — 영업자 화면에는 **한 칸**이다(사장님 2026-08-14 — 「불가 또는 금액 입력해주면 되고」).
 *   불가면 「불가」, 협의면 「협의」, 그 밖이면 **금액**을 보여 준다.
 * ⚠ 「가능」인데 금액이 비어 있으면 「가능(금액 미정)」으로 둔다 —
 *   금액을 지어내면 손님에게 잘못 말하게 되고, 그냥 「가능」만 보여 주면
 *   영업자가 «공짜»로 읽는다. 비어 있다는 사실 자체를 보여 줘야 공급사에 물어본다.
 */
export function successionCell(p: Map<string, string>): string {
  const can = S(p.get('승계 가능여부'));
  const fee = S(p.get('승계수수료'));
  if (/불가/.test(can)) return '불가';
  if (!can && !fee) return '';
  if (/협의/.test(can)) return fee ? `협의 (${wonText(fee)})` : '협의';
  return fee ? wonText(fee) : '가능(금액 미정)';
}

/** 「1000000」을 「1,000,000」으로. 숫자가 아니면 그대로 둔다. */
function wonText(v: string): string {
  if (!/^[\d,]+$/.test(v)) return v;
  const n = Number(v.replace(/,/g, ''));
  return n > 0 ? n.toLocaleString('ko-KR') : v;
}

/**
 * 자격 — 연령과 면허를 **한 칸**으로. 셋 다 짧고 함께 읽힌다.
 *   「만 26~65세 · 면허 1년 이상」
 * ⚠ 「제한없음」은 그대로 쓴다. 없는 조건을 만들지 않는다.
 */
export function qualifyCell(p: Map<string, string>): string {
  const base = S(p.get('기본운전자연령')).replace(/^만\s*/, '').replace(/\s*이상$/, '');
  const max = S(p.get('최대연령')).replace(/^만\s*/, '').replace(/\s*이하$/, '');
  const lic = S(p.get('면허기간'));
  const age = base && max ? `만 ${base}~${max}` : (base ? `만 ${base} 이상` : (max ? `만 ${max} 이하` : ''));
  const l = lic && !/제한없음/.test(lic) ? `면허 ${lic}` : (lic ? '면허 제한없음' : '');
  return [age, l].filter(Boolean).join(' · ');
}

/** 추가운전자 — 인원과 요금을 한 칸으로. 「1인 (월 5만원)」 */
export function extraDriverCell(p: Map<string, string>): string {
  const n = S(p.get('추가운전자'));
  const fee = S(p.get('추가운전자 요금'));
  if (!n) return '';
  if (/불가/.test(n)) return '불가';
  return fee ? `${n} (${fee})` : n;
}

/** 초과주행 — 국산·수입이 다르면 둘 다. 같으면 하나. 「국산 200 · 수입 400」 */
export function overMileageCell(p: Map<string, string>): string {
  const d = S(p.get('초과주행 국산(1km당)'));
  const i = S(p.get('초과주행 수입(1km당)'));
  if (!d && !i) return '';
  if (d && i && d !== i) return `국산 ${d} · 수입 ${i}`;
  return d || i;
}

/** 중도해지 — 1년 미만·이상이 다르면 둘 다. 「1년미만 30% · 이상 20%」 */
export function earlyTerminationCell(p: Map<string, string>): string {
  const a = S(p.get('중도해지 위약금 1년미만'));
  const b = S(p.get('중도해지 위약금 1년이상'));
  if (!a && !b) return '';
  if (a && b && a !== b) return `1년미만 ${a} · 이상 ${b}`;
  return a || b;
}

/**
 * 연령하향 — **한 칸**으로(사장님 2026-08-14 — 「연령 상향도 지금 칸 나눠놨는데 한 칸에 써줘」).
 *   예전엔 21세·23세 두 칸이었는데 요금은 한 값이라 같은 숫자가 두 번 섰다.
 *   「만 21세까지 · 10만원」 처럼 «어디까지»와 «얼마»를 함께 보여 준다.
 * ⚠ 못 낮추면 「불가」다. 빈칸으로 두면 «모른다»로 읽혀 영업자가 물어보게 된다.
 */
export function ageDownCell(p: Map<string, string>): string {
  const scope = S(p.get('연령인하'));
  const fee = S(p.get('연령 하향 요금'));
  if (!scope && !fee) return '';
  if (/불가/.test(scope) || /불가/.test(fee)) return '불가';
  if (/협의/.test(scope)) return fee && !/협의/.test(fee) ? `협의 · ${fee}` : '협의';
  return [scope, fee].filter(Boolean).join(' · ');
}

/**
 * 정비 — 지정 정비점과 **한 칸**으로. 「미제공」이면 어디서 받는지는 물을 일이 없다.
 *   포함이면 「포함 · 지정 협력 정비공장」.
 */
export function maintenanceCell(p: Map<string, string>): string {
  const m = S(p.get('정비'));
  const where = S(p.get('지정 정비점'));
  if (!m) return where;
  if (/미제공|불포함|없음/.test(m)) return m;
  return where ? `${m} · ${where}` : m;
}

/** 보증금 결제 — 분납과 카드를 한 칸으로. 「2회까지 · 카드 가능」 */
export function depositPayCell(p: Map<string, string>): string {
  const part = S(p.get('보증금분납'));
  const card = S(p.get('보증금카드결제'));
  if (!part && !card) return '';
  const c = card ? `카드 ${card}` : '';
  return [part, c].filter(Boolean).join(' · ');
}

/**
 * 운전자범위 — **두 갈래로 요약**한다(사장님 2026-08-14 —
 *   「계약자 본인만이 있을 수 있고, 기본(직계, 임직원) 이렇게」).
 *
 *   본인만  계약자 본인만 · 대표자 본인만 · 본인+추가운전자
 *   기본    직계가족·임직원까지 포함하는 흔한 경우
 *   협의
 *
 * ★개인·법인을 **한 칸**으로 합친다. 둘이 다르면 「개인 기본 · 법인 본인만」처럼 갈라 적는다.
 * ⚠ 원문(「계약자와 배우자 및 직계가족」)은 정책 탭에 그대로 있다. 여기서는 훑을 수 있어야 한다 —
 *   긴 문장이 39칸 뒤쪽에 늘어서면 아무도 안 읽는다.
 * ⚠ 「본인+추가운전자」를 «기본»으로 넣지 마라. 직계가 기본 포함이 아니라는 뜻이고,
 *   추가운전자는 옆 칸에 인원·요금으로 따로 선다.
 */
export function driverScopeCell(p: Map<string, string>): string {
  const bucket = (v: string) => {
    const x = S(v);
    if (!x) return '';
    if (/협의/.test(x)) return '협의';
    if (/본인만|본인\s*\+|대표자/.test(x)) return '본인만';
    return '기본';
  };
  const me = bucket(S(p.get('개인운전자범위')));
  const biz = bucket(S(p.get('법인운전자범위')));
  if (!me && !biz) return '';
  if (!biz || me === biz) return me || biz;
  if (!me) return `법인 ${biz}`;
  return `개인 ${me} · 법인 ${biz}`;
}

/** 판매시트 열 ← 정책 항목. 한 항목이 그대로 오는 것들. */
export const POLICY_DIRECT: Record<string, string> = {
  /**
   * ★**공급사가 적은 칸을 그대로 나열한다**(사장님 2026-08-14 —
   *   「공급사가 입력하게끔 해놓고 그걸 쫙 나열하는 거니까 오류 없게」).
   *   합칠 때마다 우리 해석이 들어가고, 거기가 곧 «우리가 만든 오류»가 나는 자리다.
   * ★합친 채로 두는 것은 둘뿐이다 —
   *   「승계」·「운전자범위」는 사장님이 그렇게 해 달라고 한 것이고,
   *   「대인·대물·자차·자손」은 우리가 만든 게 아니라 영업자가 몇 년 보던 「무한/30」 형식이다.
   */
  기본연령: '기본운전자연령',
  최대연령: '최대연령',
  면허기간: '면허기간',
  추가운전자: '추가운전자',
  '추가운전자 요금': '추가운전자 요금',
  '초과주행 국산': '초과주행 국산(1km당)',
  '초과주행 수입': '초과주행 수입(1km당)',
  '중도해지 1년미만': '중도해지 위약금 1년미만',
  '중도해지 1년이상': '중도해지 위약금 1년이상',
  최소연령: '연령인하',
  '연령하향 요금': '연령 하향 요금',
  정비: '정비',
  '지정 정비점': '지정 정비점',
  분납: '보증금분납',
  '보증금 카드결제': '보증금카드결제',
  무보험: '무보험보상',
  연주행: '기본주행',
  '1만+': '추가주행 금액',
  '추가주행 방식': '추가주행 방식',
  보험료: '보험료',
  '가입 보험사': '가입 보험사',
  긴급출동: '긴급출동',
  '사고·정비 대차': '대차 정책',
  '자차 보상제외': '자차 처리 제외',
  'GPS 장착': 'GPS 장착',
  대여지역: '대여지역',
  탁송비: '탁송비',
  '사고다발 해지기준': '사고 다발 해지기준',
  '자차 자기부담률': '자차수리비율',
};

/** 두 항목을 한 칸으로 합치는 것들. [보상, 면책] */
export const POLICY_PAIR: Record<string, [string, string]> = {
  대인: ['대인보상한도', '대인면책금'],
  대물: ['대물보상한도', '대물면책금'],
  자손: ['자손보상', '자손면책금'],
};

/**
 * 어디나 값이 같아 «열로 세울 값어치가 없는» 항목(실측 2026-08-14).
 * 표 아래 각주로 한 번만 적는다 — 열로 세우면 같은 글자가 379줄 반복된다.
 */
export const POLICY_CONSTANTS: [string, string][] = [
  ['대인 보상한도', '무한'],
  ['기본 운전자연령', '만 26세 이상'],
  ['긴급출동', '연간 5회'],
];

/**
 * ★**«채우라는 말»은 값이 아니다.** 「공급사 기재」가 「가입 보험사」 칸에 그대로 들어 있어
 *   영업자가 보험사 이름으로 읽는다(실측 2026-08-14 · 18곳 전부). 그런 자리표시는 비운다.
 * ⚠ 「해당없음」·「없음」은 지우지 마라 — 그건 실제 답이다.
 */
const PLACEHOLDER = /^(공급사\s*기재|공급사기재|미입력|입력\s*요망|기재\s*요망|추후\s*기재|-)$/;
const notPlaceholder = (v: string) => (PLACEHOLDER.test(S(v)) ? '' : S(v));

/** 한 차의 부가정보 칸을 정책에서 만든다. 재고탭 값이 있으면 그쪽이 이긴다(그 차만의 예외). */
export function policyCell(column: string, p: Map<string, string>): string {
  if (column === '자차') return ownDamageCell(p);
  if (column === '승계') return successionCell(p);
  if (column === '운전자범위') return driverScopeCell(p);
  if (column === '21세') return ageCell(p, 21);
  if (column === '23세') return ageCell(p, 23);
  const pair = POLICY_PAIR[column];
  if (pair) return limitPair(S(p.get(pair[0])), S(p.get(pair[1])));
  const direct = POLICY_DIRECT[column];
  if (direct) return notPlaceholder(S(p.get(direct)));
  return '';
}
