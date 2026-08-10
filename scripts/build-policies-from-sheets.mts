/**
 * **공급사 시트의 조건 열 → 정책**을 만들고 매물에 붙인다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-10)
 *   매물에 `policy_code` 가 없으면 보험·연령·주행 조건이 통째로 빈다. 실측 177대 —
 *   이안카는 67대 전부(정책 자체가 ERP 에 없었다), 아이카 77 · 손오공 22 · 아이언 10 · 경진 1.
 *   그런데 **시트에는 값이 다 있다** — 대인·대물·자차·자손·무보험·연주행·분납·21세·23세·1만+·정비.
 *   우리가 안 읽었을 뿐이다.
 *
 * ★**탭마다 조건이 다를 수 있다.** 이안카는 「이안카」와 「이안카 재렌트」의 자차가 다르다
 *   (100만 vs 50만~100만). 그러므로 «공급사 하나에 정책 하나»가 아니라
 *   **같은 조건끼리 묶어** 정책을 만든다. 조건이 같으면 한 벌로 접힌다.
 *
 * ⚠ 정책은 **계약서에 실리는 값**이다. 지어내지 않는다 —
 *   시트에 없는 칸은 비워 두고, 읽은 값만 넣는다. 사람이 보고 채우면 된다.
 * ⚠ 이미 `policy_code` 가 붙은 매물은 건드리지 않는다. 사람이 연결한 것을 덮으면 안 된다.
 * ⚠ 새 정책 코드는 `{공급사코드}_S{번호}` 꼴이다 — 시트에서 왔음을 코드로 알 수 있게.
 *
 *   npx tsx scripts/build-policies-from-sheets.mts
 *   npx tsx scripts/build-policies-from-sheets.mts --apply
 *   npx tsx scripts/build-policies-from-sheets.mts --only=RP031
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONLY = arg('only').split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const shT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const grabGrid = async (id: string, tries = 4): Promise<Rec> => {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`;
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
    const j = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return j;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(10000 * (i + 1)); continue; }
    throw new Error(j?.error?.message || `HTTP ${res.status}`);
  }
};

/* ── 시트 표기를 스키마 값으로 ──────────────────────────────────────── */

/**
 * 「50만」·「1천5백」·「1억」·「150,000」 → 원 단위. 못 읽으면 0.
 *
 * ★**맨숫자는 만원으로 본다**(사장님 표기 관행). 시트에 「10」·「100」처럼 단위 없이 적는 곳이 있고
 *   그대로 원으로 읽으면 10원·100원이 계약서에 실린다(실측: 자차 「100만」이 100 으로 저장됨).
 *   단 여섯 자리 이상이면 이미 원 단위로 적은 것이다(「150,000」).
 */
