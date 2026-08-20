/**
 * **정제시트(우리 규격 「○○ 프리패스 재고」) ← 공급사 원본** 열 대응.
 *
 * ★사장님 2026-08-18 — 「아이카·오토플러스·아이언·이안카 정제시트 만들어서 실시간 연동」 ·
 *   「상품마스터로 올 때는 어찌됐든 정제시트 통해서」.
 *   공급사가 자기 시트(또는 홈페이지)에 어떻게 적든, 우리 규격 열에 옮겨 담는 것이 이 표의 일이다.
 *   그 뒤로는 판매시트·상품마스터·ERP 가 전부 정제시트만 읽는다.
 *
 * ★**값은 그대로 옮긴다.** 규격값으로 맞추는 건 셋뿐이다 — 상태(`canonSheetVehicleStatus`, ERP 와 같은 판정) ·
 *   분류(`canonProductType`) · 연료(`normFuel`). 돈·주행거리·색·차명은 공급사 글자 그대로다.
 *   보증금을 규칙으로 계산하지 않는다(오토플러스처럼 시트에 없으면 비운다 — ERP 가 partner.deposit_rule 로 처리).
 * ★열 이름은 공백을 뗀 뒤 견준다. 여기 없는 원본 열 이름은 **같은 이름**일 때만 옮겨진다
 *   (오토플러스 「12개월2만」·「18개월3만」 같은 주행 구간 열이 그렇다 — 정제시트 머리행에 같은 이름을 둔다).
 */
import { canonSheetVehicleStatus } from './sheet-import';
import { canonProductType } from './product';
import { normFuel } from './vehicle-master-format';
import { VALUE_LISTS } from './supplier-template-sheet';
import { MAKER_ALIASES, canonMakerDisplay, isStandardMaker } from './maker-display';

const S = (v: unknown) => String(v ?? '').trim();
export const normName = (v: unknown) => S(v).replace(/\s+/g, '');

/** [우리 규격 열, 원본 열 이름 후보(앞이 우선)]. 후보는 공백 없이 견준다. */
export const MIRROR_ALIAS: [string, string[]][] = [
  ['차량번호', ['차량번호', '차번']],
  ['입고일자', ['입고일자', '입고일', '판매시작일']],
  ['상태', ['상태', '배차상태', '판매상태', '차량상태', '재고상태', '출고상태', '출고현황']],
  ['분류', ['분류', '구분', '상품구분']],
  ['제조사', ['제조사', '메이커', '브랜드']],
  // ★모델명(사장님 2026-08-19 「제조사·모델명만 검색되면 되고 · 차명은 공급사가 올려준 것」) — 원본 차종/모델 칸에서 제조사 말·연료 꼬리를 떼어 «검색되는 모델 이름»만.
  //   정제시트에 「모델명」 열이 있을 때만 쓰인다(sync-mirror-sheet). 제조사 칸이 원본에 없으면 여기서 떼어 낸 제조사 말을 쓴다.
  ['모델명', ['차종', '모델', '차종분류']],
  // 차명은 아래 composeVehicleName 이 차종/차종분류·세부모델·트림을 합쳐 만든다.
  //   ★「모델명」 열이 있는 정제시트는 합치지 않고 공급사 원문(모델명(트림풀명)) 그대로 — 「차명원문」 으로 따로 내보낸다.
  ['차명(세부모델+트림)', ['차명(세부모델+트림)', '모델명(트림풀명)', '모델명(풀명)', '모델명(트림)', '차명', '모델명', '세부모델', '트림']],
  ['옵션', ['옵션', '선택옵션']],
  ['외부색상', ['외부색상', '외장색상', '외장색', '외장', '색상']],
  ['내부색상', ['내부색상', '내장색상', '내장색', '내장']],
  ['연식', ['연식', '년식']],
  ['주행거리', ['주행거리', 'Km', 'km', 'KM', '예상주행거리', '주행']],
  ['연료', ['연료', '유종']],
  ['배기량', ['배기량']],
  ['차량가격', ['차량가격', '소비자가격', '소비자가', '차량가']],
  ['단기보증', ['단기보증']],
  ['1개월', ['1개월', '월렌트', '월세']],
  ['6개월', ['6개월']],
  ['12개월', ['12개월', '12개월반납형']],
  ['18개월', ['18개월']],
  ['장기보증', ['장기보증', '보증금', '보증금반납형']],
  ['24개월', ['24개월', '24개월반납형']],
  ['36개월', ['36개월', '36개월반납형']],
  ['48개월', ['48개월', '48개월반납형']],
  ['60개월', ['60개월', '60개월반납형']],
  ['72개월', ['72개월']],
  ['84개월', ['84개월']],
  ['최초등록일', ['최초등록일', '최초등록', '최초등록년월', '등록일']],
  ['사진링크', ['사진링크', '사진', '차량사진', '사진주소']],
];
/** 차명 앞에 붙일 «모델» 후보 — 원문 차명이 이 말을 안 품고 있을 때만 앞에 둔다. */
const MODEL_PREFIX_CANDIDATES = ['차종', '차종분류', '모델'];
const TRIM_SUFFIX_CANDIDATES = ['트림', '세부트림'];

