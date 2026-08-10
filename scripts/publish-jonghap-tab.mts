/**
 * **종합표(구버전) 탭**을 영업자 시트에 찍는다. 기본 dry-run, 실제 쓰기는 `--apply`.
 *
 * 왜 따로 있나 — 기존 영업자들이 몇 년 쓰던 표가 이 모양이다. 신버전(상품리스트)과
 * 같은 데이터를 «익숙한 배치»로 한 번 더 낸다. 둘은 같은 RTDB 를 본다.
 *
 * 열 순서는 사장님이 정한 것이다(2026-08-10) — 임의로 바꾸지 마라.
 *   세부모델 → 외장·내장 → 연식·연료·주행 → 단기보증 → 대여료 → 파워트레인·세부트림 → 옵션
 *
 * ★공급사는 **코드가 아니라 회사 이름**이다. RP010 을 보고 어디인지 아는 영업자는 없다.
 * ★구분은 신차렌트·중고렌트·신차구독·중고구독 **4종**이다. 「신차/중고」로 접으면 구독이 사라진다.
 * ★차량번호에 카탈로그 링크를 건다 — 표에서 바로 상세로 넘어가야 쓸모가 있다.
 *
 * ⚠ 대여료·보증금은 **글자**로 넣는다(「1,070,000」). 숫자 서식으로 두면 자리수를 눈으로 세야 한다.
 *
 *   npx tsx scripts/publish-jonghap-tab.mts
 *   npx tsx scripts/publish-jonghap-tab.mts --apply
 *   npx tsx scripts/publish-jonghap-tab.mts --apply --gid=668539469
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isListableProduct, priceList } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import { fuelDisplay, fuelEmbeddedCc } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const ORIGIN = arg('origin', 'https://freepasserp.com');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 사장님이 정한 배치. 위 주석의 순서 규칙과 이 배열이 어긋나면 안 된다. */
const COLUMNS = [
  '상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델', '외장', '내장', '연식', '연료', 'Km',
  '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '파워트레인', '세부트림', '옵션', '최초등록', '소비자가격', '제조사', '배기량', '차고지',
  '운전자범위', '연주행', '분납', '21세', '23세', '1만+',
  '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌',
  '비고', '공급사', '정책코드',
];

