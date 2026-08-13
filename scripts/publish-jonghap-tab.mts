/**
 * **「상품리스트」 탭**을 영업자 시트에 찍는다. 기본 dry-run, 실제 쓰기는 `--apply`.
 *
 * ★영업자가 보는 표는 **이것 하나뿐이다**(사장님 2026-08-12). 예전에 신버전(조회바·요약블록)을
 *   나란히 두었다가 한쪽만 갱신돼 영업자가 옛 값을 봤다 — 오플 유령 48개월이 그렇게 남았다.
 *   ⚠ 탭을 다시 늘리지 마라. 두 벌이 되는 순간 같은 사고가 난다.
 *
 * ★배치·서식은 **영업자가 쓰던 옛 「종합」 탭을 실측해 옮긴 것이다**
 *   (`1BcHvwid…` 「프리패스 공급사 상품리스트」 종합 탭 · 사장님 2026-08-13
 *    「이게 기존 시트야 · 이게 영업자들이 보던 건데 저걸 좋아라 하는 거야」).
 *   아래 이름·순서·색은 짐작이 아니라 그 시트에서 잰 값이다. 임의로 바꾸지 마라.
 *
 *     글꼴    Malgun Gothic 9pt · 기울임 · 가운데
 *     머리행  기울임 검정 / 대여료 블록만 배경색(단기 연녹 → 장기 진홍)
 *     줄무늬  #EDEFF2 / 흰색 교대
 *     행높이  21px · 테두리 없음
 *
 * ★**차량번호·대여료·보증금은 무슨 일이 있어도 맞아야 한다**(사장님 2026-08-13).
 *   이 셋은 어떤 규칙으로도 다시 계산하지 않는다 — 공급사가 쓴 값을 그 자리에 옮길 뿐이다.
 *   발행할 때마다 «몇 대가 찼나»를 찍는다. 숫자가 갑자기 줄면 그날 발행을 멈추고 봐야 한다.
 *
 *   npx tsx scripts/publish-jonghap-tab.mts
 *   npx tsx scripts/publish-jonghap-tab.mts --apply
 *   npx tsx scripts/publish-jonghap-tab.mts --apply --refresh   (공급사 시트 다시 훑기)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct, priceList } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import { fuelDisplay, fuelEmbeddedCc } from '../lib/domain/vehicle-master-match';
import { photoUrlFromCell, type SheetGridCell } from '../lib/domain/sheet-visible-grid';
import { EMPTY_BOOK, applyAlias, type AliasBook } from '../lib/domain/master-alias';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * 옛 「종합」 탭 43열에서 넷을 빼고 차명 축을 넷으로 나눈 것이다.
 *
 * ★차명 축 넷은 **붙여 둔다** — 모델 → 세부모델 → 파워트레인 → 세부트림.
 *   차종마스터 축과 같은 차례라 시트를 되읽어 ERP 에 넣을 때 기계적으로 들어간다.
 * ★뺀 것 — 차량상태(원본 119행 모두 「정상」이라 값이 없는 칸) · 입고일자(영업자에게 필요 없음)
 *   · 6개월(사장님 2026-08-13) · 공급사코드·정책코드(RP020 을 보고 아는 영업자는 없다 → 「공급사」 이름).
 */
const COLUMNS = [
  '배차상태', '구분', '차량번호',
  '모델', '세부모델', '파워트레인', '세부트림',
  '외장', '내장', 'Km',
  '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '옵션', '최초등록', '소비자가격', '제조사', '연료', '배기량', '차고지', '운전자범위', '연주행', '분납',
  '21세', '23세', '1만+',
  '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌', '비고',
  '공급사',
];

/** 굵게 나가는 칸 = 월 대여료. 보증금은 굵히지 않는다 — 둘 다 굵으면 어느 게 월 요금인지 흐려진다. */
const RENT = ['1개월', '12개월', '24개월', '36개월', '48개월', '60개월'];
/** 자유텍스트라 상한을 더 낮게 묶는 칸. */
const NARROW = new Set(['옵션', '비고', '세부모델']);
const MAX_PX = 300;
const NARROW_PX = 240;
/** 1행이 곧 머리행이다 — 위에 안내 블록을 두지 않는다(사장님 2026-08-13 「위에 바로 헤더가 시작하지」). */
const HEADER_ROW = 1;