/** 모델 이름 끝에 붙는 연료 꼬리 — 「볼보 V60 HEV」→「V60」. 이름 전체가 꼬리뿐이면(「EV」) 안 뗀다. EV6·EV9 처럼 앞에 붙은 것은 모델명이다. */
/** 붙여 쓴 제조사 말을 떼기 위한 이름 목록(규격 이름·별칭, 긴 것부터) — 영문/숫자로 끝나는 이름(BMW·KGM)은 모델 글자와 붙으면 구분이 안 되니 뺀다. */
const MAKER_WORDS: string[] = [...Object.keys(MAKER_ALIASES), ...Object.values(MAKER_ALIASES).flat()].filter((n) => /[가-힣]$/.test(n)).sort((a, b) => b.length - a.length);
const FUEL_TAIL = /\s+(HEV|PHEV|EV|hev|phev|ev|하이브리드|전기|디젤|가솔린|LPG|lpg)$/;
/**
 * 원본 차종 글자에서 **제조사 말과 연료 꼬리를 떼어** 검색되는 모델 이름만 남긴다 — 「볼보 V60 HEV」→{볼보, V60} · 「BMW 120i」→{BMW, 120i} · 「니로 EV」→{'', 니로} · 「EV6」→{'', EV6}.
 *   제조사 말은 규격 이름·별칭(maker-display) 중 맨 앞 토큰이 맞을 때만 뗀다. 모델 이름은 지어내지 않는다(차종마스터 모델 이름으로 바꾸는 것은 호출 쪽이 스냅으로).
 */
export function splitMakerModel(raw: unknown): { maker: string; model: string } {
  let v = S(raw).replace(/\s+/g, ' ');
  if (!v) return { maker: '', model: '' };
  let maker = '';
  const first = v.split(' ')[0];
  if (first && isStandardMaker(first) && v.length > first.length) { maker = canonMakerDisplay(first); v = v.slice(first.length).trim(); }
  else if (first && canonMakerDisplay(first) !== first && v.length > first.length) { maker = canonMakerDisplay(first); v = v.slice(first.length).trim(); }
  else {
    // 띄어쓰기 없이 붙은 제조사 말 — 「벤츠C200」·「현대그랜저」(스위치 자산 실측). 긴 이름부터 본다.
    for (const name of MAKER_WORDS) { if (v.length > name.length && v.toLowerCase().startsWith(name.toLowerCase()) && !/^[a-z0-9]$/i.test(name.slice(-1)) ) { maker = canonMakerDisplay(name); v = v.slice(name.length).trim(); break; } }
  }
  for (let n = 0; n < 2; n++) { const m = FUEL_TAIL.exec(v); if (m && v.slice(0, m.index).trim()) v = v.slice(0, m.index).trim(); else break; }
  return { maker, model: v };
}

const FUEL_ALLOWED = new Set(VALUE_LISTS['연료'] || []);
const TYPE_ALLOWED = new Set(VALUE_LISTS['분류'] || []);
const STATUS_ALLOWED = new Set(VALUE_LISTS['상태'] || []);

