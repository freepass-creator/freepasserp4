/**
 * **문패의 «그 공급사 시트 주소»를 바꾼다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「취지대로 가자」)
 *   자체시트를 쓰는 공급사는 우리 «규격화시트»를 거쳐 온다. 영업자 시트가 그걸 읽게 하려면
 *   문패의 주소를 규격화시트로 돌려야 한다. 그래야 공급사가 어떻게 적든 영업자·ERP 가
 *   받는 모양이 한 벌이 된다.
 *
 * ★**바꾸기 전 주소를 화면에 남긴다.** 되돌릴 길이 그것뿐이다.
 * ⚠ 문패는 둘이다 —
 *     1TVe… 「공급사시트정리」       판매시트 발행이 읽는다
 *     1cRn… 「프리패스 공급사시트 정리」 웹앱 /api/sheet/hub 가 읽어 ERP 로 간다
 *   기본은 발행용(1TVe)만 바꾼다. ERP 쪽은 유입 경로가 따로라 `--hub=` 로 지정해 따로 판단한다.
 * ⚠ 바꾼 뒤에는 반드시 발행 dry-run 으로 «그 공급사 대수»를 확인하라.
 *   빈 시트로 돌리면 그 공급사 재고가 통째로 사라진다.
 *
 *   npx tsx scripts/switch-hub-sheet-url.mts --code=RP004 --to=<시트ID>
 *   npx tsx scripts/switch-hub-sheet-url.mts --code=RP004 --to=<시트ID> --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const CODE = arg('code');
const TO = arg('to');
const HUB = arg('hub', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
if (!CODE || !TO) throw new Error('--code=RP0xx --to=<시트ID> 가 필요하다');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 250)}`);
  return t ? JSON.parse(t) : {};
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

const meta = await call(`${SH}/${HUB}?fields=properties.title,sheets.properties(title,hidden)`);
const tab = S(((meta.sheets || []) as Rec[]).find((s) => !s.properties.hidden)?.properties?.title);
const v = await call(`${SH}/${HUB}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z400`)}`) as { values?: string[][] };
const rows = (v.values || []) as string[][];

const at = rows.findIndex((r) => r.some((c) => S(c) === CODE));
if (at < 0) throw new Error(`문패 「${tab}」 에서 ${CODE} 줄을 못 찾았다`);
const row = rows[at];
const ui = row.findIndex((c) => S(c).includes('spreadsheets'));
if (ui < 0) throw new Error(`${CODE} 줄에 시트 주소 칸이 없다`);
const before = S(row[ui]);
const after = `https://docs.google.com/spreadsheets/d/${TO}/edit`;

console.log(`■ 문패 「${S(meta.properties?.title)}」 「${tab}」 ${at + 1}행\n`);
console.log(`  공급사   ${row.slice(0, 2).map(S).join(' · ')}`);
console.log(`  지금     ${before}`);
console.log(`  바꿀 것   ${after}`);
if (before.includes(TO)) { console.log('\n  이미 그 주소다.'); process.exit(0); }
console.log('\n  ★되돌리려면 위 「지금」 주소를 그대로 다시 넣으면 된다. 기록해 둘 것.');
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }
await call(`${SH}/${HUB}/values/${encodeURIComponent(`'${tab}'!${colA1(ui)}${at + 1}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[after]] }),
});
console.log('\n  바꿨다. 이어서 발행 dry-run 으로 그 공급사 대수를 확인하라 —');
console.log('  npx tsx scripts/publish-origin-tab.mts\n');
