/**
 * **정산원장에서 접수년·접수월 칸을 걷어낸다.** 접수일 한 칸만 남긴다.
 *
 * ★사장님 2026-08-26 「어차피 AI 쓸건데 그냥 접수년 접수월 뺄까?? 접수일만 둘까??」
 *   「ERP화 했을때도 할거고 괜히 입력칸만 늘리는거 같아서」 「접수일만 적는거로」.
 *
 * ★★**근거(실측 2026-08-26)**
 * ```
 * 원자 사전       접수년·접수월은 이미 「파생 · 기계가 채움」 — 사람이 적는 칸이 아니었다
 * 보호범위 예외   접수 탭은 A·D·U·AA·F~R — 사람은 B·C 에 «적을 수도» 없었다
 * 정보 손실       431줄 중 0건 — 접수일이 없는 2줄은 접수년·접수월도 비어 있다
 * 쓰던 곳        전부 「접수일이 없을 때 대비책」인데, 그 대비책이 작동한 적이 없다
 * 좌표 수식       A·B·C 를 짚는 수식 0개 (15개 탭 전수)
 * ```
 * ⚠ **청구년·청구월은 건드리지 않는다.** 청구는 「청구일」 칸 자체가 없어 그 둘이 원자다.
 *
 * ★★★**지우기 전에 값을 통째로 파일로 뜬다.** 칸 삭제는 되돌리기 어렵다 —
 *   시트 실행취소는 우리 손이 아니라 사람 브라우저에 있다.
 *
 *   npx tsx scripts/drop-received-ym.mts            무엇을 지울지만 본다
 *   npx tsx scripts/drop-received-ym.mts --apply    실제로 지운다
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const TABS = ['접수', '취소', '분납실적', '완납실적'];
/** ⚠ 이 둘만 지운다. 청구년·청구월은 원자라 남긴다. */
const DROP = ['접수년', '접수월'];

const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const colA1 = (i: number) => { let t = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const get = async (u: string) => {
  const r = await fetch(u, { headers: { Authorization: `Bearer ${await tok()}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return JSON.parse(x);
};

console.log(`\n■ 접수년·접수월 걷어내기 ${APPLY ? '— 실제로 지웁니다' : '(무엇을 지울지만 봅니다)'}\n`);

// ── ① 시트 구조 ────────────────────────────────────────────
const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=${encodeURIComponent('sheets.properties.title,sheets.properties.sheetId')}`) as
  { sheets: { properties: { title: string; sheetId: number } }[] };
const idOf = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

// ── ② 값 통째로 백업 ───────────────────────────────────────
const snap: Record<string, unknown[][]> = {};
const plan: { tab: string; sheetId: number; start: number; end: number; head: string[] }[] = [];

for (const tab of TABS) {
  const g = await get(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
  const all = (g.values || []) as unknown[][];
  snap[tab] = all;

  const rows = all.map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`  ${tab.padEnd(6)} 머리글을 못 찾음 — 건너뜀`); continue; }
  const head = rows[hi];
  const idx = DROP.map((n) => head.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) { console.log(`  ${tab.padEnd(6)} 지울 칸 없음 (이미 걷어냄)`); continue; }

  // ★붙어 있는지 확인 — 떨어져 있으면 한 번에 못 지운다(자리가 밀린다)
  const contiguous = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  if (!contiguous) throw new Error(`${tab} — 지울 칸이 떨어져 있습니다 ${idx.map(colA1).join(',')}. 손으로 확인하세요`);

  const filled = idx.map((i) => rows.slice(hi + 1).filter((r) => S(r[i])).length);
  console.log(`  ${tab.padEnd(6)} ${idx.map((i, k) => `${colA1(i)}:${head[i]}(값 ${filled[k]}개)`).join(' · ')}  →  삭제`);
  plan.push({ tab, sheetId: idOf.get(tab)!, start: idx[0], end: idx[idx.length - 1] + 1, head });
}

mkdirSync('tmp', { recursive: true });
const backup = `tmp/원장-백업-접수년월삭제전.json`;
writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), ledger: LEDGER, tabs: snap }, null, 1), 'utf8');
console.log(`\n  값 백업 → ${backup}`);

// ── ③ 지운 뒤에도 접수일이 살아 있나 ─────────────────────────
let lost = 0;
for (const tab of TABS) {
  const rows = (snap[tab] || []).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = rows[hi];
  const iD = h.indexOf('접수일'); const iY = h.indexOf('접수년'); const iM = h.indexOf('접수월');
  for (const r of rows.slice(hi + 1)) {
    if (!S(r[h.indexOf('차량번호')])) continue;
    // ★접수일이 비었는데 년·월만 있는 줄 = 지우면 «정보를 잃는» 줄
    if (!S(r[iD]) && (S(r[iY]) || S(r[iM]))) lost++;
  }
}
console.log(`  지우면 정보를 잃는 줄 ${lost}건`);
if (lost > 0) {
  console.log('\n  ✕ 접수일 없이 년·월만 있는 줄이 있습니다. 먼저 접수일을 채우세요.\n');
  process.exit(1);
}

if (!APPLY) {
  console.log('\n  --apply 를 붙이면 실제로 지웁니다.\n');
  process.exit(0);
}

// ── ④ 삭제 ────────────────────────────────────────────────
// ⚠ 한 요청에 여러 탭을 넣어도 탭끼리는 서로 자리를 안 민다(탭별 dimension).
const requests = plan.map((p) => ({
  deleteDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: p.start, endIndex: p.end } },
}));
const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests }),
});
const out = await res.text();
if (!res.ok) { console.log(`\n  ✕ 실패 ${res.status} — ${out.slice(0, 400)}\n`); process.exit(1); }

// ── ⑤ 확인 ────────────────────────────────────────────────
console.log('\n  지웠습니다. 다시 읽어 확인합니다.');
for (const tab of TABS) {
  const g = await get(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:F3`)}?valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
  const rows = (g.values || []).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  const head = hi >= 0 ? rows[hi] : rows[0] || [];
  console.log(`  ${tab.padEnd(6)} ${head.slice(0, 5).map((v, i) => `${colA1(i)}:${v}`).join('  ')}`);
}
console.log(`\n  ★되돌리려면 ${backup} 의 값으로 채워 넣습니다.\n`);