/**
 * 원문 조각을 «겹치지 않게» 이어 붙인다 — 「BMW X1」+「X1(2세대) 20i」 → 「BMW X1(2세대) 20i」,
 * 「싼타페」+「디 올뉴 싼타페 …」 → 그대로. 이미 들어 있는 토큰은 다시 안 붙인다.
 */
/**
 * ★같은 말이 두 번 들어간 차명을 정리한다(사장님 2026-08-19 「쏘나타 쏘나타 DN8 이런 거는 쏘나타 DN8로 바로 할 수 있잖아」).
 *   「A B A B」→「A B」 · 붙어 있는 「A A」→「A」 · 첫 말이 뒤에 또 나오면 첫 말을 뺀다(숫자 토큰은 그대로).
 *   정본 구현은 scripts/tidy-vehicle-names.mts 와 같은 규칙 — 여기서는 정제시트 유입 때 미리 적용한다.
 */
export function tidyDuplicateWords(raw: unknown): string {
  const k = (t: string) => t.toLowerCase().replace(/[\s\-_./()（）·,]/g, '');
  let toks = S(raw).replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (toks.length >= 2 && toks.length % 2 === 0) { const h = toks.length / 2; if (k(toks.slice(0, h).join(' ')) === k(toks.slice(h).join(' '))) toks = toks.slice(0, h); }
  for (let i = 0; i < toks.length - 1;) { if (k(toks[i]) && k(toks[i]) === k(toks[i + 1])) toks.splice(i, 1); else i++; }
  if (toks.length > 2 && k(toks[0]).length >= 2 && !/\d/.test(toks[0]) && toks.slice(1).some((t) => k(t) === k(toks[0]))) toks = toks.slice(1);
  return toks.join(' ').trim();
}

export function composeVehicleName(prefix: string, primary: string, suffix = ''): string {
  const p = S(primary);
  const has = (hay: string, needle: string) => normName(hay).toLowerCase().includes(normName(needle).toLowerCase());
  const pre = S(prefix).split(/\s+/).filter((t) => t && !has(p, t)).join(' ');
  const suf = S(suffix) && !has(p, suffix) && !has(pre, suffix) ? S(suffix) : '';
  return [pre, p, suf].filter(Boolean).join(' ').trim();
}

/**
 * 날짜 표기만 규격(YYYY-MM-DD)으로 — 「23-9-21」·「2025. 3. 25」·「26년3월」.
 * ⚠ 두 자리 연도를 그대로 시트에 넣으면 구글이 1921·1930년으로 읽는 함정이 있다(google-sheets-traps).
 *   못 읽는 글자는 그대로 둔다(지어내지 않는다).
 */