const won = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return n ? n.toLocaleString('ko-KR') : ''; };
const shortLimit = (v: unknown) => S(v).replace(/원$/, '');
const manOnly = (v: unknown) => { const s = S(v); if (!s || s === '없음') return s; const m = s.match(/([\d,]+)\s*만/); return m ? m[1] : s; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const [prods, pols, t3, t4] = await Promise.all(['v4/products', 'v4/policies', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const norm = (v: unknown) => S(v).replace(/\s+/g, '');

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
/** 공급사코드 → 짧은 회사 이름. 「주식회사」·「(주)」는 떼고 보여준다. */
const nameOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
}
/**
 * ★연령할증·1만km 증액은 **공급사 시트에서 직접 읽는다**.
 *
 * `sheet_meta` 에 담기게 돼 있지만 실제로 채워진 매물은 671건뿐이고, 살아남은 `EXT_`
 * 레코드는 대부분 비어 있다(161하1687 은 아예 null). 그 칸이 비면 영업자가 21세 손님
 * 할증을 못 말한다 — 시트에 값이 있는데 표에만 없는 셈이다.
 */
const surchargeOf = new Map<string, { a21: string; a23: string; km: string }>();
const CACHE = 'tmp/surcharge-cache.json';
/**
 * ⚠ 공급사 시트를 전부 훑는 일이라 **발행할 때마다 하면 쿼터에 걸린다**(429, 실측 2026-08-10).
 *   6시간은 캐시를 쓴다. 값을 새로 받고 싶으면 `--refresh`.
 */
const fresh = process.argv.includes('--refresh');
const cached = (() => {
  if (fresh) return null;
  try {
    const j = JSON.parse(readFileSync(CACHE, 'utf8')) as { at: number; rows: Rec };
    if (Date.now() - j.at > 6 * 3600_000) return null;
    return j.rows;
  } catch { return null; }
})();
if (cached) {
  for (const [k, v] of Object.entries<Rec>(cached)) surchargeOf.set(k, v as { a21: string; a23: string; km: string });
  console.log(`  (연령할증 캐시 사용 — ${surchargeOf.size}대 · 새로 받으려면 --refresh)`);
} else {
  const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const grab = async (url: string, tries = 4): Promise<Rec> => {
    for (let i = 0; ; i++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
      const j = await res.json().catch(() => ({}));
      if (res.ok) return j;
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleepMs(10000 * (i + 1)); continue; }
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
  };
  for (const p of Object.values(partners)) {
    if (dead(p)) continue;
    const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
    if (!id) continue;
    try {
      const m = await grab(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
      for (const tab of (m.sheets || []).map((s: Rec) => s.properties.title)) {
        const v = await grab(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}!A1:BZ2000`);
        const t: string[][] = v.values || [];
        const hdr = (t[0] || []).map(S);
        const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
        if (pi < 0) continue;
        const i21 = hdr.findIndex((h) => /^21세/.test(h));
        const i23 = hdr.findIndex((h) => /^23세/.test(h));
        const ikm = hdr.findIndex((h) => /1만\s*\+|1만km\s*증액|추가주행/.test(h));
        if (i21 < 0 && i23 < 0 && ikm < 0) continue;
        for (const r of t.slice(1)) {
          const pl = norm(r[pi]);
          if (!pl || surchargeOf.has(pl)) continue;
          const cell = (i: number) => (i >= 0 ? S(r[i]) : '');
          const rec = { a21: cell(i21), a23: cell(i23), km: cell(ikm) };
          if (rec.a21 || rec.a23 || rec.km) surchargeOf.set(pl, rec);
        }
      }
    } catch { /* 못 읽는 시트는 건너뛴다 — 아래 요약에서 «빈 칸 수»로 드러난다 */ }
  }
  mkdirSync('tmp', { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), rows: Object.fromEntries(surchargeOf) }), 'utf8');
  console.log(`  (연령할증 ${surchargeOf.size}대 새로 읽음 — ${CACHE} 에 담음)`);
}

const polByCode = new Map<string, Rec>();
for (const p of Object.values<Rec>(pols)) if (p && typeof p === 'object' && S(p.policy_code)) polByCode.set(S(p.policy_code), p);

const all = Object.entries<Rec>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
const rows = all.filter(isListableProduct).sort((a, b) =>
  S((a as Rec).maker).localeCompare(S((b as Rec).maker), 'ko')
  || S((a as Rec).model).localeCompare(S((b as Rec).model), 'ko')
  || S((a as Rec).car_number).localeCompare(S((b as Rec).car_number), 'ko'));

function cells(p: EntityRecord): Record<string, string> {
  const r = p as Rec;
  const pol = (r._policy as Rec) || (r.policy_code ? polByCode.get(S(r.policy_code)) : null) || {};
  const join = (limit: unknown, ded: unknown) => { const l = shortLimit(limit), d = manOnly(ded); if (!l && !d) return ''; return d ? `${l}/${d}` : l; };
  const own = () => {
    const comp = S(pol.own_damage_compensation).replace(/가액$/, '');
    const lo = manOnly(pol.own_damage_min_deductible), hi = manOnly(pol.own_damage_max_deductible);
    const range = lo && hi ? `${lo}~${hi}` : (lo || hi || '');
    return !comp && !range ? '' : (range ? `${comp}/${range}` : comp);
  };
  /** 기간별 대여료 — 읽기 SSOT(priceList)를 쓴다. 오플 레거시키·주행별 키가 여기서 풀린다. */
  const list = priceList(p);
  const rent = (m: number) => { const hit = list.filter((e) => e.m === m).map((e) => e.rent); return hit.length ? won(Math.min(...hit)) : ''; };
  const dep = (() => { for (const e of list) if (e.deposit) return won(e.deposit); return ''; })();
  const meta = (r.sheet_meta || {}) as Rec;
  const code = S(r.provider_company_code) || S(r.partner_code);
  return {
    상태: S(r.vehicle_status), 입고일자: S(r.arrival_note),
    // 4종 그대로 — 「신차/중고」로 접으면 구독이 사라진다.
    구분: canonProductType(r.product_type) || '',
    차량번호: S(r.car_number),
    차종분류: S(r.model), 세부모델: S(r.sub_model),
    외장: S(r.ext_color), 내장: S(r.int_color), 연식: S(r.year),
    연료: fuelDisplay(r.fuel_type) || S(r.fuel_type),
    Km: r.mileage ? Number(String(r.mileage).replace(/[^\d]/g, '')).toLocaleString('ko-KR') : '',
    단기보증: dep, '1개월': rent(1), '12개월': rent(12),
    장기보증: dep, '24개월': rent(24), '36개월': rent(36), '48개월': rent(48), '60개월': rent(60),
    파워트레인: S(r.variant), 세부트림: S(r.trim_name), 옵션: S(r.options),
    최초등록: S(r.first_registration_date), 소비자가격: won(r.vehicle_price),
    제조사: S(r.maker),
    배기량: (() => { const cc = Number(r.engine_cc) || fuelEmbeddedCc(r.fuel_type); return cc > 0 ? cc.toLocaleString('ko-KR') : ''; })(),
    차고지: S(r.location),
    운전자범위: S(pol.personal_driver_scope), 연주행: S(pol.annual_mileage).replace(/^연간\s*/, ''),
    분납: S(pol.deposit_installment).replace('불가능', '불가'),
    // 시트 값이 먼저다 — sheet_meta 는 대부분 비어 있다.
    ...(() => {
      const s = surchargeOf.get(norm(r.car_number)) || { a21: '', a23: '', km: '' };
      return {
        '21세': s.a21 || S(meta.age_21),
        '23세': s.a23 || S(meta.age_23 || meta.age_21),
        '1만+': s.km || S(meta.year_1plus),
      };
    })(),
    대인: join(pol.injury_compensation_limit, pol.injury_deductible),
    대물: join(pol.property_compensation_limit, pol.property_deductible),
    자차: own(), 자손: join(pol.self_body_accident, pol.self_body_deductible),
    무보험: shortLimit(pol.uninsured_damage), 정비: S(pol.maintenance_service), 전용계좌: '',
    비고: S(r.partner_memo),
    공급사: nameOf.get(code) || code,
    정책코드: S(r.policy_code),
  };
}

/** 자유텍스트에 탭·개행이 있으면 행이 밀린다. */
const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
const PLATE = COLUMNS.indexOf('차량번호');
/** 화면에 실제로 «보이는» 글자 — 열 너비는 수식이 아니라 이걸로 재야 한다. */
const display: string[][] = [COLUMNS];
const values: string[][] = [COLUMNS, ...rows.map((p) => {
  const c = cells(p);
  const out = COLUMNS.map((k) => clean(c[k] ?? ''));
  display.push([...out]);
  // 차량번호 → 카탈로그 상세. 표에서 바로 넘어가야 쓸모가 있다.
  const key = S((p as Rec).product_code) || S((p as Rec)._key);
  if (out[PLATE] && key) out[PLATE] = `=HYPERLINK("${ORIGIN}/m/${encodeURIComponent(key)}","${out[PLATE]}")`;
  return out;
})];

/**
 * ★열 너비를 우리가 잰다.
 *
 * `autoResizeDimensions` 는 **필터 화살표 자리를 안 남긴다.** 그래서 「상태」·「구분」처럼
 * 머리글이 짧은 열이 화살표에 먹혀 「출고가능」이 「출고가늘」로 잘려 보였다(2026-08-10 실측).
 * 한글은 반각 두 칸을 먹으므로 그렇게 세고, 화살표+여백 몫을 따로 더한다.
 */
const wide = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(ch) ? 2 : 1), 0);
const ARROW = 30;   // 머리글 필터 화살표 + 좌우 여백
const colWidth = COLUMNS.map((name, i) => {
  const body = Math.max(...display.slice(1).map((r) => wide(r[i] || '')), 0);
  const head = wide(name) + 2;          // 머리글은 화살표와 나란히 서야 한다
  const units = Math.max(body, head);
  return Math.min(300, Math.max(62, Math.round(units * 6.6) + ARROW));
});

/** 정렬 — 돈·거리·연식은 오른쪽(자리수를 세로로 비교), 상태·구분은 가운데, 나머지는 왼쪽. */
const RIGHT = new Set(['Km', '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월', '소비자가격', '배기량']);
/** 월 대여료만 굵게. 보증금까지 굵히면 어느 게 월 요금인지 흐려진다. */
const RENT = new Set(['1개월', '12개월', '24개월', '36개월', '48개월', '60개월']);
/**
 * 글꼴·색 — **상품리스트·공급사 양식과 같게** 맞춘다(사장님 2026-08-10).
 * 영업자가 세 시트를 오가는데 글꼴이 다르면 다른 회사 문서처럼 보인다.
 * Roboto 는 표(Table)를 쓰면 구글이 자동으로 입히지만, 이 탭은 표가 아니라 직접 지정해야 한다.
 */
const FONT = 'Roboto';
const INK = '213354';      // 머리행 남색
const BAND = 'F7F7F9';     // 줄무늬 회색
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});
/** 배경 · 글자 — ERP 상태 색(product.VEHICLE_STATUS_TONES)과 같은 뜻으로 맞춘다. */
const STATUS_TONE = new Map<string, [string, string]>([
  ['즉시출고', ['DCFCE7', '166534']], ['출고가능', ['DCFCE7', '166534']],
  ['상품화중', ['FEF3C7', '92400E']], ['출고협의', ['DBEAFE', '1E40AF']],
  ['계약중', ['FFEDD5', '9A3412']], ['출고불가', ['FEE2E2', '991B1B']],
]);
/** 신차는 짙게·중고는 옅게 / 렌트는 남색·구독은 보라 — 네 갈래가 색으로 갈린다. */
const TYPE_TONE = new Map<string, [string, string]>([
  ['신차렌트', ['DBEAFE', '1E3A8A']], ['중고렌트', ['EFF6FF', '3B82F6']],
  ['신차구독', ['EDE9FE', '5B21B6']], ['중고구독', ['F5F3FF', '8B5CF6']],
]);
const CENTER = new Set(['상태', '구분', '연식', '차량번호', '21세', '23세', '1만+']);
const alignOf = (name: string) => (RIGHT.has(name) ? 'RIGHT' : CENTER.has(name) ? 'CENTER' : 'LEFT');

console.log(`■ 종합표(구버전) ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
console.log(`  대상 시트 ${SHEET}`);
console.log(`  ${rows.length}대 · ${COLUMNS.length}열`);
const byType = new Map<string, number>();
for (const p of rows) byType.set(canonProductType((p as Rec).product_type) || '(빈)', (byType.get(canonProductType((p as Rec).product_type) || '(빈)') || 0) + 1);
console.log(`  구분: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const noName = rows.filter((p) => { const c = S((p as Rec).provider_company_code); return c && !nameOf.has(c); }).length;
if (noName) console.log(`  ⚠ 공급사 이름을 못 찾은 차 ${noName}대 — 코드로 나간다`);
const filled = (k: string) => values.slice(1).filter((r) => S(r[COLUMNS.indexOf(k)])).length;
console.log(`  연령할증: 21세 ${filled('21세')}대 · 23세 ${filled('23세')}대 · 1만+ ${filled('1만+')}대 (시트에서 읽음 ${surchargeOf.size}대)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

const api = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const head = { Authorization: `Bearer ${shT}`, 'Content-Type': 'application/json' };
const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: head });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

const meta = await call(`${api}?fields=sheets(properties(title,sheetId),bandedRanges(bandedRangeId,range(sheetId)))`) as
  { sheets: { properties: { title: string; sheetId: number }; bandedRanges?: { bandedRangeId: number }[] }[] };
const gidArg = arg('gid');
const found = gidArg
  ? meta.sheets.find((s) => String(s.properties.sheetId) === gidArg)
  : meta.sheets.find((s) => s.properties.title.startsWith('종합표'));
if (!found) throw new Error('종합표 탭을 못 찾음 — --gid 로 지정하라');
const gid = found.properties.sheetId;

const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
const title = `종합표 ${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)} · ${rows.length}대`;

// 재고가 줄면 아래에 유령이 남는다 — 비우고 쓴다.
await call(`${api}/values/${encodeURIComponent(found.properties.title)}!A1:BZ2000:clear`, { method: 'POST', body: '{}' });
await call(`${api}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: gid, title }, fields: 'title' } }] }),
});
await call(`${api}/values/${encodeURIComponent(title)}!A1?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values }),
});
await call(`${api}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    // 머리행·차량번호까지 고정 — 오른쪽으로 스크롤해도 어느 차인지 보여야 한다.
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 4 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: rgb(INK), textFormat: { fontFamily: FONT, bold: true, foregroundColor: rgb('FFFFFF'), fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    } },
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: values.length },
      cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat,verticalAlignment)',
    } },
    { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: COLUMNS.length } } } },
    /**
     * 줄무늬 — 가로로 긴 표라 줄이 눈에서 미끄러진다. 흰/회색 교대로 행을 잡아 준다.
     * ⚠ 줄무늬는 «추가»만 되는 API 다 — 다시 찍을 때 먼저 지우지 않으면 400 이 난다.
     */
    ...(found.bandedRanges || []).map((b) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } })),
    { addBanding: { bandedRange: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: COLUMNS.length },
      rowProperties: { headerColorStyle: { rgbColor: rgb(INK) }, firstBandColorStyle: { rgbColor: rgb('FFFFFF') }, secondBandColorStyle: { rgbColor: rgb(BAND) } },
    } } },
    // 한 줄로 못 담는 긴 칸(옵션·비고)은 넘치게 둔다 — 줄바꿈하면 행 높이가 들쭉날쭉해 훑기 어렵다.
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: COLUMNS.length },
      cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat.wrapStrategy',
    } },
    ...COLUMNS.map((name, i) => ({ repeatCell: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: {
        horizontalAlignment: alignOf(name),
        // 대여료는 이 표를 보는 이유다 — 굵게 해서 눈이 먼저 가게 한다.
        //   보증금은 굵게 하지 않는다. 둘 다 굵으면 어느 게 월 요금인지 흐려진다.
        ...(RENT.has(name) ? { textFormat: { fontFamily: FONT, bold: true, fontSize: 10 } } : {}),
      } },
      fields: RENT.has(name) ? 'userEnteredFormat(horizontalAlignment,textFormat)' : 'userEnteredFormat.horizontalAlignment',
    } })),
    // 상태 — 팔 수 있나 없나가 한눈에 갈려야 한다.
    ...[...STATUS_TONE].map(([word, tone]) => ({ addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: COLUMNS.indexOf('상태'), endColumnIndex: COLUMNS.indexOf('상태') + 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: word }] },
          format: { backgroundColor: rgb(tone[0]), textFormat: { foregroundColor: rgb(tone[1]), bold: true } },
        },
      },
    } })),
    // 구분 — 신차/중고 · 렌트/구독 네 갈래를 색으로 가른다. 글자만으로는 훑을 때 안 걸린다.
    ...[...TYPE_TONE].map(([word, tone]) => ({ addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: values.length, startColumnIndex: COLUMNS.indexOf('구분'), endColumnIndex: COLUMNS.indexOf('구분') + 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: word }] },
          format: { backgroundColor: rgb(tone[0]), textFormat: { foregroundColor: rgb(tone[1]), bold: true } },
        },
      },
    } })),
    /**
     * 행 높이 — 기본 21px 는 글자가 위아래로 붙어 눈이 줄을 놓친다.
     * 26px 로 «살짝만» 벌린다. 더 키우면 한 화면에 담기는 줄이 줄어 훑기가 힘들어진다.
     * 머리행은 조금 더 준다 — 필터 화살표와 글자가 같이 들어가야 한다.
     */
    { updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 30 }, fields: 'pixelSize',
    } },
    { updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: 1, endIndex: values.length },
      properties: { pixelSize: 26 }, fields: 'pixelSize',
    } },
    ...colWidth.map((px, i) => ({ updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    } })),
  ] }),
});
console.log(`\n  반영 완료 — 탭 「${title}」 · ${values.length}행`);
console.log(`  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
