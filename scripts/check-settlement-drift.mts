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

/**
 * **한 탭이라도 못 읽으면 «아무 말도 하지 않는다».**
 *
 * ⚠ 2026-09-01 에 이 검사가 「완납실적」을 502 로 못 읽고도 그냥 넘어가서(`continue`)
 *   시트를 105줄로 세고 「ERP 에만 있다 337줄」이라는 «허수»를 냈다.
 *   ★더 나쁜 쪽은 그 반대다 — 「접수」 탭이 빠지면 안 옮겨진 줄이 통째로 안 보여서
 *   **10줄이 갈렸는데도 「안 갈렸습니다」 초록이 뜬다.** 초록은 조용해서 아무도 다시 안 본다.
 *
 * ⇒ 못 읽은 탭이 하나라도 있으면 «갈렸나»를 판단하지 않고 그 자리에서 멈춘다.
 *   판단을 못 하는 것과 「안 갈렸다」는 완전히 다른 말이다.
 */
async function readTab(tab: string): Promise<string[][]> {
  // 502·503 은 구글 쪽 일시 오류다 — 세 번까지 다시 물어본다(늘어나는 간격).
  for (let tryN = 1; ; tryN += 1) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` } });
    if (r.ok) return (((await r.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
    const retriable = r.status >= 500 || r.status === 429;
    if (!retriable || tryN >= 3) {
      console.log(`\n   ✕ 「${tab}」 탭을 못 읽었습니다 (${r.status}, ${tryN}번 시도)`);
      console.log('   ★탭 하나가 비면 갈라짐을 «셀 수 없습니다». 「안 갈렸다」고 말하지 않습니다.');
      console.log('   → 잠시 뒤 다시 돌리세요. 계속 같으면 시트 권한·탭 이름을 봅니다.\n');
      process.exit(2);
    }
    console.log(`   … 「${tab}」 ${r.status} — 다시 물어봅니다 (${tryN}/3)`);
    await new Promise((ok) => setTimeout(ok, tryN * 1500));
  }
}

// ── 시트 ──────────────────────────────────────────────────
const sheet = new Map<string, { tab: string; row: number; supplier: string; customer: string }>();
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const all = await readTab(tab);
  const hi = all.findIndex((x) => x.includes('차량번호'));
  // ★머리글을 못 찾은 것도 «못 읽은» 것이다. 빈 탭으로 쳐서 넘어가면 그 탭 줄이 통째로 사라진다.
  if (hi < 0) {
    console.log(`\n   ✕ 「${tab}」 에서 머리글(차량번호) 줄을 못 찾았습니다.`);
    console.log('   ★자리가 아니라 이름으로 찾습니다 — 탭이 비었거나 머리글이 바뀐 것입니다.\n');
    process.exit(2);
  }
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
  console.log('      → npm run settlement:import -- --apply 로 «새 줄만» 끌어온다');
  console.log('      ⚠ migrate-settlement-to-erp 는 쓰지 마세요 — ERP 전체를 시트 값으로 덮습니다(ERP 수정분이 날아갑니다).');
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