export function canonMirrorDate(raw: string): string {
  const v = S(raw);
  if (!v) return '';
  const pad = (n: string) => n.padStart(2, '0');
  const yyyy = (y: string) => (y.length === 2 ? `20${y}` : y);
  let m = /^(\d{2}|\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})[일.]?$/.exec(v);
  if (m) return `${yyyy(m[1])}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{2}|\d{4})[.\-/년]\s*(\d{1,2})월?\.?$/.exec(v);
  if (m) return `${yyyy(m[1])}-${pad(m[2])}`;
  return v;
}

/** 규격값으로 맞추는 칸 — 상태·분류·연료, 그리고 날짜 표기. 맞출 수 없으면 원문 그대로 둔다(지어내지 않는다). */
export function canonMirrorValue(column: string, raw: string): string {
  const v = S(raw);
  if (!v) return '';
  const c = normName(column);
  if (c === '입고일자' || c === '최초등록일') return canonMirrorDate(v);
  if (c === '제조사') return canonMakerDisplay(v);   // 사장님 2026-08-18 — 르노·KGM 한 이름으로
  if (c === '상태') { const s = canonSheetVehicleStatus(v); return STATUS_ALLOWED.has(s) ? s : v; }
  if (c === '분류') { const t = canonProductType(v); return TYPE_ALLOWED.has(t) ? t : v; }
  if (c === '연료') { const f = normFuel(v); const disp = f === 'lpg' ? 'LPG' : f; return FUEL_ALLOWED.has(disp) ? disp : v; }
  return v;
}

/**
 * 원본 한 줄(열이름→값) → 우리 규격 열이름(공백 없이)→값.
 * 별칭에 없는 원본 열은 같은 이름으로 그대로 얹는다(오토플러스 주행 구간 열 등). 별칭 결과가 이긴다.
 */
export function projectSourceRow(row: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of row) if (S(value)) out.set(normName(name), S(value));
  const pick = (cands: string[]) => { for (const c of cands) { const v = row.get(normName(c)); if (S(v)) return S(v); } return ''; };
  for (const [ours, cands] of MIRROR_ALIAS) {
    let v = pick(cands);
    if (ours === '차명(세부모델+트림)') {
      if (v) out.set('차명원문', tidyDuplicateWords(composeVehicleName('', v, pick(TRIM_SUFFIX_CANDIDATES))));   // ★「모델명」 열이 있는 정제시트는 이것을 차명(세부모델+트림)에 쓴다 — 공급사 원문 그대로(차종 안 붙임, 트림 글자가 따로 있으면 뒤에 한 번만)
      v = composeVehicleName(pick(MODEL_PREFIX_CANDIDATES), v, pick(TRIM_SUFFIX_CANDIDATES));
    }
    if (ours === '모델명' && v) {
      const sp = splitMakerModel(v);
      v = sp.model;
      if (sp.maker && !S(row.get('제조사')) && !out.get('제조사')) out.set('제조사', sp.maker);
    }
    if (!v) continue;
    out.set(normName(ours), canonMirrorValue(ours, v));
  }
  // ★연식이 원본에 없으면 최초등록일의 연도(사장님 2026-08-18 「빈 칸 다 보라고」 — 아이카·이안카·오플은 연식 칸이 없다).
  //   업계 관행(연식 ≈ 최초등록 연도)이고 정제시트 안내에 적어 둔다. 원본에 연식이 있으면 그것이 이긴다.
  if (!out.get('연식')) { const y = /^(\d{4})/.exec(out.get('최초등록일') || ''); if (y) out.set('연식', y[1]); }
  return out;
}

/**
 * **원본 머리행 → 우리 열 대응표(값 없이 이름만).** 매뉴얼·감사가 쓴다 — projectSourceRow 와 같은 우선순위(앞 후보가 이긴다).
 * 돌려주는 것: 우리 열(공백 없이) → 그 열을 만드는 원본 머리글들(원문 표기). 별칭에 없는 원본 열은 같은 이름일 때 자기 자신.
 */
export function sourceColumnsFor(sourceHeader: string[]): Map<string, string[]> {
  const byNorm = new Map<string, string>();
  for (const h of sourceHeader) if (S(h) && !byNorm.has(normName(h))) byNorm.set(normName(h), S(h));
  const first = (cands: string[]) => { for (const c of cands) { const v = byNorm.get(normName(c)); if (v) return v; } return ''; };
  const out = new Map<string, string[]>();
  for (const [ours, cands] of MIRROR_ALIAS) {
    const parts = ours === '차명(세부모델+트림)'
      ? [first(MODEL_PREFIX_CANDIDATES), first(cands), first(TRIM_SUFFIX_CANDIDATES)].filter(Boolean)
      : [first(cands)].filter(Boolean);
    if (parts.length) out.set(normName(ours), [...new Set(parts)]);
  }
  for (const [n, h] of byNorm) if (!out.has(n)) out.set(n, [h]);   // 같은 이름 그대로(오토플러스 12개월2만 등)
  return out;
}

/** 원본 열 가운데 우리 규격 어디로도 안 옮겨진 것 — 무엇을 버렸는지 보여 주기 위해. */
export function unmappedSourceColumns(sourceHeader: string[], ourHeader: string[]): string[] {
  const ours = new Set(ourHeader.map(normName));
  const aliased = new Set(MIRROR_ALIAS.flatMap(([, c]) => c).concat(MODEL_PREFIX_CANDIDATES, TRIM_SUFFIX_CANDIDATES).map(normName));
  return sourceHeader.map(S).filter((h) => h && !ours.has(normName(h)) && !aliased.has(normName(h)));
}
