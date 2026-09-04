/**
 * **거래처 시트(F02)의 「이메일」 칸을 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「우리 거래처관리 시트에 넣자 프리패스 f02시트 … 거기에 넣어두자」.
 *
 * ⚠ **이 시트는 다시 찍히면 덮인다.** 「시작」 탭이 그렇게 말한다 —
 *   손으로 지켜지는 칸은 오른쪽 셋(접촉일·통화 결과·다음 할 일)뿐이고,
 *   나머지는 `C:/dev/sheetops/partners-rebuild.mjs` 가 다시 찍는다.
 *   ⇒ 그래서 «지워지지 않는 정본»은 파이어베이스에 따로 둔다(`v4/settlement_contacts`).
 *     이 시트는 사람이 보라고 같이 적어 두는 사본이다.
 *
 *   npx tsx scripts/set-partner-email.mts
 *   npx tsx scripts/set-partner-email.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const ID = '1TpYMQh9yxMjww7OjxIkQIC79Uig4tKJamkFeTxjtr68';
const TAB = '공급사';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/** ★사람이 준 값만. 짐작해서 넣지 않는다 — 틀린 주소로 남의 정산서가 나간다. */
const MAIL: [RegExp, string][] = [
  [/아이언/, 'iron_rent7777@naver.com'],
  [/스타/, 'starskynet@nate.com'],
  [/리더스/, 'ldsrent@naver.com'],
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getAccessToken()).token;
const H = { Authorization: `Bearer ${tok}` };

const got = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${TAB}'!A1:R200`)}`, { headers: H })).json() as { values?: unknown[][] };
const g = (got.values || []).map((v) => (v || []).map(S));
const head = g[1] || [];
const iName = head.indexOf('업체명'); const iMail = head.indexOf('이메일');
if (iName < 0 || iMail < 0) { console.log('\n  ✕ 「업체명」·「이메일」 칸을 못 찾았습니다 — 시트 머리글이 바뀌었나요?\n'); process.exit(1); }
const col = (n: number) => (n < 26 ? '' : String.fromCharCode(64 + Math.floor(n / 26))) + String.fromCharCode(65 + (n % 26));

const hit: { row: number; name: string; old: string; mail: string }[] = [];
for (let i = 2; i < g.length; i++) {
  const name = g[i][iName] || '';
  if (!name) continue;
  const m = MAIL.find(([re]) => re.test(name));
  if (m) hit.push({ row: i + 1, name, old: g[i][iMail] || '', mail: m[1] });
}
console.log(`\n■ ${TAB} 탭 · 「이메일」 ${col(iMail)}열\n`);
for (const h of hit) console.log(`   ${String(h.row).padStart(3)}행  ${h.name.padEnd(20)} ${h.old ? `${h.old} → ` : ''}${h.mail}`);
if (!hit.length) { console.log('   (해당 업체 없음)'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 안 썼다. --apply 로 적는다.\n'); process.exit(0); }

const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values:batchUpdate`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW',
    data: hit.map((h) => ({ range: `'${TAB}'!${col(iMail)}${h.row}`, values: [[h.mail]] })) }),
});
console.log(r.ok ? `\n   ✓ ${hit.length}곳 적었습니다.` : `\n   ✕ ${r.status} ${(await r.text()).slice(0, 200)}`);
console.log('   ⚠ 이 시트는 다시 찍히면 덮입니다 — 지워지지 않는 정본은 v4/settlement_contacts 입니다.\n');
process.exit(0);
