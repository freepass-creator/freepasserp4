/**
 * **정산원장에서 「계약중」인 차를 공급사 시트·상품리스트에 「계약중」으로 세운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「30분에 한번씩 여기 계약중이라고 되어있는 차량을 상품리스트,
 *   공급사 정제시트에 계약중이라고 표기해서 영업자들이 혼선없게끔」
 *   「정산시트에서는 계약중으로 바꿔주고 **계약완료되면 출고불가**가 되는거지」.
 *
 * ★**잠그기만 한다. 절대 풀지 않는다.**
 *   잘못 잠그면 못 파는 것뿐이지만, 잘못 풀면 **이미 나간 차를 다시 판다.**
 *   그래서 「환수」·「계약 불가(취소)」로 원장이 바뀌어도 여기서 출고가능으로 되돌리지 않는다 —
 *   다시 팔 수 있는 차인지는 사람이 보고 공급사 시트에서 직접 푼다.
 *
 * ★**두 곳을 다 고친다 — 한 곳만 고치면 되돌아간다.**
 *   · 공급사 시트 「상태」 = **정본**. 여기를 안 고치면 다음 발행이 옛 값으로 되돌린다.
 *   · 판매시트 「배차상태」 = 사본. 발행(2시간마다)까지 기다리면 영업자가 그동안 «출고가능»을 본다.
 *     그래서 **셀만** 고쳐 그 사이를 메운다. 탭을 다시 그리지 않는다 —
 *     발행은 탭을 통째로 새로 그려서, 영업자가 보는 중에 표가 사라졌다 나타난다.
 *
 * ★**출고불가는 안 덮는다.** 출고불가는 «못 파는 차»라 계약중보다 센 말이다.
 *   덮으면 팔면 안 되는 차가 목록에 다시 선다. 어긋나면 목록에만 남기고 사람이 본다.
 *
 * ★ERP 는 판매시트를 그대로 읽으므로 따로 손대지 않는다(판매시트=ERP, 2026-08-20 확정).
 *
 *   npx tsx scripts/mark-contract-in-listings.mts
 *   npx tsx scripts/mark-contract-in-listings.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  SETTLEMENT_LEDGER_ID as LEDGER_ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB,
  SETTLEMENT_CONTRACT_STATE as STATE,
} from '../lib/domain/settlement-ledger';
import { SHEET_NAME_MATCH, supplierSheetLabel, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
/**
 * ★**원장 상태 → 재고 상태**(사장님 2026-08-25 말씀 그대로).
 *   · 계약중 · 계약서 업로드  → 「계약중」   계약금 들어와 진행 중이다. 이 차는 못 판다
 *   · 계약 완료 · 연장       → 「출고불가」  차가 나가 있다
 *   · 환수 · 계약 불가(취소)  → **아무것도 안 한다**
 *     환수 = 계약완료됐다가 환수조건이 터진 것 · 취소 = 계약금 들어왔다 취소된 것.
 *     둘 다 **다시 팔 수 있는 차**지만, 다시 올리는 건 공급사가 자기 시트에서 한다(거기가 정본).
 *     우리가 풀면 공급사가 아직 준비 안 된 차를 목록에 세운다.
 */
const MAP: Record<string, string> = {
  '계약중': '계약중',
  '계약서 업로드': '계약중',
  '계약 완료': '출고불가',
  '연장': '출고불가',
};

/**
 * ★**이제는 «글자»가 아니라 «체크»가 말한다**(2026-08-25 원장 개편).
 *   사장님 「접수시트에 접수된거는 계약중으로 바뀌고 인도완료되면 상품시트에 연동되게 해야함」.
 * ```
 * 계약취소 ☑ · 환수  → 아무것도 안 한다. 다시 팔 수 있는 차지만 푸는 건 공급사 몫이다
 * 인도완료 ☐        → 「계약중」   접수는 됐고 차는 아직 있다. 못 판다
 * 인도완료 ☑        → 「출고불가」 차가 나가 있다
 * ```
 * ⚠ 「인도완료」 칸은 **접수 탭에만** 있다. 다른 탭에서는 「인도일」이 있으면 인도된 것으로 본다.
 */
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const stateOf = (r: string[], i: { done: number; deliver: number; cancel: number; state: number }) => {
  if (i.cancel >= 0 && ON(r[i.cancel])) return '';                       // 취소 — 손대지 않는다
  if (i.state >= 0 && /환수|취소|계약\s*불가/.test(S(r[i.state]))) return '';
  const delivered = (i.done >= 0 && ON(r[i.done])) || (i.deliver >= 0 && !!S(r[i.deliver]));
  return delivered ? '출고불가' : '계약중';
};
/**
 * ★**한 차에 여러 줄이면 «제일 최근 줄»이 이긴다.** 세기가 아니라 시간이다.
 *   실측 2026-08-25 — 기존실적은 정산월마다 쌓이는 이력이라 한 차가 여러 줄이다(290대).
 *   109호4100 은 여섯 줄: 계약서업로드 → 계약 완료 → **계약 불가(취소)**.
 *   내가 처음에 «센 말이 이긴다»로 뭉쳐서 과거의 계약완료가 최근의 취소를 이겼고,
 *   그래서 **다시 팔 수 있는 차를 잠갔다.** 환수 뒤 재렌트가 본업인데(재렌트 717건) 그걸 막았다.
 *   ⇒ 정산월(없으면 접수일)이 큰 줄이 그 차의 지금이다.
 */
