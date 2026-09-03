/**
 * **영업채널 시트를 «미리» 세운다** — 공지사항 + 수수료표. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「ys모빌리티 영업채널 정산시트 하나 만들어주라 거기에 공지사항 만들어주고
 *   수수료표 만들어 주고」.
 *
 * ★**왜 따로 있나.** 달마다 도는 `publish-channel-settlement` 는 «정산줄이 있는 채널»만 만든다.
 *   아직 실적이 없는 채널은 그 손에 안 잡힌다 — 그런데 시트는 «일하기 전에» 있어야 한다.
 *   탭 규격은 둘이 같은 곳(`lib/server/channel-sheet-tabs`)을 본다.
 *
 * ⚠ 공유는 회사(teamjpk.com) + 대표 계정까지다. **채널에 주는 것은 사람이 확인하고 누른다.**
 *
 *   npx tsx scripts/setup-channel-sheet.mts YS모빌리티
 *   npx tsx scripts/setup-channel-sheet.mts YS모빌리티 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { channelSheetName, ensureNoticeTab, ensureGuideTab, ensureFeeTab } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const CH = S(process.argv.slice(2).find((a) => !a.startsWith('--')));
if (!CH) { console.log('\n  채널 이름을 주세요 — npx tsx scripts/setup-channel-sheet.mts YS모빌리티 [--apply]\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

const NAME = channelSheetName(CH);
console.log(`\n■ ${CH} — 「${NAME}」 ${APPLY ? '(반영)' : '(대조만)'}`);

/** ★찾을 때는 «코드를 뺀 몸통»으로 — 코드가 바뀌어도 두 벌이 생기지 않는다. */
const q = `name contains '${CH} 프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const found = (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  { headers: { Authorization: `Bearer ${await tok()}` } })).json()) as { files?: { id: string; name: string }[] }).files || [])
  .filter((f) => !/구버전|폐기|백업/.test(S(f.name)));

if (found.length > 1) { console.log(`\n  ✕ 같은 이름이 ${found.length}개입니다 — 사람이 정리해 주세요\n${found.map((f) => `     ${f.name}`).join('\n')}\n`); process.exit(1); }
if (found.length) console.log(`   ○ 이미 있습니다 — ${found[0].name}`);
else console.log('   + 새로 만듭니다');
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 만들었습니다. --apply 로 만듭니다.\n'); process.exit(0); }

let id = found[0]?.id || '';
if (!id) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: NAME, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }) });
  id = S((await r.json() as { spreadsheetId?: string }).spreadsheetId);
  for (const perm of [{ type: 'domain', domain: 'teamjpk.com', role: 'writer' },
    { type: 'user', emailAddress: 'jpkpyh@gmail.com', role: 'writer' }]) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(perm) });
  }
  console.log('   ✓ 만들었습니다 · 회사(teamjpk.com)와 대표 계정에 열었습니다');
}

/**
 * ★`--redo` — 뼈대 탭을 «다시 짓는다». 안내 글이 바뀌었을 때 쓴다.
 * ⚠⚠ 적어 둔 공지와 고쳐 둔 요율이 «날아간다». 그래서 기본이 아니고, 손으로 붙여야 돈다.
 */
const REDO = process.argv.includes('--redo');
/**
 * ⚠ **한 탭씩 걷고 «바로» 다시 짓는다.** 둘을 한꺼번에 걷으면 문서에 탭이 하나도 안 남는 순간이
 *   생겨 두 번째 삭제가 튕긴다 — 실측 2026-09-03, 「수수료」가 옛 판 그대로 남았다.
 */
async function redo(title: string) {
  if (!REDO) return;
  const m0 = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const hit = (m0.sheets || []).find((x) => x.properties.title === title);
  if (!hit || (m0.sheets || []).length < 2) return;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: hit.properties.sheetId } }] }) });
  console.log(`   ${r.ok ? '-' : '✕'} 「${title}」 ${r.ok ? '걷고 다시 짓습니다' : `못 걷었습니다 ${r.status}`}`);
}

await redo('공지사항');
console.log(`   ${await ensureNoticeTab(tok, id) ? '+ 「공지사항」 만듦 (공지·프로모션)' : '○ 「공지사항」 있음 — 손대지 않음'}`);
await redo('영업안내');
console.log(`   ${await ensureGuideTab(tok, id) ? '+ 「영업안내」 만듦 (절차·서류·양식·탁송비)' : '○ 「영업안내」 있음 — 손대지 않음'}`);
await redo('수수료');
console.log(`   ${await ensureFeeTab(tok, id) ? '+ 「수수료」 만듦 (지급 요율만)' : '○ 「수수료」 있음 — 손대지 않음'}`);

/** ★새 시트에 딸려 오는 빈 「시트1」은 값이 없을 때만 걷는다. */
const m = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string } }[] };
const blank = (m.sheets || []).find((s) => /^(시트1|Sheet1)$/.test(s.properties.title));
if (blank && (m.sheets || []).length > 1) {
  const v = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${blank.properties.title}'!A1:C3`)}`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { values?: unknown[][] };
  if (!(v.values || []).length) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: blank.properties.sheetId } }] }) });
  }
}

console.log(`\n   https://docs.google.com/spreadsheets/d/${id}\n`);
process.exit(0);
