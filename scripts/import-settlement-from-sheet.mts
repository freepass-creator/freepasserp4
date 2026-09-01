/**
 * **시트에 적힌 정산을 파이어베이스로 «올린다».** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-28 「지금 직원들이 시트에 입력하고 있잖아 · 이걸 써도 무방하고 이걸써서
 *   정산서도 뽑을수 잇겟지만 **파이어베이스에 올려서 처리하는걸 만들어야해**」.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**`migrate-settlement-to-erp` 와 다른 도구다. 헷갈리면 값이 지워진다.**
 * ```
 * migrate  한 번 옮기기   ERP 전체를 시트 값으로 «통째로» 덮는다(update)
 *                        → 그날 ERP 에서 고친 것이 조용히 사라진다
 * import   상시 올리기    새 줄만 올리고, 이미 있는 줄은 «다르다»고 보여만 준다
 * ```
 *   시트는 이제 «입력 창구»고 정본은 파이어베이스다. 창구에서 들어온 것을 정본에 얹는 일이지,
 *   창구가 정본을 다시 쓰는 일이 아니다.
 *
 * ★★**세 갈래로 가른다.**
 * ```
 * 새 줄        시트에 있고 ERP 에 없다        → 올린다
 * 다른 칸      양쪽에 있는데 값이 다르다      → 보여만 준다. --overwrite 라야 덮는다
 * ERP 에만     ERP 에서 접수한 줄이다         → ★건드리지 않는다
 * ```
 *
 * ★★★**ERP 에서 사람이 고친 칸은 `--overwrite` 여도 안 덮는다.**
 *   `v4/settlement_events` 에 그 칸을 고친 이력이 있으면 «충돌»로 남긴다.
 *   시트가 창구라고 해서, 담당자가 ERP 에서 고친 값을 뒤늦게 시트가 되돌려서는 안 된다 —
 *   그러면 아무도 ERP 에서 안 고친다. 충돌은 사람이 보고 정한다.
 *
 * ⚠ **원자만 올린다.** 자리(탭)·청구월·청구액은 안 올린다 — 인도일·회차·요율로 계산된다.
 * ⚠ **시트를 지우지 않는다.** 되돌릴 곳으로 남긴다.
 * ⚠ 쓴 뒤 **되읽어 대조한다** — 쓰기 성공 응답과 «값이 맞다»는 다른 말이다.
 *
 * ⚠ **쌍둥이가 있다 — `lib/server/settlement-sheet-import.ts`**(화면 단추가 그걸 쓴다).
 *   규칙(세 갈래·이력 잠금·빈칸은 안 지움·되읽기)은 반드시 같이 고친다.
 *
 *   npx tsx scripts/import-settlement-from-sheet.mts                  무엇이 올라갈지만 본다
 *   npx tsx scripts/import-settlement-from-sheet.mts --apply          새 줄만 올린다
 *   npx tsx scripts/import-settlement-from-sheet.mts --apply --overwrite   다른 칸도 시트 값으로
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { recordFromSheet, normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';

const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const NODE = 'v4/settlement_rows';
const EVENTS = 'v4/settlement_events';
const TABS = ['접수', '취소', '분납실적', '완납실적'];
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** 견줄 칸 — 원자만. 코드·시각·출처는 «어디서 왔나»라 견주지 않는다. */
const SKIP = new Set(['code', 'createdAt', 'updatedAt', 'fromSheet']);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
/**
 * ★**502·503 은 구글 쪽 일시 오류다** — 세 번까지 다시 물어본다(늘어나는 간격).
 *   2026-09-01 에 「완납실적」이 502 로 한 번 빠졌다. 여기서 그냥 던지면 탭 넷 중 셋만 읽고
 *   멈추는데, 그건 «올리다 만» 것이 아니라 «읽다 만» 것이라 다시 돌리면 그만이다.
 *   ⚠ 다시 물어봐도 안 되면 «던진다». 빈 배열로 돌려주면 그 탭 줄이 통째로 「시트에 없는 줄」이
 *     되어, `--overwrite` 로 돌릴 때 멀쩡한 ERP 줄을 못 알아본다.
 */