const when = (r: string[], iy: number, im: number, ir: number) => {
  /**
   * ★**연·월이 칸으로 나뉘었다**(2026-08-25). 월만 보면 8월이 12월보다 크다는 판정이 안 서고,
   *   해가 바뀌면 통째로 뒤집힌다. 연×12 + 월로 이어 붙여 «시간»을 만든다.
   *   청구가 아직 없으면(인도 전) 접수일로 견준다.
   */
  const y = Number(r[iy]), m = Number(r[im]), rv = Number(r[ir]);
  const ym = Number.isFinite(y) && y > 2000 && Number.isFinite(m) && m > 0 ? y * 12 + m : 0;
  return ym * 100000 + (Number.isFinite(rv) && rv > 0 ? rv : 0);
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

// ── ① 원장에서 «차번별 제일 최근 줄»을 고른다
const latest = new Map<string, { at: number; to: string; why: string; tab: string; row: number }>();
for (const tab of [SETTLEMENT_CURRENT_TAB, '분납실적', SETTLEMENT_PAST_TAB, '취소']) {
  const v = await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((v?.values || []) as any[][]).map((r) => (r || []).map(S));
  // ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다.
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = rows[hi];
  const ip = h.indexOf('차량번호');
  const idx = { done: h.indexOf('인도완료'), deliver: h.indexOf('인도일'), cancel: h.indexOf('계약취소'), state: h.indexOf('상태') };
  const iy = h.indexOf('청구년'), im = h.indexOf('청구월'), ir = h.indexOf('접수일');
  if (ip < 0) continue;
  rows.slice(hi + 1).forEach((r, k) => {
    const p = key(r[ip]);
    if (!p || p === '미정') return;   // 번호 없는 줄은 붙일 데가 없다
    const at = when(r, iy, im, ir);
    const prev = latest.get(p);
    if (prev && at < prev.at) return;
    const why = idx.cancel >= 0 && ON(r[idx.cancel]) ? '계약취소'
      : idx.state >= 0 && /환수/.test(S(r[idx.state])) ? '환수'
      : (idx.done >= 0 && ON(r[idx.done])) || (idx.deliver >= 0 && S(r[idx.deliver])) ? '인도완료' : '인도 전';
    latest.set(p, { at, to: stateOf(r, idx), why, tab, row: hi + k + 2 });
  });
}
// 취소·환수는 여기서 빠진다 — 다시 팔 차지만 푸는 건 공급사 몫이다.
const want = new Map<string, string>();
const released: string[] = [];
for (const [p, x] of latest) {
  if (x.to) want.set(p, x.to);
  else released.push(`${p} — 최근 줄이 「${x.why}」(${x.tab} ${x.row}행) · 공급사가 풀 차다`);
}
const tally = new Map<string, number>();
for (const v of want.values()) tally.set(v, (tally.get(v) || 0) + 1);
console.log(`\n■ 정산원장 ${latest.size}대의 «제일 최근 줄» 기준 — ${APPLY ? '반영' : 'dry-run'}`);
console.log(`  세울 차 ${want.size} (${[...tally].map(([k, n]) => `${k} ${n}`).join(' · ')}) · 환수·취소라 안 건드리는 차 ${released.length}\n`);
if (!want.size) { console.log('  세울 차가 없다.\n'); process.exit(0); }

type Edit = { where: string; tab: string; row: number; plate: string; from: string; to: string };
const edits: Edit[] = [];
const held: string[] = [];
let already = 0;

// ── ② 공급사 시트 — 여기가 정본이다
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = ((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || [])
  .map((f: any) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }))
  .filter((b: any) => !/구버전|폐기/.test(b.label));
