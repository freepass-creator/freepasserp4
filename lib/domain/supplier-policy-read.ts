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

/** 「정책」 탭 값 표 → 정책표. 머리 두 줄(정책코드·정책명)로 열을 가른다. */
export function readPolicyTab(rows: string[][]): PolicyBook {
  const book: PolicyBook = new Map();
  if (!rows.length) return book;
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

/** 그 차에 적용될 정책. 코드가 없거나 못 찾으면 프리패스 기본으로 떨어진다. */
export function policyFor(book: PolicyBook, code: string): Map<string, string> {
  return book.get(S(code)) || book.get('') || new Map();
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

/** 판매시트 열 ← 정책 항목. 한 항목이 그대로 오는 것들. */
export const POLICY_DIRECT: Record<string, string> = {
  무보험: '무보험보상',
  정비: '정비',
  운전자범위: '개인운전자범위',
  연주행: '기본주행',
  '1만+': '추가주행 금액',
  분납: '보증금분납',
  // ★새로 세우는 칸 — 값이 공급사마다 갈리고 영업이 바로 묻는 것만(실측 2026-08-14)
  보험료: '보험료',
  대여지역: '대여지역',
  탁송비: '탁송비',
  면허기간: '면허기간',
  최대연령: '최대연령',
  추가운전자: '추가운전자',
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

/** 한 차의 부가정보 칸을 정책에서 만든다. 재고탭 값이 있으면 그쪽이 이긴다(그 차만의 예외). */
export function policyCell(column: string, p: Map<string, string>): string {
  if (column === '자차') return ownDamageCell(p);
  if (column === '21세') return ageCell(p, 21);
  if (column === '23세') return ageCell(p, 23);
  const pair = POLICY_PAIR[column];
  if (pair) return limitPair(S(p.get(pair[0])), S(p.get(pair[1])));
  const direct = POLICY_DIRECT[column];
  if (direct) return S(p.get(direct));
  return '';
}