const sheet = async (range: string) => {
  for (let tryN = 1; ; tryN += 1) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return ((JSON.parse(x).values || []) as unknown[][]).map((v) => (v || []).map(S));
    if ((r.status < 500 && r.status !== 429) || tryN >= 3) throw new Error(`${r.status} ${x.slice(0, 200)}`);
    console.log(`   … ${range} ${r.status} — 다시 물어봅니다 (${tryN}/3)`);
    await new Promise((ok) => setTimeout(ok, tryN * 1500));
  }
};

console.log(`\n■ 시트 → 파이어베이스 올리기 ${APPLY ? (OVERWRITE ? '(반영 · 다른 칸도 덮음)' : '(반영 · 새 줄만)') : '(대조만)'}\n`);

// ── ① ERP 가 지금 들고 있는 것 ─────────────────────────────
const have = ((await db.ref(NODE).get().catch(() => null))?.val() || {}) as Record<string, SettlementRecord>;
const codeOf = new Map(Object.values(have).map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, S(r.code)]));
console.log(`   ERP ${Object.keys(have).length}줄`);

/**
 * ERP 에서 «사람이 고친 칸» — 이력에서 읽는다.
 * ⚠ 이력 키는 `차번|접수일`(RTDB 금지문자 치환)이다 — 코드가 아니다(`settlement-store.eventKey`).
 */