const won = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return n ? n.toLocaleString('ko-KR') : ''; };
const shortLimit = (v: unknown) => S(v).replace(/원$/, '');
/**
 * ★면책금·할증은 **만원 단위 숫자 하나로 통일한다**(사장님 2026-08-13 — 「콤마 빠진 거나 이런 건
 *   좀 채워줘야 하고」). 공급사마다 적는 법이 달라 같은 값이 셋으로 서 있었다
 *   (1만+ 「10」129대 · 「100,000」58대 · 「150,000」12대).
 *   숫자를 바꾸는 게 아니라 **적는 법만 맞춘다** — 500000 은 50만원이고 그걸 「50」으로 쓴다.
 * ⚠ 만원으로 안 떨어지는 값은 손대지 않는다. 「불가」·「협의」·「10%」 같은 말도 그대로 둔다.
 */
const manOnly = (v: unknown) => {
  const s = S(v);
  if (!s || s === '없음') return s;
  const m = s.match(/([\d,]+)\s*만/);
  if (m) return m[1];
  if (!/^[\d,]+$/.test(s)) return s;
  const n = Number(s.replace(/,/g, ''));
  if (!n) return s;
  if (n >= 10000 && n % 10000 === 0) return String(n / 10000);
  return n.toLocaleString('ko-KR');
};
/** 연주행 — 「연 20,000km」·「2만Km 주행」·「2만Km」가 섞여 있다. 「2만km」로 맞춘다. */
const yearlyKm = (v: unknown) => {
  const s = S(v).replace(/^연간?\s*/, '').replace(/\s*주행\s*$/, '').trim();
  const m = s.match(/^([\d,]+)\s*km$/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 10000 && n % 1000 === 0) return `${n / 10000}만km`;
  }
  return s.replace(/Km$/i, 'km');
};
/**
 * 파워트레인 정리 — **어순만 맞추고 남의 값은 떼어 낸다.**
 * 차종마스터 확신도가 낮으면 공급사 원문이 그대로 남는다(틀린 차명을 붙이느니 원문이 낫다).
 * 그래서 「1.6T가솔린 2WD」 ↔ 「가솔린 1.6T 2WD」가 섞이고, 「…2WD 트렌드」처럼 트림이 붙기도 한다.
 * ⚠ 4MATIC·xDrive·콰트로를 AWD 로 바꾸지 마라 — 차종마스터가 브랜드 말을 그대로 쓴다.
 */
const FUEL = '가솔린|디젤|하이브리드|전기|수소|LPG';
const DRIVE = '2WD|4WD|AWD|4MATIC|xDrive|콰트로';
function splitPowertrain(raw: string): { power: string; rest: string } {
  const v = S(raw).replace(new RegExp(`^([\\d.]+T?)\\s*(${FUEL})`, 'i'), '$2 $1').replace(/\s{2,}/g, ' ').trim();
  if (!v) return { power: '', rest: '' };
  // ⚠ 배기량 자리가 「2WD」의 2 나 「66kWh」의 66 을 먹으면 안 된다.
  const m = v.match(new RegExp(`^((?:${FUEL})(?:\\s+[\\d.]+T?(?![\\d.]*(?:WD|kWh)))?(?:\\s+(?:${DRIVE}))?(?:\\s+[\\d.]+\\s*kWh)?(?:\\s+\\d+인승)?)\\s*(.*)$`, 'i'));
  if (!m) return { power: v, rest: '' };
  return { power: m[1].trim(), rest: m[2].trim() };
}

/**
 * ★**표기 사전** — 「매물이 쓴 말 → 차종마스터가 쓰는 말」. `fill-master-gap.mts` 가 쌓는다.
 *   확신도가 낮아 원문이 남은 차(「아방가르드」·「1.6T가솔린」)를 여기서 마스터 말로 맞춘다.
 *   ⚠ 사전에 없는 말은 **그대로 내보낸다.** 지어내지 않는다.
 */
const ALIAS: AliasBook = (() => {
  try { return JSON.parse(readFileSync('public/data/master-aliases.json', 'utf8')) as AliasBook; } catch { return EMPTY_BOOK; }
})();

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

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
/** 공급사코드 → 짧은 회사 이름 · 입금계좌. */
const nameOf = new Map<string, string>();
const bankOf = new Map<string, string>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  const nm = companyAlias(S(p.partner_name || p.name || p.company_name), p.alias);
  if (c && nm && !nameOf.has(c)) nameOf.set(c, nm);
  const bank = S(p.bank_account || p.account_number);
  if (c && bank && !bankOf.has(c)) bankOf.set(c, bank);
}

