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
import { appendFileSync, readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const CODE = arg('code');
const TO = arg('to');
const HUB = arg('hub', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
/**
 * ★**여러 곳을 한 번에** — `--pairs=RP021:<시트ID>,RP010:<시트ID>`.
 *   한 곳씩 치면 반드시 하나를 빠뜨리고, 빠뜨린 곳은 «옛 시트를 계속 읽는» 채로 남는다.
 *   화면에도 표시가 없어 아무도 모른다.
 * ★**되돌릴 주소를 파일에 적는다**(`--log=`, 기본 `tmp/hub-switch-log.txt`).
 *   화면에만 찍으면 창을 닫는 순간 되돌릴 길이 없어진다. 여기가 유일한 복구 경로다.
 */
const PAIRS = arg('pairs').split(',').map(S).filter(Boolean)
  .map((x) => { const [c, id] = x.split(':').map(S); return { code: c, to: id }; })
  .filter((x) => x.code && x.to);
const JOBS = PAIRS.length ? PAIRS : (CODE && TO ? [{ code: CODE, to: TO }] : []);
const LOG = arg('log', 'tmp/hub-switch-log.txt');
if (!JOBS.length) throw new Error('--code=RP0xx --to=<시트ID> 또는 --pairs=CODE:ID,CODE:ID 가 필요하다');

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

let changed = 0, same = 0;
for (const job of JOBS) {
  const at = rows.findIndex((r) => r.some((c) => S(c) === job.code));
  if (at < 0) { console.log(`  ✗ ${job.code} — 문패 「${tab}」 에서 줄을 못 찾았다`); continue; }
  const row = rows[at];
  const ui = row.findIndex((c) => S(c).includes('spreadsheets'));
  if (ui < 0) { console.log(`  ✗ ${job.code} — 줄에 시트 주소 칸이 없다`); continue; }
  const before = S(row[ui]);
  const after = `https://docs.google.com/spreadsheets/d/${job.to}/edit`;

  console.log(`
  ${row.slice(0, 2).map(S).join(' · ')}  (${at + 1}행)`);
  console.log(`     지금   ${before}`);
  console.log(`     바꿀 것 ${after}`);
  if (before.includes(job.to)) { console.log('     = 이미 그 주소다'); same++; continue; }
  if (!APPLY) { changed++; continue; }
  /** ⚠ **쓰기 전에 적는다.** 쓰고 나서 적으면 중간에 죽었을 때 되돌릴 주소가 없다. */
  appendFileSync(LOG, `${new Date().toISOString()}	${job.code}	${S(row[0])}	되돌릴주소	${before}
`, 'utf8');
  await call(`${SH}/${HUB}/values/${encodeURIComponent(`'${tab}'!${colA1(ui)}${at + 1}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[after]] }),
  });
  changed++;
}

if (!APPLY) { console.log(`
※ dry-run — 바꿀 곳 ${changed} · 이미 맞음 ${same}. 실제 반영은 --apply
`); process.exit(0); }
console.log(`
  바꿨다 ${changed}곳 · 이미 맞았던 곳 ${same}`);
console.log(`  ★되돌릴 주소는 ${LOG} 에 적어 뒀다.`);
console.log('  이어서 발행 dry-run 으로 그 공급사 대수를 확인하라 —');
console.log('  npx tsx scripts/publish-origin-tab.mts');