const eventsAll = ((await db.ref(EVENTS).get().catch(() => null))?.val() || {}) as Record<string, Record<string, { field?: string }>>;
const touched = new Map<string, Set<string>>();
for (const [k, byPush] of Object.entries(eventsAll)) {
  const set = new Set<string>();
  for (const e of Object.values(byPush || {})) if (S(e?.field)) set.add(S(e.field));
  if (set.size) touched.set(k, set);
}
const eventKey = (plate: string, receivedAt: string) => `${plate}|${receivedAt}`.replace(/[.$#[\]/\s]/g, '_');

// ── ② 시트에서 읽어 원자로 ─────────────────────────────────
const made: Record<string, SettlementRecord> = {};
let read = 0;
for (const tab of TABS) {
  const all = await sheet(`${a1(tab)}!A1:BZ3000`);
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ✕ 「${tab}」 머리글 못 찾음 — 멈춘다(반쯤 올리지 않는다)`); process.exit(1); }
  const head = all[hi];
  let n = 0;
  for (const row of all.slice(hi + 1)) {
    const cell = (name: string) => { const i = head.indexOf(name); return i >= 0 ? S(row[i]) : ''; };
    if (!cell('차량번호')) continue;
    read++; n++;
    const rec = recordFromSheet(cell, { fromSheet: tab });
    const kept = codeOf.get(`${rec.plate}|${rec.receivedAt}`);
    made[kept || rec.code] = normalizeRecord({ ...rec, code: kept || rec.code });
  }
  console.log(`   ${tab.padEnd(6)} ${n}줄`);
}
console.log(`   시트 ${read}줄`);

// ── ③ 세 갈래로 가른다 ─────────────────────────────────────
type Diff = { plate: string; field: string; sheet: string; erp: string; locked: boolean };
const fresh: SettlementRecord[] = [];
const diffs: Diff[] = [];
for (const [code, want] of Object.entries(made)) {
  const got = have[code];
  if (!got) { fresh.push(want); continue; }
  const lockedFields = touched.get(eventKey(S(want.plate), S(want.receivedAt))) || new Set<string>();
  for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
    if (SKIP.has(k as string)) continue;
    const a = S(want[k]); const b = S(got[k]);
    if (a === b) continue;
    // ★시트가 «빈칸»인 것은 «지우라»는 뜻이 아니다. 창구는 아직 안 적었을 수 있다.
    if (!a) continue;
    diffs.push({ plate: S(want.plate), field: k as string, sheet: a, erp: b, locked: lockedFields.size > 0 });
  }
}
const onlyErp = Object.keys(have).filter((c) => !made[c]).length;

console.log(`\n   새 줄 ${fresh.length} · 다른 칸 ${diffs.length} · ERP 에만 ${onlyErp}줄(그대로 둔다)`);
if (fresh.length) {
  console.log('\n■ 올릴 새 줄');
  for (const r of fresh.slice(0, 20)) console.log(`   ${S(r.plate).padEnd(12)} ${S(r.receivedAt)} ${S(r.supplier).padEnd(10)} ${S(r.channel)}`);
  if (fresh.length > 20) console.log(`   … 외 ${fresh.length - 20}줄`);
}
if (diffs.length) {
  const locked = diffs.filter((d) => d.locked);
  console.log(`\n■ 값이 다른 칸 ${diffs.length} — 그중 ERP 에서 고친 이력이 있는 줄 ${locked.length}`);
  for (const d of diffs.slice(0, 20)) {
    console.log(`   ${d.plate.padEnd(12)} ${d.field.padEnd(14)} 시트「${d.sheet.slice(0, 18)}」 ERP「${d.erp.slice(0, 18)}」${d.locked ? '  ⛔ ERP 에서 고친 줄' : ''}`);
  }
  if (diffs.length > 20) console.log(`   … 외 ${diffs.length - 20}칸`);
}

if (!APPLY) {
  console.log('\n   --apply 를 붙이면 «새 줄»을 올립니다. 다른 칸까지 덮으려면 --apply --overwrite.\n');
  process.exit(0);
}

// ── ④ 쓴다 ────────────────────────────────────────────────
const patch: Record<string, SettlementRecord> = {};
for (const r of fresh) patch[r.code] = r;
let overwritten = 0; let refused = 0;
if (OVERWRITE) {
  for (const [code, want] of Object.entries(made)) {
    const got = have[code];
    if (!got) continue;
    const lockedFields = touched.get(eventKey(S(want.plate), S(want.receivedAt))) || new Set<string>();
    // ★먼저 «덮을 것이 있나»부터 센다. 잠긴 줄이라도 바뀔 칸이 없으면 비켜 간 게 아니다 —
    //   그냥 같은 줄이다. 이걸 refused 로 세면 「10줄을 못 덮었다」가 실제로는 0줄이면서
    //   사람이 시트를 뒤지게 만든다(코덱스 오더 2026-08-28 ④).
    const next: Record<string, unknown> = { ...got };
    let changed = false;
    for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
      if (SKIP.has(k as string)) continue;
      const a = S(want[k]);
      if (!a || a === S(got[k])) continue;
      next[k as string] = want[k]; changed = true;
    }
    if (!changed) continue;
    // ★ERP 에서 고친 줄은 통째로 비켜 간다 — 어느 칸을 고쳤는지 이력 이름과 원자 이름이
    //   1:1 이 아니라(이력은 시트 열 이름으로 남는다), 칸 단위로 가리려다 틀리느니 줄을 비킨다.
    if (lockedFields.size) { refused += 1; continue; }
    patch[code] = normalizeRecord({ ...(next as Partial<SettlementRecord>), code, updatedAt: Date.now() }); overwritten += 1;
  }
}
if (!Object.keys(patch).length) { console.log('\n   올릴 것이 없습니다.\n'); process.exit(0); }
await db.ref(NODE).update(patch);
console.log(`\n   ✓ ${Object.keys(patch).length}줄 반영 — 새 줄 ${fresh.length}${OVERWRITE ? ` · 덮음 ${overwritten} · ERP 에서 고친 줄이라 비켜감 ${refused}` : ''}`);

// ── ⑤ 되읽어 대조 ─────────────────────────────────────────
const back = ((await db.ref(NODE).get()).val() || {}) as Record<string, SettlementRecord>;
const bad: string[] = [];
for (const [code, want] of Object.entries(patch)) {
  const got = back[code];
  if (!got) { bad.push(`${want.plate} — 안 올라갔다`); continue; }
  for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
    if (SKIP.has(k as string)) continue;
    if (S(want[k]) !== S(got[k])) bad.push(`${want.plate} ${k as string} — 넣은 값 「${S(want[k])}」 · 읽은 값 「${S(got[k])}」`);
  }
}
if (bad.length) {
  console.log(`\n   ✕ 되읽기 대조 어긋남 ${bad.length}건`);
  for (const b of bad.slice(0, 10)) console.log(`      ${b}`);
  process.exit(1);
}
console.log('   ✓ 되읽어 대조 — 넣은 값 그대로입니다.\n');
process.exit(0);