/**
 * 연령할증·1만km 증액과 **차량번호 셀에 걸린 공급사 원본 링크**를 공급사 시트에서 직접 읽는다.
 * ⚠ 값(values)만 받으면 셀 링크가 안 온다 — 사진 주소가 거기 있으므로 격자(grid)로 받는다.
 * ⚠ 발행할 때마다 훑으면 쿼터에 걸린다(429, 실측 2026-08-10). 6시간은 캐시를 쓴다(`--refresh` 로 갱신).
 */
const surchargeOf = new Map<string, { a21: string; a23: string; km: string }>();
const photoOf = new Map<string, string>();
const CACHE = 'tmp/sheet-cell-cache.json';
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
  for (const [k, v] of Object.entries<Rec>(cached)) {
    surchargeOf.set(k, { a21: S(v.a21), a23: S(v.a23), km: S(v.km) });
    if (S(v.photo)) photoOf.set(k, S(v.photo));
  }
  console.log(`  (시트 캐시 사용 — 할증 ${surchargeOf.size}대 · 셀링크 ${photoOf.size}대 · 새로 받으려면 --refresh)`);
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
  const GRID = 'sheets(data(rowData(values(formattedValue,hyperlink,chipRuns(chip(richLinkProperties(uri)))))))';
  for (const p of Object.values(partners)) {
    if (dead(p)) continue;
    const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
    if (!id) continue;
    try {
      const m = await grab(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
      for (const tab of (m.sheets || []).map((s: Rec) => s.properties.title)) {
        const a1 = `'${String(tab).replace(/'/g, "''")}'!A1:BZ2000`;
        const g = await grab(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(GRID)}`);
        const rowData = (g.sheets?.[0]?.data?.[0]?.rowData || []) as Array<{ values?: SheetGridCell[] }>;
        const cellsAt = (i: number) => (rowData[i]?.values || []) as SheetGridCell[];
        const t: string[][] = rowData.map((rd) => (rd.values || []).map((c) => S(c?.formattedValue)));
        // 머리행이 1행이 아닌 시트가 있다(오플은 위에 배너가 붙는다). 앞 12줄에서 차번 열을 찾는다.
        let h = -1, pi = -1;
        for (let i = 0; i < Math.min(12, t.length); i++) {
          const j = (t[i] || []).findIndex((c) => /차량번호|차번/.test(c));
          if (j >= 0) { h = i; pi = j; break; }
        }
        if (h < 0) continue;
        const hdr = t[h].map(S);
        const i21 = hdr.findIndex((c) => /^21세/.test(c));
        const i23 = hdr.findIndex((c) => /^23세/.test(c));
        const ikm = hdr.findIndex((c) => /1만\s*\+|1만km\s*증액|추가주행/.test(c));
        for (let ri = h + 1; ri < t.length; ri++) {
          const pl = norm(t[ri]?.[pi]);
          if (!pl) continue;
          if (!photoOf.has(pl)) {
            const line = cellsAt(ri);
            const url = photoUrlFromCell(line[pi]) || line.map((c) => photoUrlFromCell(c)).find(Boolean) || '';
            if (url) photoOf.set(pl, url);
          }
          if (surchargeOf.has(pl)) continue;
          const cell = (i: number) => (i >= 0 ? S(t[ri]?.[i]) : '');
          const rec = { a21: cell(i21), a23: cell(i23), km: cell(ikm) };
          if (rec.a21 || rec.a23 || rec.km) surchargeOf.set(pl, rec);
        }
      }
    } catch { /* 못 읽는 시트는 건너뛴다 — 아래 요약에서 «빈 칸 수»로 드러난다 */ }
  }
  mkdirSync('tmp', { recursive: true });
  const merged: Record<string, Rec> = {};
  for (const [k, v] of surchargeOf) merged[k] = { ...v };
  for (const [k, url] of photoOf) merged[k] = { ...(merged[k] || { a21: '', a23: '', km: '' }), photo: url };
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), rows: merged }), 'utf8');
  console.log(`  (시트 새로 읽음 — 할증 ${surchargeOf.size}대 · 셀링크 ${photoOf.size}대 — ${CACHE} 에 담음)`);
}

const polByCode = new Map<string, Rec>();
for (const p of Object.values<Rec>(pols)) if (p && typeof p === 'object' && S(p.policy_code)) polByCode.set(S(p.policy_code), p);

const all = Object.entries<Rec>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));

/**
 * ★**오토플러스 전부**와 **손오공 구독**은 이 표에서 뺀다 — 각자 원본 탭을 통째로 복사해 따로 올린다
 *   (`scripts/publish-partner-tabs.mts`). 상품 종류가 달라 표가 다른 것이지 두 벌을 찍는 게 아니다.
 *   ⚠ 손오공 **렌트**는 여기 남는다. 규칙이 두 스크립트에서 갈리면 차가 두 탭에 서거나 어디에도 없게 된다.
 */
const AUTOPLUS = 'RP023';
const SONOGONG = 'RP012';
const movedOut = (p: EntityRecord) => {
  const code = S((p as Rec).provider_company_code) || S((p as Rec).partner_code);
  if (code === AUTOPLUS) return true;
  return code === SONOGONG && /구독/.test(canonProductType((p as Rec).product_type) || '');
};
// ★요금 없는 차도 담는다 — 영업자 표는 «재고 전부»여야 한다(요금 칸만 빈다).
const rows = all.filter(isStockedProduct).filter((p) => !movedOut(p)).sort((a, b) =>
  S((a as Rec).maker).localeCompare(S((b as Rec).maker), 'ko')
  || S((a as Rec).model).localeCompare(S((b as Rec).model), 'ko')
  || S((a as Rec).car_number).localeCompare(S((b as Rec).car_number), 'ko'));

/**
 * ★구분 어휘는 **영업자가 읽던 말**이다 — 신차 · 재렌트 · 재구독.
 *   ERP 는 신차렌트/중고렌트/신차구독/중고구독 4종으로 담는다.
 *   ⚠ 「신차구독」만 원본에 없던 갈래다. 접으면 신차인지 중고인지가 사라지므로 글자는 그대로 둔다.
 */
const GUBUN = new Map<string, string>([
  ['신차렌트', '신차'], ['중고렌트', '재렌트'], ['중고구독', '재구독'], ['신차구독', '신차구독'],
]);

/**
 * ★**요즘 제네시스는 트림 축이 없다**(사장님 2026-08-13 — 「제네시스는 트림이 없어 요즘 나오는 거는」).
 *   「2.5T AWD」가 곧 등급이고 그 아래 세부등급이 없다. 그래서 빈 칸이 **정상**이다 —
 *   결손으로 세지도, 억지로 채우지도 않는다.
 * ★「(세부등급 없음)」·「없음」은 **트림 이름이 아니라 «없다»는 표시**다. 빈 칸으로 바꿔 싣는다.
 *   글자로 실으면 영업자가 그걸 등급 이름으로 읽는다.
 */
const NOT_A_TRIM = /^\(?세부등급\s*없음\)?$|^없음$|^-$/;
const trimCell = (r: Rec, v: string) => (NOT_A_TRIM.test(S(v)) ? '' : S(v));

function cells(p: EntityRecord): Record<string, string> {
  const r = p as Rec;
  const pol = (r._policy as Rec) || (r.policy_code ? polByCode.get(S(r.policy_code)) : null) || {};
  // 앞칸(보상한도)이 비면 「/50」처럼 슬래시가 앞에 남는다 — 그건 값이 아니라 부스러기다.
  const join = (limit: unknown, ded: unknown) => { const l = shortLimit(limit), d = manOnly(ded); if (!l && !d) return ''; if (!l) return d; return d ? `${l}/${d}` : l; };
  const own = () => {
    const comp = S(pol.own_damage_compensation).replace(/가액$/, '');
    const lo = manOnly(pol.own_damage_min_deductible), hi = manOnly(pol.own_damage_max_deductible);
    const range = lo && hi ? `${lo}~${hi}` : (lo || hi || '');
    if (!comp && !range) return '';
    if (!comp) return range;
    return range ? `${comp}/${range}` : comp;
  };
  /** 기간별 대여료 — 읽기 SSOT(priceList)를 쓴다. 오플 레거시키·주행별 키가 여기서 풀린다. */
  const list = priceList(p);
  const rent = (m: number) => { const hit = list.filter((e) => e.m === m).map((e) => e.rent); return hit.length ? won(Math.min(...hit)) : ''; };
  const dep = (() => { for (const e of list) if (e.deposit) return won(e.deposit); return ''; })();
  const meta = (r.sheet_meta || {}) as Rec;
  const code = S(r.provider_company_code) || S(r.partner_code);
  const type = canonProductType(r.product_type) || '';
  // 사전 규칙은 좁게 걸려 있다 — 어느 차의 말인지 알려 줘야 맞는 규칙이 골라진다.
  const scope = { maker: r.maker, model: r.model, sub_model: r.sub_model };
  /**
   * ⚠ 사전은 **쪼개기 전에** 건다. 규칙은 원문(「하이브리드 2WD 플러스 6인승」) 기준으로 적혀 있는데
   *   먼저 쪼개면 「하이브리드 2WD」가 되어 규칙이 안 걸린다(실측 2026-08-13).
   */
  const pt = splitPowertrain(applyAlias(ALIAS, 'variant', scope, S(r.variant)));
  return {
    배차상태: S(r.vehicle_status),
    구분: GUBUN.get(type) || type,
    차량번호: S(r.car_number),
    모델: S(r.model),
    세부모델: S(r.sub_model),
    // 파워트레인 칸에 트림이 섞여 들어온 것은 세부트림으로 넘기고, 표기 사전으로 마스터 말에 맞춘다.
    파워트레인: applyAlias(ALIAS, 'variant', scope, pt.power),
    세부트림: trimCell(r, applyAlias(ALIAS, 'trim', scope, S(r.trim_name) || S(r.trim_extra) || pt.rest)),
    외장: S(r.ext_color), 내장: S(r.int_color),
    Km: r.mileage ? Number(String(r.mileage).replace(/[^\d]/g, '')).toLocaleString('ko-KR') : '',
    단기보증: dep, '1개월': rent(1), '12개월': rent(12),
    장기보증: dep, '24개월': rent(24), '36개월': rent(36), '48개월': rent(48), '60개월': rent(60),
    옵션: S(r.options),
    최초등록: S(r.first_registration_date),
    소비자가격: won(r.vehicle_price),
    제조사: S(r.maker),
    // 원본은 「가솔린2.5」·「HEV 1.6」처럼 공급사 원문을 그대로 실었다.
    연료: S(r.fuel_type) || fuelDisplay(r.fuel_type),
    배기량: (() => { const cc = Number(r.engine_cc) || fuelEmbeddedCc(r.fuel_type); return cc > 0 ? cc.toLocaleString('ko-KR') : ''; })(),
    차고지: S(r.location),
    운전자범위: S(pol.personal_driver_scope),
    연주행: yearlyKm(pol.annual_mileage),
    분납: S(pol.deposit_installment).replace('불가능', '불가'),
    // 시트 값이 먼저다 — sheet_meta 는 대부분 비어 있다. 적는 법만 만원 단위로 맞춘다.
    ...(() => {
      const s = surchargeOf.get(norm(r.car_number)) || { a21: '', a23: '', km: '' };
      return {
        '21세': manOnly(s.a21 || S(meta.age_21)),
        '23세': manOnly(s.a23 || S(meta.age_23 || meta.age_21)),
        '1만+': manOnly(s.km || S(meta.year_1plus)),
      };
    })(),
    대인: join(pol.injury_compensation_limit, pol.injury_deductible),
    대물: join(pol.property_compensation_limit, pol.property_deductible),
    // ⚠ 합쳐진 글자(「1000만원/50~100」)에 만원 정리를 다시 씌우면 앞칸의 「만원」까지 먹는다.
    자차: own(),
    자손: join(pol.self_body_accident, pol.self_body_deductible),
    무보험: shortLimit(pol.uninsured_damage),
    정비: S(pol.maintenance_service),
    전용계좌: bankOf.get(code) || '',
    비고: S(r.partner_memo),
    공급사: nameOf.get(code) || code,
  };
}

/** 자유텍스트에 탭·개행이 있으면 행이 밀린다. */
const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
const PLATE = COLUMNS.indexOf('차량번호');
const kstNow = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
const stamp = `${kstNow.slice(5, 10).replace('-', '.')} ${kstNow.slice(11, 16)}`;

const display: string[][] = [];
const body: string[][] = rows.map((p) => {
  const c = cells(p);
  const out = COLUMNS.map((k) => clean(c[k] ?? ''));
  display.push([...out]);
  /**
   * ★차량번호에 거는 링크는 **렌트사가 올려놓은 사진 링크뿐이다**(사장님 2026-08-13).
   *   예전엔 사진이 없으면 우리 카탈로그로 보냈는데, 그건 «사진 보러 눌렀더니 딴 데로 가는» 칸이 된다.
   *   링크가 없으면 그냥 글자로 둔다. 실제 링크는 아래에서 `textFormatRuns` 로 건다.
   */
  return out;
});
const values: string[][] = [COLUMNS, ...body];

/**
 * 열너비 — 칸 하나가 유난히 길다고 열 전체를 넓히지 않는다. **90% 지점**으로 잰다.
 * 최댓값으로 재면 「퀼팅 라이트 브라운 나파 인조가죽 시트」 한 줄 때문에 내장 열이 130px 로 벌어진다.
 * ⚠ 머리글은 잘리면 안 된다 — 무슨 칸인지 모르게 된다. 그래서 머리글 길이는 하한으로 둔다.
 */
const wide = (s: string) => [...s].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(ch) ? 2 : 1), 0);
const colWidth = COLUMNS.map((name, i) => {
  const lens = display.map((r) => wide(r[i] || '')).sort((a, b) => a - b);
  const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] : 0;
  const units = Math.max(p90, wide(name) + 1);
  const cap = NARROW.has(name) ? NARROW_PX : MAX_PX;
  return Math.min(cap, Math.max(62, Math.round(units * 6.6) + 12));
});

const FONT = 'Malgun Gothic';
const SIZE = 9;
const INK = '000000';
const LINK = '1155CC';
const BAND = 'EDEFF2';
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(0, 2), 16) / 255,
  green: parseInt(hex.slice(2, 4), 16) / 255,
  blue: parseInt(hex.slice(4, 6), 16) / 255,
});
/**
 * ★**색은 배경이 아니라 글자에 준다**(사장님 2026-08-13 — 「배경 말고 텍스트 폰트 색깔로」).
 *   아래는 옛 종합 탭에서 열별로 잰 값이다. 새로 고르지 마라.
 * ★돈 칸은 단기·장기 블록으로 갈린다(「기간별 대여료 글씨 색깔도 다르잖아 기존거랑」).
 * ⚠ 이 색과 «대여료 굵게»를 **한 번에** 준다. 따로 주면 뒤엣것이 앞엣것을 덮어
 *   대여료가 통째로 검정으로 나간다(실측 2026-08-13 — 그 사고를 한 번 냈다).
 */
const COL_INK: Record<string, string> = {
  배차상태: '0000FF',
  차량번호: LINK,
  단기보증: '5EC1C8', '1개월': '5EC1C8', '12개월': '5EC1C8',
  장기보증: '0000FF', '24개월': '0000FF', '36개월': '0000FF', '48개월': '0000FF', '60개월': '0000FF',
  분납: 'FF0000', '21세': 'FF0000', '23세': 'FF0000', '1만+': 'FF0000',
  전용계좌: 'FF0000', 비고: 'FF0000',
};
/** 구분은 값마다 글자색이 다르다 — 원본에서 세 색이 나왔다. */
const GUBUN_INK = new Map<string, string>([
  ['신차', 'FF00FF'], ['재렌트', '34A853'], ['재구독', 'FF9900'], ['신차구독', 'FF9900'],
]);
/** 머리행 배경 — 대여료 블록만 색이 있다. 단기 → 장기로 갈수록 진해진다(원본 실측). */
const HEAD_BG: Record<string, string> = {
  단기보증: 'B7E1CD', '1개월': 'A4C2F4', '12개월': '3C78D8',
  장기보증: 'E6B8AF', '24개월': 'DD7E6B', '36개월': 'CC4125', '48개월': 'A61C00', '60개월': '85200C',
};
/** 진한 칸에 검정을 두면 안 읽힌다 — 밝기로 고른다. */
const readableInk = (bg: string) => {
  const l = (parseInt(bg.slice(0, 2), 16) * 299 + parseInt(bg.slice(2, 4), 16) * 587 + parseInt(bg.slice(4, 6), 16) * 114) / 1000;
  return l > 150 ? '000000' : 'FFFFFF';
};

console.log(`■ 상품리스트 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
console.log(`  대상 시트 ${SHEET}`);
console.log(`  ${rows.length}대 · ${COLUMNS.length}열 · 머리행 ${HEADER_ROW}행`);
const byType = new Map<string, number>();
for (const p of rows) { const g = cells(p).구분 || '(빈)'; byType.set(g, (byType.get(g) || 0) + 1); }
console.log(`  구분: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const filled = (k: string) => body.filter((r) => S(r[COLUMNS.indexOf(k)])).length;
console.log(`  연령할증: 21세 ${filled('21세')}대 · 23세 ${filled('23세')}대 · 1만+ ${filled('1만+')}대`);
console.log(`  전용계좌 ${filled('전용계좌')}대 · 비고 ${filled('비고')}대 · 정비 ${filled('정비')}대 · 차고지 ${filled('차고지')}대`);
{
  const plate = filled('차량번호');
  const rentN = body.filter((r) => RENT.some((k) => S(r[COLUMNS.indexOf(k)]))).length;
  const depN = body.filter((r) => S(r[COLUMNS.indexOf('단기보증')]) || S(r[COLUMNS.indexOf('장기보증')])).length;
  console.log(`  ★차량번호 ${plate}/${rows.length} · 대여료 있는 차 ${rentN} · 보증금 있는 차 ${depN}`);
  if (plate !== rows.length) console.log(`  ⚠ 차량번호가 빈 차가 ${rows.length - plate}대 — 발행을 멈추고 봐야 한다`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

const api = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const head = { Authorization: `Bearer ${shT}`, 'Content-Type': 'application/json' };
const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: head });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

const meta = await call(`${api}?fields=sheets(properties(title,sheetId,hidden,gridProperties(columnCount)),bandedRanges(bandedRangeId,range(sheetId)),conditionalFormats)`) as
  { sheets: { properties: { title: string; sheetId: number; hidden?: boolean; gridProperties?: { columnCount?: number } }; bandedRanges?: { bandedRangeId: number }[]; conditionalFormats?: unknown[] }[] };
const gidArg = arg('gid');
// 주소(gid)가 안 바뀌어야 영업자가 즐겨찾기해 둔 링크가 산다. ⚠ 숨긴 탭은 건너뛴다.
const found = gidArg
  ? meta.sheets.find((s) => String(s.properties.sheetId) === gidArg)
  : meta.sheets.find((s) => !s.properties.hidden && s.properties.title.startsWith('상품리스트'));
if (!found) throw new Error('상품리스트 탭을 못 찾음 — --gid 로 지정하라');
const gid = found.properties.sheetId;
const colCountNow = Number(found.properties.gridProperties?.columnCount) || COLUMNS.length;
const title = `상품리스트 ${stamp} · ${rows.length}대`;
const H = HEADER_ROW - 1;
const lastRow = values.length;

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
    // 지난 판에서 씌운 줄무늬·조건부서식을 먼저 걷어낸다 — 안 지우면 옛 색이 밑에 남는다.
    ...(found.bandedRanges || []).map((b) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } })),
    ...(found.conditionalFormats || []).map(() => ({ deleteConditionalFormatRule: { sheetId: gid, index: 0 } })),
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: HEADER_ROW, frozenColumnCount: 0 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    // 표 전체 바탕 — Malgun Gothic 9pt, 기울임, 검정, 가운데.
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: H + 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: COLUMNS.length },
      cell: { userEnteredFormat: {
        backgroundColor: rgb('FFFFFF'),
        textFormat: { fontFamily: FONT, fontSize: SIZE, italic: true, bold: false, foregroundColor: rgb(INK) },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    } },
    // 머리행 — 기울임 검정 흰 배경. 대여료 블록만 아래에서 색을 덧입힌다.
    { repeatCell: {
      range: { sheetId: gid, startRowIndex: H, endRowIndex: H + 1, startColumnIndex: 0, endColumnIndex: COLUMNS.length },
      cell: { userEnteredFormat: {
        backgroundColor: rgb('FFFFFF'),
        textFormat: { fontFamily: FONT, fontSize: SIZE, bold: false, italic: true, foregroundColor: rgb('000000') },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
      } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    } },
    /**
     * ⚠ 머리행 대여료 블록에 배경색을 넣지 않는다(사장님 2026-08-13 「그냥 화이트로만」).
     *   원본에는 단기 연녹 → 장기 진홍 그라데이션이 있었지만 **바탕은 전부 흰색으로 간다.**
     *   갈라 보이는 일은 글자색이 한다 — 바탕까지 칠하면 시끄러워진다.
     */
    { clearBasicFilter: { sheetId: gid } },
    { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: H, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: COLUMNS.length } } } },
    // ⚠ 줄무늬는 넣지 않는다(사장님 2026-08-13 「줄무늬 빼자」). 위에서 옛 줄무늬를 걷어내기만 한다.
    //   다시 넣지 마라 — 글자색으로 이미 갈라져 있어 바탕까지 갈면 시끄러워진다.
    // 열별 글자색 + 대여료 굵게 — 반드시 한 번에 준다.
    ...Object.entries(COL_INK).filter(([name]) => COLUMNS.includes(name)).map(([name, ink]) => ({ repeatCell: {
      range: { sheetId: gid, startRowIndex: H + 1, endRowIndex: lastRow, startColumnIndex: COLUMNS.indexOf(name), endColumnIndex: COLUMNS.indexOf(name) + 1 },
      cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: SIZE, italic: true, bold: RENT.includes(name), foregroundColor: rgb(ink) } } },
      fields: 'userEnteredFormat.textFormat',
    } })),
    // 구분 — 값마다 «글자색»이 다르다. 배경은 칠하지 않는다.
    ...[...GUBUN_INK].map(([word, ink]) => ({ addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId: gid, startRowIndex: H + 1, endRowIndex: lastRow, startColumnIndex: COLUMNS.indexOf('구분'), endColumnIndex: COLUMNS.indexOf('구분') + 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: word }] },
          format: { textFormat: { foregroundColor: rgb(ink) } },
        },
      },
    } })),
    { updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: lastRow },
      properties: { pixelSize: 21 }, fields: 'pixelSize',
    } },
    ...colWidth.map((px, i) => ({ updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px }, fields: 'pixelSize',
    } })),
    // 표 오른쪽에 남은 빈 열을 잘라 낸다 — 「빈 칸인데 300px」 같은 자리가 생긴다.
    ...(colCountNow > COLUMNS.length
      ? [{ deleteDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: COLUMNS.length, endIndex: colCountNow } } }]
      : []),
  ] }),
});

/**
 * ★차량번호 셀에 **공급사가 걸어 둔 사진 링크**를 건다.
 * ⚠ **맨 마지막에** 넣는다. 뒤에 `repeatCell` 이 한 번이라도 오면 링크가 통째로 지워진다.
 * ⚠ 링크가 없는 차는 손대지 않는다 — 검정 글자로 남아 «눌러도 안 가는 칸»이 파랗게 보이지 않는다.
 */
{
  const linked = rows
    .map((p, k) => {
      const plate = S((p as Rec).car_number);
      const url = photoOf.get(norm(plate)) || S((p as Rec).photo_link);
      return { row: H + 1 + k, plate, url };
    })
    .filter((x) => x.plate && x.url.startsWith('http'));
  if (PLATE >= 0 && linked.length) {
    const reqs = linked.map((x) => ({
      updateCells: {
        range: { sheetId: gid, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: PLATE, endColumnIndex: PLATE + 1 },
        rows: [{ values: [{
          userEnteredValue: { stringValue: x.plate },
          // 글자 서식(run)이 칸 서식을 덮으므로 링크 색·밑줄을 여기에도 준다.
          textFormatRuns: [{ startIndex: 0, format: { link: { uri: x.url }, foregroundColor: rgb(LINK), underline: true, italic: true, fontFamily: FONT, fontSize: SIZE } }],
        }] }],
        fields: 'userEnteredValue,textFormatRuns',
      },
    }));
    for (let k = 0; k < reqs.length; k += 200) {
      await call(`${api}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(k, k + 200) }) });
    }
    console.log(`  차량번호에 공급사 사진링크 ${linked.length}대 · 링크 없는 차 ${rows.length - linked.length}대는 글자만`);
  }
}
console.log(`\n  반영 완료 — 탭 「${title}」 · ${values.length}행`);
console.log(`  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
