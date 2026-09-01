/**
 * **정산원장 431줄을 시트에서 ERP(파이어베이스)로 옮긴다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ★★★**이건 «첫 이사» 도구다. 평소에 쓰지 마라 — `npm run settlement:import` 를 쓴다.**
 *
 *   여기는 `db.ref(NODE).update(made)` 로 **ERP 전체를 시트 값으로 덮는다.**
 *   2026-08-26 에 «빈 ERP» 로 한 번 옮기려고 만든 것이라 덮어도 잃을 게 없었다.
 *   ⚠ 지금은 다르다 — ERP 에서 사람이 고친 줄이 있다(`v4/settlement_events`).
 *     지금 이걸 `--apply` 하면 **그 수정이 소리 없이 시트 값으로 되돌아간다.**
 *
 *   ```
 *   평소 (시트에 새로 적힌 줄만 올린다)   npm run settlement:import -- --apply
 *   ERP 를 통째로 시트로 되돌릴 때만       이 도구
 *   ```
 *   ★되돌릴 때조차 «되돌린다»고 사람이 말한 뒤에 쓴다. 갈라짐을 맞추는 일이 아니다.
 * ═══════════════════════════════════════════════════════════════════
 *
 * ★사장님 2026-08-26
 *   「구글시트를 대체할수 있게끔 만들어줘 / 시트를 연동하는게 아니라 우리가 erp에서 직접 관리하는거로」
 *   「시트는 나중에 한번 데이터 가져갈때만 쓰고 그 이후에는 파이어베이스에 기입해서 정산해야지」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**옮기는 것이 아니라 «대조하는 것»이 이 도구의 일이다.**
 *   값을 밀어 넣는 건 쉽다. 어려운 건 «틀리지 않았음»을 아는 것이다.
 *   그래서 쓰고 나서 **다시 읽어 시트와 한 줄씩 맞대고**, 금액 합계까지 센다.
 *   한 칸이라도 갈리면 **안 쓴다** — 반쯤 옮겨진 원장이 제일 나쁘다.
 *
 * ★★**옮기는 것은 «원자»뿐이다.** 자리(탭)·청구월·청구액은 안 옮긴다 —
 *   전부 인도일·회차·요율로 계산된다(`settlement-record.ts`). 담으면 계산값과 갈린다.
 *   ⇒ 시트의 탭 넷은 ERP 에서 사라진다. 탭은 «자리»였고 자리는 파생값이다.
 *
 * ★★**열쇠는 `stl_` 대체키다.** 차번+접수일은 사람이 고치면 바뀌지만 이건 안 바뀐다.
 *   ⚠ **두 번 돌려도 코드가 안 바뀌어야 한다.** 이미 있으면 그 코드를 그대로 쓴다 —
 *     다시 발급하면 같은 계약이 두 줄이 된다.
 *
 * ⚠ 저장은 `v4/settlement_rows` 한 곳. v3 노드는 건드리지 않는다.
 * ⚠ **시트를 지우지 않는다.** 되돌릴 곳을 남겨 둔다(사장님 권고 수용).
 *
 *   npx tsx scripts/migrate-settlement-to-erp.mts            옮길 것을 세고 대조만 한다
 *   npx tsx scripts/migrate-settlement-to-erp.mts --apply    실제로 옮긴다
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { recordFromSheet, normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';

const APPLY = process.argv.includes('--apply');
const NODE = 'v4/settlement_rows';
const TABS = ['접수', '취소', '분납실적', '완납실적'];
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheet = async (range: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return ((JSON.parse(x).values || []) as unknown[][]).map((v) => (v || []).map(S));
};

console.log(`\n■ 정산원장 → ERP ${APPLY ? '(반영)' : '(대조만)'}\n`);

// ── ① 이미 옮겨진 것 ───────────────────────────────────────
const haveSnap = await db.ref(NODE).get().catch(() => null);
const have = (haveSnap?.val() || {}) as Record<string, SettlementRecord>;
/** 차번+접수일 → 이미 발급된 코드. **두 번 돌려도 코드가 안 바뀌게.** */
const codeOf = new Map(Object.values(have).map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, S(r.code)]));
console.log(`   ERP 에 있던 것 ${Object.keys(have).length}줄`);

