/**
 * **판매시트 열 차례가 못 박은 자리와 같은가** — 갈리면 실패한다.
 *
 * ★사장님 2026-08-24 「이건 고정이고 이 뒤로 정제칸 정보까지는 고정으로 해둬야 해」
 *
 * 세 가지를 본다 —
 *   ① 앞 25칸이 사장님이 글자 그대로 지정한 차례인가
 *   ② 코드(`SALES_COLUMNS`)가 못 박은 차례(`SALES_COLUMN_ORDER`)와 같은가
 *   ③ **정본인 시트 「AI 인계」 @매핑 표**가 같은 차례인가
 *
 *   npm run check:columns
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { SALES_COLUMNS, parsePublishedSalesMapping } from '../lib/domain/sales-sheet-mapping';
import { SALES_COLUMN_ORDER, SALES_HEAD_FIXED, SALES_SECTIONS } from '../lib/domain/sales-column-order';

const S = (v: unknown) => String(v ?? '').trim();
let bad = 0;

/** 두 차례를 견주어 «처음 갈린 자리»를 말한다 — 다 늘어놓으면 어디가 문제인지 안 보인다. */
const compare = (label: string, got: readonly string[], want: readonly string[]) => {
  const n = Math.max(got.length, want.length);
  const off: string[] = [];
  for (let i = 0; i < n; i++) if (got[i] !== want[i]) off.push(`${String(i + 1).padStart(2)}번째 — 있는 것 「${got[i] ?? '(없음)'}」 · 있어야 할 것 「${want[i] ?? '(없음)'}」`);
  if (off.length) { bad++; console.log(`  ✗ ${label} — ${off.length}자리 어긋남`); off.slice(0, 6).forEach((m) => console.log(`       ${m}`)); }
  else console.log(`  ✓ ${label} — ${want.length}칸 그대로`);
};

console.log('■ 판매시트 열 차례\n');
compare('사장님 지정 앞자리', SALES_COLUMNS.slice(0, SALES_HEAD_FIXED.length), SALES_HEAD_FIXED);
compare('코드 전체 차례', SALES_COLUMNS, SALES_COLUMN_ORDER);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const tok = (await jwt.getAccessToken()).token;
const v = await (await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}/values/${encodeURIComponent("'AI 인계'!A1:C400")}`,
  { headers: { Authorization: `Bearer ${tok}` } },
)).json() as { values?: string[][] };
const sheet = parsePublishedSalesMapping((v.values || []) as string[][]).columns;
compare('시트 @매핑(정본)', sheet, SALES_COLUMN_ORDER);

console.log('\n■ 묶음');
console.log(`  고정 앞자리                    ${SALES_HEAD_FIXED.length}칸`);
for (const s of SALES_SECTIONS) console.log(`  ${s.title.padEnd(28)} ${String(s.columns.length).padStart(2)}칸  ${s.columns.join(' · ')}`);

console.log(bad ? '\n  ✗ 차례가 갈렸다 — lib/domain/sales-column-order.ts 와 시트 「AI 인계」 @매핑을 같이 맞춰라' : '\n  ✓ 코드와 시트가 같은 차례다');
process.exit(bad ? 1 : 0);
