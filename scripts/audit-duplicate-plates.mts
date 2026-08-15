/**
 * **대원칙 — 같은 차량번호는 절대 있을 수 없다.** 어디서 겹치는지 전수로 짚는다. 읽기 전용.
 *
 * ★왜(사장님 2026-08-15 — 「대 원칙 절대 같은 차량번호는 있을 수 없다」)
 *   차번은 이 파이프라인의 **유일한 열쇠**다. 차종코드도 정책도 돈도 전부 차번에 매달린다.
 *   차번이 겹치면 «어느 줄이 그 차인지» 정할 수 없고, 그러면 매달린 것이 전부 흔들린다.
 *
 * ⚠ 지금 발행기는 겹친 줄을 **조용히 건너뛴다**(「같은 차가 두 번 나와 건너뛴 줄 23」).
 *   건너뛰면 숫자는 맞아 보이지만 **어느 줄을 버렸는지 아무도 모른다.**
 *   둘의 돈이 다르면 영업자는 둘 중 하나를 보고, 그게 맞는 쪽인지 알 수 없다.
 *
 * ★세 자리에서 본다 — 겹침의 뜻이 자리마다 다르다.
 *   ① 한 공급사 안에서   같은 차를 두 번 올렸다. 그 집 시트를 고쳐야 한다
 *   ② 공급사끼리        같은 차를 두 곳이 판다. **이중판매 위험** — 제일 위험하다
 *   ③ 정제시트·판매시트  우리가 만든 겹침이다. 우리 잘못이다
 *
 * ⚠ 겹친 두 줄의 **돈이 같은지도 본다.** 같으면 표기 중복이고, 다르면 어느 쪽이 참인지
 *   아무도 모르는 상태다 — 뒤엣것이 진짜 사고다.
 *
 *   npx tsx scripts/audit-duplicate-plates.mts
 *   npx tsx scripts/audit-duplicate-plates.mts --list
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const LIST = process.argv.includes('--list');
const SALES = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
const REFINE = arg('refine', '1nLwfgBSCpN_GnFUw_2SbG5LdyB9-l6d9ObkMP3IGa5I');
/** 겹친 줄끼리 견줄 돈 — 다르면 «어느 쪽이 참인지 모르는» 상태다. */
const MONEY = ['단기보증', '장기보증', '1개월', '12개월', '24개월', '36개월', '48개월', '60개월'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
/** 「1,070,000」과 「1070000」은 같은 값이다. 표기 차이를 어긋남으로 세지 않는다. */
const money = (v: unknown) => { const d = S(v).replace(/[,\s원₩]/g, ''); return /^\d+(\.\d+)?$/.test(d) ? String(Number(d)) : S(v); };
/**
 * ★**진짜 차번만 센다.** 「12가3456」·「123가4567」 꼴이다.
 * ⚠ 안 거르면 숨긴 매핑 탭의 「표기사전」·「차고지」 같은 글자를 차번으로 읽어
 *   **없는 겹침 3건을 만들어 낸다**(실측 2026-08-15). 거짓 숫자는 «모름»보다 나쁘다.
 * ⚠ 「미정」처럼 차번 자리에 적어 둔 말도 차번이 아니다 — 따로 세어 보여 준다.
 */
const REAL_PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const isPlate = (v: string) => REAL_PLATE.test(v);

type Hit = { where: string; who: string; plate: string; money: Record<string, string> };
const all: Hit[] = [];
/** 차번 자리에 차번이 아닌 것이 적힌 줄 — 겹침이 아니라 «입력이 덜 된» 줄이다. */
const notPlate: string[] = [];

/** ── 공급사 시트 — 발행기와 같은 방식으로 읽는다(숨긴 탭·행 제외). */
{
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    const code = S(r[1]);
    if (!id || !code || NOT_SHEET_BACKED.has(code)) continue;
    const who = companyAlias(S(r[0])) || S(r[0]);
    let grid: Rec;
    try { grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`); } catch { continue; }
    const read = readSupplierSheet(grid as never, { partner_code: code, partner_name: who } as EntityRecord);
    for (const t of read.tabs) {
      if (isOurNonInventoryTab(S(t.title))) continue;
      const hdr = (t.table[0] || []).map(S);
      const at = (n: string) => hdr.indexOf(n);
      const pi = at('차량번호') >= 0 ? at('차량번호') : at('차번');
      if (pi < 0) continue;
      for (const row of t.table.slice(1)) {
        const p = plate(row[pi]);
        if (!p) continue;
        if (!isPlate(p)) { notPlate.push(`${who}「${S(t.title)}」 「${p}」`); continue; }
        const m: Record<string, string> = {};
        for (const c of MONEY) { const i = at(c); if (i >= 0) m[c] = money(row[i]); }
        all.push({ where: `${who}「${S(t.title)}」`, who, plate: p, money: m });
      }
    }
  }
}

const byPlate = new Map<string, Hit[]>();
for (const h of all) byPlate.set(h.plate, [...(byPlate.get(h.plate) || []), h]);
const dups = [...byPlate].filter(([, hs]) => hs.length > 1);

console.log(`\n■ 대원칙 검사 — 같은 차량번호는 절대 있을 수 없다\n`);
console.log(`  공급사 시트에서 읽은 줄 ${all.length} · 서로 다른 차번 ${byPlate.size} · **겹친 차번 ${dups.length}**`);
if (notPlate.length) {
  console.log(`
  ▲ 차번 자리에 차번이 아닌 것이 적힌 줄 ${notPlate.length} — 겹침이 아니라 «입력이 덜 된» 줄이다`);
  for (const l of [...new Set(notPlate)].slice(0, 8)) console.log(`     ${l}`);
}

const moneySame = (hs: Hit[]) => {
  const keys = [...new Set(hs.flatMap((h) => Object.keys(h.money)))];
  return keys.every((k) => new Set(hs.map((h) => h.money[k] || '')).size === 1);
};
const inOne = dups.filter(([, hs]) => new Set(hs.map((h) => h.who)).size === 1);
const across = dups.filter(([, hs]) => new Set(hs.map((h) => h.who)).size > 1);

console.log(`\n  ① 한 공급사 안에서 겹침   ${inOne.length}건 — 그 집 시트를 고쳐야 한다`);
for (const [p, hs] of (LIST ? inOne : inOne.slice(0, 12))) {
  console.log(`     ${pad(p, 12)}${hs.map((h) => h.where).join('  ↔  ')}${moneySame(hs) ? '' : '   ⛔ 돈이 다르다'}`);
}
if (!LIST && inOne.length > 12) console.log(`     … 그 밖 ${inOne.length - 12}건`);

console.log(`\n  ② 공급사끼리 겹침         ${across.length}건 — **같은 차를 두 곳이 판다. 이중판매 위험**`);
for (const [p, hs] of across) {
  console.log(`     ${pad(p, 12)}${hs.map((h) => h.where).join('  ↔  ')}${moneySame(hs) ? '' : '   ⛔ 돈이 다르다'}`);
}

/** ── 우리가 만든 시트 — 여기서 겹치면 우리 잘못이다. */
async function dupInDoc(id: string, label: string) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`);
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  const seen = new Map<string, string[]>();
  for (const t of titles) {
    if (isOurNonInventoryTab(t)) continue;      // 「AI 인계」는 매핑 표지 재고표가 아니다
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(a1Tab(t))}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]);
    const h = rows.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) continue;
    const pi = (rows[h] || []).findIndex((c) => S(c) === '차량번호');
    rows.slice(h + 1).forEach((r, n) => {
      const p = plate(r[pi]);
      if (!p || !isPlate(p)) return;
      seen.set(p, [...(seen.get(p) || []), `${t}!${n + h + 2}`]);
    });
  }
  const d = [...seen].filter(([, w]) => w.length > 1);
  console.log(`\n  ③ ${label} — 줄 ${[...seen.values()].reduce((a, w) => a + w.length, 0)} · 차번 ${seen.size} · **겹침 ${d.length}건**`);
  for (const [p, w] of (LIST ? d : d.slice(0, 10))) console.log(`     ${pad(p, 12)}${w.join('  ↔  ')}`);
  if (!LIST && d.length > 10) console.log(`     … 그 밖 ${d.length - 10}건`);
  return d.length;
}
const dRefine = await dupInDoc(REFINE, '정제시트');
const dSales = await dupInDoc(SALES, '판매시트');

console.log(`\n  ${'─'.repeat(58)}`);
const bad = inOne.length + across.length + dRefine + dSales;
if (!bad) console.log('  ✓ 대원칙이 지켜지고 있다 — 겹친 차번 0\n');
else {
  console.log(`  ⛔ 대원칙 위반 ${bad}건 — 공급사 안 ${inOne.length} · 공급사끼리 ${across.length} · 정제시트 ${dRefine} · 판매시트 ${dSales}`);
  console.log('     차번은 이 파이프라인의 유일한 열쇠다. 겹치면 매달린 것이 전부 흔들린다.\n');
  process.exit(1);
}