// ── ② 시트에서 읽어 원자로 ─────────────────────────────────
const made: Record<string, SettlementRecord> = {};
const dupes: string[] = [];
let read = 0;
for (const tab of TABS) {
  const all = await sheet(`${a1(tab)}!A1:BZ3000`);
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ✕ 「${tab}」 머리글 못 찾음`); continue; }
  const head = all[hi];
  let n = 0;
  for (const row of all.slice(hi + 1)) {
    const cell = (name: string) => { const i = head.indexOf(name); return i >= 0 ? S(row[i]) : ''; };
    if (!cell('차량번호')) continue;
    read++; n++;
    const rec = recordFromSheet(cell, { fromSheet: tab });
    const key = `${rec.plate}|${rec.receivedAt}`;
    // ★코드는 «있으면 그대로». 다시 발급하면 같은 계약이 두 줄이 된다.
    const kept = codeOf.get(key);
    const out = normalizeRecord({ ...rec, code: kept || rec.code });
    if (made[out.code]) dupes.push(`${key} — 코드 ${out.code} 가 겹친다`);
    made[out.code] = out;
  }
  console.log(`   ${tab.padEnd(6)} ${n}줄`);
}
console.log(`\n   시트에서 읽음 ${read}줄 → 원자 ${Object.keys(made).length}줄`);
if (dupes.length) {
  console.log(`\n   ✕ 코드가 겹친다 ${dupes.length}건 — 옮기면 줄이 사라진다`);
  for (const d of dupes.slice(0, 8)) console.log(`      ${d}`);
  process.exit(1);
}
if (read !== Object.keys(made).length) {
  console.log(`\n   ✕ 읽은 줄(${read})과 만든 줄(${Object.keys(made).length})이 다르다 — 차번+접수일이 겹치는 줄이 있다`);
  process.exit(1);
}

// ── ③ 안 옮기고도 볼 수 있는 것 — 빈칸·이상값 ────────────────
const gaps = {
  접수일없음: Object.values(made).filter((r) => !r.receivedAt).length,
  공급사없음: Object.values(made).filter((r) => !r.supplier).length,
  영업채널없음: Object.values(made).filter((r) => !r.channel).length,
  모델명없음: Object.values(made).filter((r) => !r.model).length,
  렌탈료0: Object.values(made).filter((r) => !r.rent).length,
};
console.log(`   빈칸 — ${Object.entries(gaps).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

if (!APPLY) {
  console.log(`\n   옮길 줄 ${Object.keys(made).length} (새로 ${Object.keys(made).filter((c) => !have[c]).length} · 이미 있던 ${Object.keys(made).filter((c) => have[c]).length})`);
  console.log('\n   --apply 를 붙이면 옮깁니다.\n');
  process.exit(0);
}

// ── ④ 쓴다 ────────────────────────────────────────────────
await db.ref(NODE).update(made);
console.log(`\n   ✓ ${NODE} 에 ${Object.keys(made).length}줄 반영`);

// ── ⑤ ★다시 읽어 대조한다 ─────────────────────────────────
/**
 * ★★**쓴 다음 «다시 읽어» 맞댄다.** 쓰기가 성공했다는 응답과 «값이 맞다»는 건 다른 말이다.
 *   RTDB 는 빈 배열·undefined 를 조용히 버린다 — 그래서 되읽어 확인해야 안다.
 */
const backSnap = await db.ref(NODE).get();
const back = (backSnap.val() || {}) as Record<string, SettlementRecord>;
const bad: string[] = [];
for (const [code, want] of Object.entries(made)) {
  const got = back[code];
  if (!got) { bad.push(`${want.plate} — ERP 에 없다`); continue; }
  for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
    const a = want[k]; const b = got[k];
    // ★false·0·'' 은 «없는 것»이 아니다. RTDB 가 버려도 읽을 때 되살아나게 normalizeRecord 를 거친다.
    if (String(a ?? '') !== String(b ?? '')) bad.push(`${want.plate} ${String(k)} — 시트 「${String(a)}」 / ERP 「${String(b)}」`);
  }
}
console.log(`\n■ 되읽어 대조 — 줄 ${Object.keys(made).length} · 어긋난 칸 ${bad.length}`);
for (const x of bad.slice(0, 12)) console.log(`   ${x}`);

// 금액 합계까지 맞대 본다
const sum = (rs: SettlementRecord[], k: 'claimWritten' | 'payWritten') => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const mine = Object.values(made); const theirs = Object.values(back).filter((r) => made[S(r.code)]);
console.log(`   적힌 판매수수료 — 시트 ${sum(mine, 'claimWritten').toLocaleString()} / ERP ${sum(theirs, 'claimWritten').toLocaleString()}`);
console.log(`   적힌 출고수수료 — 시트 ${sum(mine, 'payWritten').toLocaleString()} / ERP ${sum(theirs, 'payWritten').toLocaleString()}`);

console.log(bad.length ? '\n✕ 어긋난 칸이 있습니다. 시트를 지우지 마세요.\n' : '\n○ 한 칸도 안 갈렸습니다. 시트는 그대로 두고 되돌릴 곳으로 남깁니다.\n');
process.exit(bad.length ? 1 : 0);
