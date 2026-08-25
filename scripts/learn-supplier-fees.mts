/**
 * **정산원장에서 공급사별 수수료를 배운다(읽기 전용).**
 *
 * ★사장님 2026-08-25 「수수료표 올리라고 할테니까 **학습해서** 공급사별로 공급사시트에 박아주고」.
 *   공급사가 올려 주기 전에 «지금까지 실제로 얼마를 줬는지»를 먼저 뽑아 둔다.
 *   그래야 공급사가 올린 표와 견줘 «말이 다른 곳»을 짚을 수 있다.
 *
 * ★공급사 × 상품구분 × 계약기간 으로 묶고, **가장 많이 쓰인 값**을 뽑는다.
 *   평균을 내지 않는다 — 1,706건에 금액(1000000)이 섞여 있어 평균은 뜻을 잃는다.
 * ★1 보다 작으면 율, 1000 이상이면 금액(기준 「고정」), 그 사이는 «모름»으로 남긴다.
 * ★원장 이름과 공급사 시트 이름이 다른 곳이 많다(에이스·지엔카·AMR·모티스…). 그건 지난 거래처다.
 *   **살아 있는 공급사 시트에 이름이 붙는 것만** 표로 낸다.
 *
 *   npx tsx scripts/learn-supplier-fees.mts
 *   npx tsx scripts/learn-supplier-fees.mts --all      살아 있지 않은 이름까지 전부
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB } from '../lib/domain/settlement-ledger';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { readFeeCell, feeRateText, feeAmountText } from '../lib/domain/supplier-fee-table';

const ALL = process.argv.includes('--all');
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s|\(.*?\)|주식회사|㈜|렌터카|렌트카|캐피탈/g, '').toLowerCase();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

// ── 살아 있는 공급사 시트
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const live = ((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || [])
  .map((f: any) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }))
  .filter((b: any) => !/구버전|폐기/.test(b.label));
const liveByKey = new Map<string, string>();
for (const b of live) liveByKey.set(norm(b.label), b.label);

// ── 원장
type Row = Record<string, string>;
const all: Row[] = [];
for (const tab of [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB]) {
  /**
   * ★**서식된 글자가 아니라 담긴 값을 읽는다**(`UNFORMATTED_VALUE`).
   *   실측 2026-08-25 — 율 칸에 `0.00%` 서식을 세운 뒤 기본(FORMATTED_VALUE)으로 읽었더니
   *   담긴 값 `1000000` 이 글자 「100000000.00%」로 와서 **1억으로 읽혔다.**
   *   0.0325 도 「3.25%」로 와서 325 가 됐다. 숫자를 다룰 땐 반드시 이 옵션이다.
   */
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${tab}'!A1:AL3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  const h = rows[0] || [];
  for (const r of rows.slice(1)) {
    if (!S(r[h.indexOf('차량번호')])) continue;
    const o: Row = {}; h.forEach((k, i) => { o[k] = S(r[i]); });
    all.push(o);
  }
}

type Bucket = { rates: Map<string, number>; agency: Map<string, number>; n: number; basis: Map<string, number> };
const table = new Map<string, Map<string, Bucket>>();   // 공급사 → 「상품구분|기간」 → 값
let unknown = 0;
for (const r of all) {
  const raw = S(r['공급사']); if (!raw) continue;
  const label = liveByKey.get(norm(raw));
  if (!label && !ALL) continue;
  const who = label || `(지난 거래처) ${raw}`;
  const kind = S(r['상품구분']) || '(상품구분 없음)';
  const term = S(r['계약기간']).replace(/[^0-9]/g, '');
  const k = `${kind}|${term}`;
  const t = table.get(who) || new Map<string, Bucket>();
  const b = t.get(k) || { rates: new Map(), agency: new Map(), n: 0, basis: new Map() };
  b.n++;
  for (const [col, bag] of [['공급사수수료율', b.rates], ['에이전시수수료율', b.agency]] as const) {
    const cell = readFeeCell(r[col]);
    if (cell.kind === 'unknown') { if (S(r[col])) unknown++; continue; }
    const key = cell.kind === 'rate' ? feeRateText(cell.value) : feeAmountText(cell.value);
    bag.set(key, (bag.get(key) || 0) + 1);
    if (bag === b.rates) b.basis.set(cell.kind === 'rate' ? '율' : '고정', (b.basis.get(cell.kind === 'rate' ? '율' : '고정') || 0) + 1);
  }
  t.set(k, b); table.set(who, t);
}

const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0];
console.log(`\n■ 정산원장 ${all.length}건에서 배운 수수료 — 살아 있는 공급사 ${[...table.keys()].filter((k) => !k.startsWith('(지난')).length}곳${ALL ? ' (+지난 거래처)' : ''}`);
console.log(`  율도 금액도 아닌 값 ${unknown}칸 — 사람이 봐야 한다\n`);

const out: Record<string, unknown[]> = {};
for (const [who, t] of [...table].sort((a, b) => [...b[1].values()].reduce((n, x) => n + x.n, 0) - [...a[1].values()].reduce((n, x) => n + x.n, 0))) {
  const total = [...t.values()].reduce((n, x) => n + x.n, 0);
  console.log(`   ${who}  ${total}건`);
  const rows: unknown[] = [];
  for (const [k, b] of [...t].sort((a, b) => b[1].n - a[1].n)) {
    const [kind, term] = k.split('|');
    const r = top(b.rates); const a = top(b.agency);
    const basis = top(b.basis)?.[0] === '고정' ? '고정' : (/구독|장기렌트/.test(kind) ? '대여료×기간' : '차량가액');
    const spread = b.rates.size > 1 ? ` ⚠갈림 ${b.rates.size}가지` : '';
    console.log(`      ${kind.padEnd(10)} ${(term ? term + '개월' : '전기간').padEnd(7)} ${basis.padEnd(9)} 공급사 ${(r?.[0] || '-').padEnd(12)} 에이전시 ${(a?.[0] || '-').padEnd(12)} ${b.n}건${spread}`);
    rows.push({ 상품구분: kind, 계약기간: term, 기준: basis, 공급사율: r?.[0] || '', 에이전시율: a?.[0] || '', 건수: b.n, 갈림: b.rates.size });
  }
  out[who] = rows;
}
writeFileSync('tmp/learned-fees.json', JSON.stringify(out, null, 2));
console.log(`\n  배운 표 tmp/learned-fees.json — 아무것도 안 썼다.\n`);
