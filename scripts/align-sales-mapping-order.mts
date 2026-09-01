/**
 * **시트 「AI 인계」 @매핑 표를 못 박은 차례로 다시 세운다.** 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24 「이건 고정이고 이 뒤로 정제칸 정보까지는 고정으로 해둬야 해」
 *   「그 뒤로 놓아야 할 항목들을 좀 성격에 맞게끔 잘 정리해줘야 할 거 같어」
 *
 * ★**열 정본은 이 표다.** 코드(`sales-column-order.ts`)는 그 표가 지켜야 할 차례를 적어 둔 것이고,
 *   이 도구가 표를 그 차례로 되돌린다. 반영한 뒤 판매시트를 다시 발행해야 실제 표가 바뀐다.
 * ⚠ **줄 내용은 안 건드린다** — 차례만 바꾼다. B열(판매시트 열)·C열(공급사 칸 후보) 그대로 옮긴다.
 * ⚠ 못 박은 차례에 없는 줄은 «사람이 더한 것»으로 보고 맨 뒤에 그대로 남긴다. 지우지 않는다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { SALES_COLUMN_ORDER } from '../lib/domain/sales-column-order';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const api = async (u: string, init?: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json() as any;
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'AI 인계';

const got = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A1:C400`)}`) as { values?: string[][] };
const rows = ((got.values || []) as string[][]).map((r) => [S(r?.[0]), S(r?.[1]), S(r?.[2])]);
const at = rows.findIndex((r) => r[0] === '@매핑');
const end = rows.findIndex((r, i) => i > at && r[0] === '@매핑끝');
if (at < 0 || end < 0) throw new Error('@매핑 ~ @매핑끝 을 못 찾았다');

/** 표 몸통 = 표식 줄 사이. 머리줄(B열이 「판매시트 열」 같은 안내)은 그대로 둔다. */
const head = rows.slice(at + 1, end).filter((r) => !r[1] || /판매시트/.test(r[1]));
const body = rows.slice(at + 1, end).filter((r) => r[1] && !/판매시트/.test(r[1]));

const rank = new Map(SALES_COLUMN_ORDER.map((c, i) => [c, i]));
const known = body.filter((r) => rank.has(r[1])).sort((a, b) => rank.get(a[1])! - rank.get(b[1])!);
const extra = body.filter((r) => !rank.has(r[1]));
const next = [...head, ...known, ...extra];

const before = body.map((r) => r[1]);
const after = [...known, ...extra].map((r) => r[1]);
const moved = before.filter((c, i) => c !== after[i]);
console.log(`■ @매핑 ${body.length}줄 — 못 박은 차례 ${SALES_COLUMN_ORDER.length}칸\n`);
console.log(`  자리를 옮길 줄 ${moved.length}${moved.length ? ` — ${moved.join(' · ')}` : ''}`);
if (extra.length) console.log(`  차례에 없어 맨 뒤에 남기는 줄 ${extra.length} — ${extra.map((r) => r[1]).join(' · ')}`);
const missing = SALES_COLUMN_ORDER.filter((c) => !body.some((r) => r[1] === c));
if (missing.length) console.log(`  ⚠ 표에 아예 없는 칸 ${missing.length} — ${missing.join(' · ')}`);

if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)'); process.exit(0); }
if (next.length !== end - at - 1) throw new Error(`줄 수가 달라졌다 ${next.length} ≠ ${end - at - 1} — 멈춘다`);
await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A${at + 2}:C${end}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: next }),
});
console.log(`\n  ✓ @매핑을 다시 세웠다 — 이제 판매시트를 다시 발행해야 표가 바뀐다`);
