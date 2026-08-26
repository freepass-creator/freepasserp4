/**
 * **시트와 ERP 가 갈라졌나.** 읽기만. 아무것도 안 고친다.
 *
 * ★★★**왜 이 검사가 필요한가 — 지금 두 저장소가 «둘 다 살아 있다».**
 *   정본은 ERP 로 옮겼지만(2026-08-26) 시트를 «되돌릴 곳»으로 남겨 뒀다.
 *   그래서 사람이 시트에 직접 적으면 ERP 가 그걸 모른다.
 *   ⚠ 실제로 그날 한 번 갈렸다 — 사장님이 시트 접수 탭에 `109하1261` 을 적었고,
 *     ERP 는 431 · 시트는 432 였다. 청구서를 그대로 뽑았으면 **한 건이 빠졌다.**
 *
 * ★**하루 한 번은 돌린다.** 갈라진 걸 늦게 알수록 되돌리기 어렵다.
 *   갈라졌으면 `migrate-settlement-to-erp --apply` 로 시트 것을 끌어온다
 *   (코드가 안 바뀌므로 두 번 돌려도 안전하다).
 *
 * ⚠ **시트가 언제나 옳은 게 아니다.** ERP 에만 있는 줄은 «ERP 에서 접수한» 것이라 정상이다.
 *   시트에만 있는 줄이 문제다 — 그건 «아직 안 옮겨진» 것이다.
 *
 *   npx tsx scripts/check-settlement-drift.mts
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';

const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const SERIAL0 = Date.UTC(1899, 11, 30);
/** 그 자리 날짜 그대로. ★`toISOString()` 금지 — UTC 로 돌아 하루가 밀린다. */
const ymd = (v: unknown): string => {
  const t = S(v);
  if (!t) return '';
  const n = Number(t);
  const d = Number.isFinite(n) && n > 20_000 && n < 80_000
    ? (() => { const u = new Date(SERIAL0 + Math.round(n) * 86_400_000); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); })()
    : new Date(t);
  return Number.isNaN(+d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });

console.log('\n■ 시트 ↔ ERP 갈라짐\n');

// ── 시트 ──────────────────────────────────────────────────
const sheet = new Map<string, { tab: string; row: number; supplier: string; customer: string }>();
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) { console.log(`   ✕ 「${tab}」 못 읽음 ${r.status}`); continue; }
  const all = (((await r.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
  const hi = all.findIndex((x) => x.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  all.slice(hi + 1).forEach((row, k) => {
    const plate = S(row[at('차량번호')]);
    if (!plate) return;
    sheet.set(`${plate}|${ymd(row[at('접수일')])}`, {
      tab, row: hi + 2 + k, supplier: S(row[at('공급사')]), customer: S(row[at('고객명')]),
    });
  });
}

// ── ERP ──────────────────────────────────────────────────
const recs = Object.values((await getDatabase().ref('v4/settlement_rows').get()).val() || {})
  .map((raw) => normalizeRecord(raw as SettlementRecord));
const erp = new Map(recs.map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, r]));

console.log(`   시트 ${sheet.size}줄 · ERP ${erp.size}줄`);

const onlySheet = [...sheet.keys()].filter((k) => !erp.has(k));
const onlyErp = [...erp.keys()].filter((k) => !sheet.has(k));

if (onlySheet.length) {
  console.log(`\n   ★시트에만 있다 ${onlySheet.length}줄 — 아직 ERP 로 안 옮겨졌다`);
  for (const k of onlySheet.slice(0, 12)) {
    const x = sheet.get(k)!;
    console.log(`      ${x.tab} ${x.row}행  ${k}  ${x.supplier || '공급사?'} ${x.customer || ''}`);
  }
  console.log('      → npx tsx scripts/migrate-settlement-to-erp.mts --apply 로 끌어온다');
}
if (onlyErp.length) {
  console.log(`\n   ERP 에만 있다 ${onlyErp.length}줄 — ERP 에서 접수한 것이면 정상이다`);
  for (const k of onlyErp.slice(0, 8)) console.log(`      ${k}  ${S(erp.get(k)!.supplier) || '공급사?'}`);
}

// ── 같은 줄인데 값이 다른가 ────────────────────────────────
const WATCH: (keyof SettlementRecord)[] = ['supplier', 'model', 'customer', 'channel', 'agent', 'rent', 'term', 'deposit', 'price', 'payKind', 'deliveredAt', 'paper', 'delivered', 'cancelled', 'clawback', 'clawbackAt', 'clawbackAmount'];
let diff = 0;
for (const [k, x] of sheet) {
  const e = erp.get(k);
  if (!e) continue;
  // ⚠ 값 비교는 «옮기는 도구»가 이미 한다. 여기서는 «있고 없고»만 본다 —
  //   둘을 다 하면 이 검사가 느려져서 사람이 안 돌린다.
  if (S(x.supplier) && S(e.supplier) && S(x.supplier) !== S(e.supplier)) {
    if (diff < 8) console.log(`      ${k} 공급사 — 시트 「${x.supplier}」 / ERP 「${e.supplier}」`);
    diff++;
  }
}
if (diff) console.log(`\n   같은 줄인데 공급사가 다르다 ${diff}건`);

const bad = onlySheet.length + diff;
console.log(bad
  ? `\n✕ ${bad}군데가 갈렸습니다. 청구서를 뽑기 전에 맞추세요.\n`
  : '\n○ 안 갈렸습니다.\n');
process.exit(bad ? 1 : 0);