function won(v: unknown): number {
  const s = S(v).replace(/\s/g, '');
  if (!s || /^(없음|x|X|-|불가|무한)$/.test(s)) return 0;
  let total = 0; let matched = false;
  const eok = /([\d.]+)억/.exec(s); if (eok) { total += Number(eok[1]) * 100_000_000; matched = true; }
  const cheon = /([\d.]+)천/.exec(s); if (cheon) { total += Number(cheon[1]) * 10_000_000; matched = true; }
  const baek = /([\d.]+)백/.exec(s); if (baek) { total += Number(baek[1]) * 1_000_000; matched = true; }
  const man = /([\d,]+)만/.exec(s); if (man) { total += Number(man[1].replace(/,/g, '')) * 10_000; matched = true; }
  if (matched) return total;
  if (/원$/.test(s)) { const n = Number(s.replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0; }
  const plain = /^[\d,]+$/.exec(s);
  if (!plain) return 0;
  const n = Number(plain[0].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 100_000 ? n * 10_000 : n;   // 만원 표기 · 여섯 자리부터는 원 단위
}
/** 「무한」·「1억」처럼 **한도로만 쓰는 말**인가. 면책금은 이런 값을 갖지 않는다. */
const looksLikeLimit = (v: string) => /무한|억/.test(v.replace(/\s/g, ''));
/**
 * 「50만 / 무한」 두 값이 한 칸에 온다. **순서가 공급사마다 반대다** —
 * 이안카는 «면책/한도», 손오공·빌린카는 «한도/면책». 자리로 정하면 뒤집힌다(실측 2026-08-10).
 * 그래서 «무한·억이 들어간 쪽»을 한도로 본다. 둘 다 아니면 큰 쪽이 한도다.
 */
function splitPair(v: unknown): { deductible: number; limit: string } {
  const s = S(v);
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { deductible: 0, limit: s };
  const [a, b] = parts;
  if (looksLikeLimit(b) && !looksLikeLimit(a)) return { deductible: won(a), limit: b };
  if (looksLikeLimit(a) && !looksLikeLimit(b)) return { deductible: won(b), limit: a };
  return won(a) >= won(b) ? { deductible: won(b), limit: a } : { deductible: won(a), limit: b };
}
/** 「무한」·「1억」 → 스키마 표기(무한 / 1억원). */
function limitLabel(v: unknown): string {
  const s = S(v).replace(/\s/g, '');
  if (!s || s === '없음') return '';
  if (/무한/.test(s)) return '무한';
  const n = won(s);
  if (!n) return s;
  if (n >= 100_000_000) return `${n / 100_000_000}억원`;
  if (n >= 10_000) return `${(n / 10_000).toLocaleString('ko-KR')}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}
/** 「2만km」·「무제한」 → 스키마 선택지. */
function mileageLabel(v: unknown): string {
  const s = S(v).replace(/\s/g, '');
  if (!s) return '';
  if (/무제한/.test(s)) return '무제한';
  const m = /([\d.]+)만/.exec(s);
  if (m) return `연 ${(Number(m[1]) * 10_000).toLocaleString('ko-KR')}km`;
  const n = Number(s.replace(/[^\d]/g, ''));
  return n ? `연 ${n.toLocaleString('ko-KR')}km` : s;
}
/** 「불가」·「10」(만원) → 연령하향 가능 여부. 21·23 두 칸을 함께 본다. */
function ageLowering(a21: unknown, a23: unknown): { level: string; cost: number } {
  const ok = (v: unknown) => { const s = S(v).replace(/\s/g, ''); return !!s && !/^(불가|x|X|-|없음)$/.test(s); };
  if (ok(a21)) return { level: '만 21세까지', cost: won(a21) };
  if (ok(a23)) return { level: '만 23세까지', cost: won(a23) };
  return { level: '불가', cost: 0 };
}
const yesNo = (v: unknown, yes: string, no: string) => {
  const s = S(v).replace(/\s/g, '');
  if (!s) return '';
  return /^(x|X|불가|없음|미제공|미포함)$/.test(s) ? no : yes;
};

/** 조건 열 한 행 → 정책 필드. 읽은 것만 담는다(빈 칸은 안 만든다). */
function policyFrom(hdr: string[], row: string[]): Rec {
  const at = (re: RegExp) => { const i = hdr.findIndex((h) => re.test(h)); return i >= 0 ? S(row[i]) : ''; };
  const injury = splitPair(at(/^대인/));
  const property = splitPair(at(/^대물/));
  const self = splitPair(at(/^자손/));
  /**
   * 자차 — 「차량/50~100」은 «보상기준 / 면책 하한~상한»이다.
   * 앞의 「차량」·「시세」는 보상 기준이고 뒤가 손님 부담 범위다.
   * 슬래시를 안 떼면 하한이 0 으로 읽혀 기존 정책과 안 맞고 정책이 두 벌 생긴다(실측 2026-08-10).
   */
  const ownRaw = S(at(/^자차/));
  const ownParts = ownRaw.split('/').map((x) => x.trim()).filter(Boolean);
  const ownBase = ownParts.length > 1 ? ownParts[0] : '';
  const own = ownParts.length > 1 ? ownParts.slice(1).join('/') : ownRaw;
  const ownRange = own.split('~').map((x) => x.trim());
  const age = ageLowering(at(/^21세/), at(/^23세/));
  const out: Rec = {};
  const put = (k: string, v: unknown) => { if (v !== '' && v !== 0 && v != null) out[k] = v; };
  put('injury_compensation_limit', limitLabel(injury.limit));
  put('injury_deductible', injury.deductible);
  put('property_compensation_limit', limitLabel(property.limit));
  put('property_deductible', property.deductible);
  put('self_body_accident', limitLabel(self.limit));
  put('self_body_deductible', self.deductible);
  put('uninsured_damage', limitLabel(at(/^무보험/)));
  // 자차 — 「100만」이면 정액, 「50만~100만」이면 하한·상한.
  if (ownRange.length === 2) { put('own_damage_min_deductible', won(ownRange[0])); put('own_damage_max_deductible', won(ownRange[1])); }
  else if (own) { put('own_damage_min_deductible', won(own)); put('own_damage_max_deductible', won(own)); }
  if (ownBase) put('own_damage_compensation', /시세/.test(ownBase) ? '시세 기준' : /차량/.test(ownBase) ? '차량가 기준' : '');
  put('annual_mileage', mileageLabel(at(/^연주행|^약정주행/)));
  put('mileage_upcharge_per_10000km', won(at(/^1만\+|^1만km/)));
  put('driver_age_lowering', age.level);
  put('age_lowering_cost', age.cost);
  put('deposit_installment', yesNo(at(/^분납/), '가능', '불가'));
  put('maintenance_service', yesNo(at(/^정비/), '포함', '불포함'));
  put('personal_driver_scope', at(/^운전자범위|^운전범위/));
  return out;
}

/* ── 읽기 ──────────────────────────────────────────────────────────── */

const [prods, pol3, pol4, t3, t4] = await Promise.all(
  ['v4/products', 'policies', 'v4/policies', 'partners', 'v4/partners'].map(async (n) =>
    JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const policyCodes = new Set<string>();
/** 기존 정책 — 공급사별로, 조건이 같으면 **새로 만들지 않고 여기에 붙인다.** */
const existingByProvider = new Map<string, { code: string; rec: Rec }[]>();
for (const src of [pol3, pol4] as Rec[]) {
  for (const [k, v] of Object.entries<Rec>(src)) {
    if (!v || typeof v !== 'object') continue;
    const code = S(v.policy_code) || k;
    policyCodes.add(code);
    if (dead(v)) continue;
    const prov = S(v.provider_company_code);
    if (!prov) continue;
    existingByProvider.set(prov, [...(existingByProvider.get(prov) || []), { code, rec: v }]);
  }
}
/**
 * 시트에서 읽은 조건이 **기존 정책과 같은가.**
 * 사람이 만들어 둔 정책이 이미 있으면 그걸 쓴다 — 같은 조건으로 정책을 또 만들면
 * 어느 것이 진짜인지 알 수 없게 되고, 나중에 한쪽만 고쳐 둘이 갈린다.
 * 보험·자차·연주행 같은 «돈이 걸린 칸»만 견준다. 이름·메모는 달라도 같은 정책이다.
 */
const SAME_KEYS = ['injury_compensation_limit', 'injury_deductible',
  'property_compensation_limit', 'property_deductible',
  'self_body_accident', 'self_body_deductible', 'uninsured_damage',
  'own_damage_min_deductible', 'own_damage_max_deductible', 'annual_mileage'] as const;
const sameAsExisting = (provider: string, fields: Rec): string => {
  for (const { code, rec } of existingByProvider.get(provider) || []) {
    /**
     * ★기존 정책에 **없는 칸은 «모름»**이라 불일치로 보지 않는다.
     *   사람이 만든 정책은 면책금 같은 칸을 비워 둔 경우가 있다. 그걸 불일치로 치면
     *   같은 정책이 두 벌 생기고, 나중에 한쪽만 고쳐 둘이 갈린다.
     *   둘 다 값이 있을 때만 견준다 — 그때 다르면 정말 다른 정책이다.
     */
    /**
     * ★**표기가 아니라 값으로 견준다.**
     *   사람이 만든 정책은 「50만원」·「연간 3만Km」로 적혀 있고 시트에서 읽은 값은
     *   500000 · 「연 30,000km」다. 글자로 비교하면 같은 정책이 매번 «다르다»고 나와
     *   같은 조건의 정책이 두 벌 생긴다(실측 2026-08-10).
     * ★기존 정책에 **없는 칸은 «모름»**이라 불일치로 보지 않는다 —
     *   둘 다 값이 있을 때만 견준다.
     */
    const same = SAME_KEYS.every((k) => {
      const a = fields[k]; const b = rec[k];
      if (a == null || a === '' || b == null || b === '') return true;
      if (k === 'annual_mileage') {
        const km = (v: unknown) => {
          const t = S(v).replace(/[\s,]/g, '');
          if (/무제한/.test(t)) return -1;
          const man = /([\d.]+)만/.exec(t);
          if (man) return Number(man[1]) * 10_000;
          return Number(t.replace(/[^\d]/g, '')) || 0;
        };
        return km(a) === km(b);
      }
      // 금액 칸은 원 단위로 맞춰 본다.
      const na = won(a); const nb = won(b);
      if (na && nb) return na === nb;
      return S(a).replace(/\s/g, '') === S(b).replace(/\s/g, '');
    });
    if (same) return code;
  }
  return '';
};

/** 정책이 필요한 매물 — 목록에 서는데 policy_code 가 없다. */
const need = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const rec = { ...p, _key: k, product_code: p.product_code || k } as EntityRecord;
  if (isHiddenFromCatalog(rec as Rec) || !priceList(rec).length) continue;
  if (S(p.policy_code)) continue;
  const pl = norm(p.car_number);
  if (pl) need.set(pl, [...(need.get(pl) || []), rec]);
}

type Plan = { code: string; provider: string; name: string; tabs: string[]; fields: Rec; plates: string[]; reuse: boolean };
const plans: Plan[] = [];
const unread: string[][] = [];
const seen = new Set<string>();

for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  if (NOT_SHEET_BACKED.has(code)) continue;
  if (ONLY.length && !ONLY.includes(code)) continue;
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  try {
    const grid = await grabGrid(id);
    const { tabs } = readSupplierSheet(grid as never, p as EntityRecord);
    /** 같은 조건끼리 묶는다 — 조건 지문(fingerprint)이 같으면 한 정책이다. */
    const groups = new Map<string, { fields: Rec; tabs: Set<string>; plates: Set<string> }>();
    for (const t of tabs) {
      const hdr = (t.table[0] || []).map(S);
      const c = findPlateAndStatusColumns(hdr);
      if (c.plate < 0) continue;
      for (const r of t.table.slice(1)) {
        const pl = norm(r[c.plate]);
        if (!pl || !need.has(pl)) continue;
        const fields = policyFrom(hdr, r);
        /**
         * ★**보험 한도가 하나도 없으면 정책이 아니다.**
         *   조건 칸이 빈 행에서도 「연령하향 불가」 같은 기본값 하나는 나온다.
         *   그걸로 정책을 만들면 화면엔 «정책 있음»으로 보이는데 내용이 없어,
         *   영업자가 조건을 확인했다고 착각한다. 안 만드는 게 낫다 — 사람이 채우면 된다.
         */
        const hasInsurance = ['injury_compensation_limit', 'property_compensation_limit',
          'self_body_accident', 'own_damage_max_deductible'].some((k) => fields[k]);
        if (!hasInsurance) continue;
        const fp = JSON.stringify(Object.entries(fields).sort());
        if (!groups.has(fp)) groups.set(fp, { fields, tabs: new Set(), plates: new Set() });
        const g = groups.get(fp)!;
        g.tabs.add(t.title); g.plates.add(pl);
      }
    }
    let n = 1;
    for (const g of [...groups.values()].sort((a, b) => b.plates.size - a.plates.size)) {
      // 기존 정책과 조건이 같으면 그걸 쓴다 — 같은 정책을 두 벌 만들지 않는다.
      const hit = sameAsExisting(code, g.fields);
      if (hit) {
        plans.push({ code: hit, provider: code, name, tabs: [...g.tabs], fields: g.fields, plates: [...g.plates], reuse: true });
        continue;
      }
      let pcode = `${code}_S${String(n).padStart(2, '0')}`;
      while (policyCodes.has(pcode)) { n++; pcode = `${code}_S${String(n).padStart(2, '0')}`; }
      policyCodes.add(pcode);
      n++;
      plans.push({ code: pcode, provider: code, name, tabs: [...g.tabs], fields: g.fields, plates: [...g.plates], reuse: false });
    }
  } catch (e) { unread.push([code, name, String((e as Error).message).slice(0, 50)]); }
}

const label: Record<string, string> = {
  injury_compensation_limit: '대인한도', injury_deductible: '대인면책',
  property_compensation_limit: '대물한도', property_deductible: '대물면책',
  self_body_accident: '자손한도', self_body_deductible: '자손면책',
  uninsured_damage: '무보험', own_damage_min_deductible: '자차하한', own_damage_max_deductible: '자차상한',
  annual_mileage: '연주행', mileage_upcharge_per_10000km: '1만km추가',
  driver_age_lowering: '연령하향', age_lowering_cost: '하향비용',
  deposit_installment: '분납', maintenance_service: '정비', personal_driver_scope: '운전범위',
};
const money = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : S(v));

console.log(`■ 시트 조건 → 정책 만들기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  정책 없는 매물 ${need.size}대 · 만들 정책 ${plans.length}개 · 붙일 매물 ${plans.reduce((n, p) => n + p.plates.length, 0)}대\n`);
for (const p of plans) {
  console.log(`  ${p.code}  ${p.reuse ? '(기존 정책에 붙임)' : '(새로 만듦)'}  ${p.name}  [${p.tabs.join(' · ')}]  ${p.plates.length}대`);
  console.log(`     ${Object.entries(p.fields).map(([k, v]) => `${label[k] || k} ${money(v)}`).join(' · ')}`);
}
const covered = new Set(plans.flatMap((p) => p.plates));
const left = [...need.keys()].filter((pl) => !covered.has(pl));
if (left.length) {
  const by = new Map<string, number>();
  for (const pl of left) { const r = (need.get(pl) || [])[0] as Rec; by.set(S(r.provider_company_code), (by.get(S(r.provider_company_code)) || 0) + 1); }
  console.log(`\n  시트에서 조건을 못 찾은 차 ${left.length}대 — ${[...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
if (unread.length) { console.log(`\n  ✗ 못 읽은 시트 ${unread.length}곳`); for (const u of unread) console.log(`     ${u[1]} ${u[0]} — ${u[2]}`); }

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/policies-from-sheets.csv', `﻿${[
  ['정책코드', '공급사', '탭', '대수', ...Object.values(label)].join(','),
  ...plans.map((p) => [p.code, p.name, p.tabs.join(' · '), String(p.plates.length),
    ...Object.keys(label).map((k) => money(p.fields[k]))].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/policies-from-sheets.csv (${plans.length}행)`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let madeP = 0; let linked = 0;
for (const plan of plans) {
  if (plan.reuse) {
    for (const pl of plan.plates) {
      for (const rec of need.get(pl) || []) {
        const r = await fetch(`${DB}/v4/products/${encodeURIComponent(S((rec as Rec)._key))}.json?access_token=${dbT}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policy_code: plan.code, updatedAt: at }),
        });
        if (r.ok) linked++;
      }
    }
    continue;
  }
  const body: Rec = {
    policy_code: plan.code, policy_name: `${plan.name} ${plan.tabs.join('·')}`.trim(),
    provider_company_code: plan.provider, ...plan.fields,
    _source: 'supplier_sheet', createdAt: at, updatedAt: at,
  };
  const res = await fetch(`${DB}/v4/policies/${encodeURIComponent(plan.code)}.json?access_token=${dbT}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { console.log(`  △ 정책 ${plan.code} — ${res.status}`); continue; }
  madeP++;
  for (const pl of plan.plates) {
    for (const rec of need.get(pl) || []) {
      const r = await fetch(`${DB}/v4/products/${encodeURIComponent(S((rec as Rec)._key))}.json?access_token=${dbT}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_code: plan.code, updatedAt: at }),
      });
      if (r.ok) linked++;
    }
  }
}
console.log(`\n  정책 ${madeP}개 · 매물 ${linked}대 연결`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