const found = new Set<string>();
const supplierData: { id: string; data: { range: string; values: string[][] }[] }[] = [];

for (const b of books) {
  const meta = await api(`${SH}/${b.id}?fields=sheets.properties(title,hidden)`);
  const data: { range: string; values: string[][] }[] = [];
  for (const s of (meta?.sheets || [])) {
    const tab = S(s.properties.title);
    if (s.properties.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab)) continue;
    const g = await api(`${SH}/${b.id}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ700`)}`);
    const rows = ((g?.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const h = rows[hi];
    const ip = h.indexOf('차량번호'), is = h.indexOf('상태');
    if (is < 0) continue;
    rows.slice(hi + 1).forEach((r, k) => {
      const p = key(r[ip]);
      if (!p || !want.get(p)) return;
      found.add(p);
      const to = want.get(p)!;
      const cur = S(r[is]);
      if (cur === to) { already++; return; }
      // ★사람이 「출고불가」라 적어 둔 것을 「계약중」으로 풀지 않는다 — 푸는 건 공급사가 한다.
      if (/출고불가|판매완료|말소/.test(cur) && to === '계약중') { held.push(`${b.label} 「${tab}」 ${p} — 「${cur}」를 계약중으로 풀지 않는다`); return; }
      edits.push({ where: `공급사 ${b.label}`, tab, row: hi + 2 + k, plate: p, from: cur || '(빈칸)', to });
      data.push({ range: `${a1(tab)}!${colA1(is)}${hi + 2 + k}`, values: [[to]] });
    });
  }
  if (data.length) supplierData.push({ id: b.id, data });
}

// ── ③ 판매시트 — 발행 전까지 영업자가 옛 값을 안 보게 «셀만» 고친다
const salesMeta = await api(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const salesData: { range: string; values: string[][] }[] = [];
for (const s of (salesMeta?.sheets || [])) {
  const tab = S(s.properties.title);
  if (s.properties.hidden || /AI |이 시트는/.test(tab)) continue;
  const g = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ1500`)}`);
  const rows = ((g?.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = rows[hi];
  const ip = h.indexOf('차량번호'), is = h.indexOf('배차상태');
  if (is < 0) continue;
  rows.slice(hi + 1).forEach((r, k) => {
    const p = key(r[ip]);
    if (!p || !want.get(p)) return;
    const to = want.get(p)!;
    const cur = S(r[is]);
    if (cur === to) { already++; return; }
    if (/출고불가|판매완료|말소/.test(cur) && to === '계약중') { held.push(`상품리스트 「${tab}」 ${p} — 「${cur}」를 계약중으로 풀지 않는다`); return; }
    edits.push({ where: '상품리스트', tab, row: hi + 2 + k, plate: p, from: cur || '(빈칸)', to });
    salesData.push({ range: `${a1(tab)}!${colA1(is)}${hi + 2 + k}`, values: [[to]] });
  });
}

const missing = [...want.keys()].filter((p) => !found.has(p));
if (released.length) { console.log(`\n  · 환수·취소 ${released.length}대 — 다시 파는 건 공급사가 자기 시트에서 올린다`); for (const x of released.slice(0, 8)) console.log(`     ${x}`); }
console.log(`  고칠 칸 ${edits.length} · 이미 계약중 ${already} · 안 덮음 ${held.length} · 공급사 시트에 없는 차 ${missing.length}`);
for (const e of edits.slice(0, 20)) console.log(`   ${e.where.slice(0, 14).padEnd(16)} 「${e.tab.slice(0, 10)}」 ${e.plate.padEnd(10)} ${e.from} → ${e.to}`);
if (edits.length > 20) console.log(`   … 외 ${edits.length - 20}칸`);
if (held.length) { console.log(`\n  ⚠ 더 센 말이 적혀 있어 안 덮은 곳 ${held.length}`); for (const x of held.slice(0, 10)) console.log(`     ${x}`); }
if (missing.length) console.log(`\n  · 공급사 시트에서 못 찾은 차 ${missing.length}: ${missing.slice(0, 10).join(' · ')}${missing.length > 10 ? ' …' : ''}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(`tmp/mark-contract-${stamp}.json`, JSON.stringify({ edits, held, missing }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. 반영은 --apply\n'); process.exit(0); }

for (const { id, data } of supplierData) await api(`${SH}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
if (salesData.length) await api(`${SH}/${SALES_SHEET_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: salesData }) });

console.log(`\n■ 끝 — 공급사 ${supplierData.reduce((n, x) => n + x.data.length, 0)}칸 · 상품리스트 ${salesData.length}칸을 세웠다.\n`);
