/**
 * **원장 네 탭에 칸을 하나 낸다.** 머리글만 만든다 — 값은 사람이나 기계가 채운다.
 *
 * ★칸을 늘릴 일이 계속 생긴다(영업자코드·영업자연락처·납입회차…).
 *   그때마다 스크립트를 새로 짜면 «어떻게 냈는지»가 매번 달라진다. 내는 방법은 하나여야 한다.
 * ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다.
 * ⚠ 이미 있으면 건드리지 않는다. 두 번 돌려도 안전하다.
 *
 *   npx tsx scripts/add-ledger-column.mts 납입회차
 *   npx tsx scripts/add-ledger-column.mts 납입회차 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { LEDGER_TABS } from '../lib/server/settlement-ledger-read';

const NAME = (process.argv[2] || '').trim();
const APPLY = process.argv.includes('--apply');
if (!NAME || NAME.startsWith('--')) {
  console.log('칸 이름을 주세요 — npx tsx scripts/add-ledger-column.mts 납입회차 [--apply]');
  process.exit(1);
}

const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const colA1 = (i: number) => {
  let t = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init?.headers || {}) } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : {};
};

const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`);
const sheetIdOf = new Map<string, number>(
  (meta.sheets as { properties: { title: string; sheetId: number } }[]).map((s) => [s.properties.title, s.properties.sheetId]),
);

const plan: { tab: string; sheetId: number; at: number; row: number }[] = [];
for (const tab of LEDGER_TABS) {
  const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ5`)}`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ⚠ ${tab} — 머리글을 못 찾았다`); continue; }
  const head = all[hi];
  if (head.includes(NAME)) { console.log(`   · ${tab} — 「${NAME}」 이미 있다 (${colA1(head.indexOf(NAME))}열)`); continue; }
  plan.push({ tab, sheetId: sheetIdOf.get(tab)!, at: head.length, row: hi + 1 });
  console.log(`   + ${tab} — ${colA1(head.length)}열에 「${NAME}」 을 낸다`);
}

if (!plan.length) { console.log('\n   할 일이 없다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n   아무것도 안 썼다. 내려면 --apply\n'); process.exit(0); }

await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: plan.map((p) => ({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: 1 } })),
  }),
});
await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values:batchUpdate`, {
  method: 'POST',
  // ★RAW — 칸 이름을 구글이 해석하게 두지 않는다.
  body: JSON.stringify({
    valueInputOption: 'RAW',
    data: plan.map((p) => ({ range: `${a1(p.tab)}!${colA1(p.at)}${p.row}`, values: [[NAME]] })),
  }),
});
console.log(`\n■ 「${NAME}」 칸을 ${plan.length}개 탭에 냈다.\n`);
