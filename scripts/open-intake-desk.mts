/**
 * **접수 입구를 하나로 — 원장 「접수」 탭에 편집 권한을 주고, 옛 접수 시트를 막는다.** 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「접수 ← 여기서 접수를 하고 한줄한줄을 옮겨가는거로 하자」.
 *   입구가 둘이면 «어느 쪽이 맞는지» 아무도 모른다. 원장 접수 탭 하나로 모은다.
 *
 * ★**원장을 편집 권한으로 열어도 안전하다** — `build-settlement-tabs` 가 접수 탭의
 *   기계 칸과 나머지 탭 전부를 «보호 범위»로 잠갔다. 팀장은 연노랑 칸만 적을 수 있다.
 * ★**알림 메일은 안 보낸다**(`sendNotificationEmail=false`) — 검토 안 한 글이
 *   소유자 이름으로 나가면 안 된다. 링크는 사람이 직접 전한다.
 *
 * ★옛 「프리패스 당월 계약접수」 시트는 **지우지 않고 막는다** — 이름 앞에 「[구버전·폐기]」를 붙이고
 *   첫 탭에 «여기 적지 마세요» 안내를 넣는다. 지금 0줄이라 옮길 값은 없다.
 *
 *   npx tsx scripts/open-intake-desk.mts
 *   npx tsx scripts/open-intake-desk.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER, INTAKE_SHEET_NAME } from '../lib/domain/settlement-ledger';

/** 접수를 적는 사람. 늘어나면 여기에 더한다. */
const EDITORS = ['kjs@teamjpk.com'];
const RETIRE_MARK = '[구버전·폐기]';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(6_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

console.log(`\n■ 접수 입구 하나로 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

// ── ① 원장 편집 권한 ────────────────────────────────────────────────
const perms = ((await call(`https://www.googleapis.com/drive/v3/files/${LEDGER}/permissions?fields=permissions(id,type,role,emailAddress,domain)&supportsAllDrives=true`)).permissions || []) as any[];
console.log('   지금 원장 권한');
for (const p of perms) console.log(`      ${S(p.type).padEnd(7)} ${S(p.role).padEnd(7)} ${S(p.emailAddress) || S(p.domain)}`);
const need = EDITORS.filter((e) => !perms.some((p) => S(p.emailAddress).toLowerCase() === e.toLowerCase() && ['writer', 'owner'].includes(S(p.role))));
console.log(`   줄 편집 권한 — ${need.length ? need.join(' · ') : '(이미 다 있다)'}`);

// ── ② 옛 접수 시트 막기 ──────────────────────────────────────────────
const q = `name contains '${INTAKE_SHEET_NAME}' and trashed=false`;
const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as any[];
const olds: { id: string; name: string; rows: number }[] = [];
for (const f of files) {
  if (S(f.name).startsWith(RETIRE_MARK)) continue;
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets.properties(title)`);
  const tab = ((meta.sheets || []) as any[]).map((x) => S(x.properties.title))[0];
  const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${a1(tab)}!A1:C500`)}`);
  const rows = ((got.values || []) as any[][]).slice(1).filter((r) => (r || []).some(Boolean)).length;
  olds.push({ id: S(f.id), name: S(f.name), rows });
}
console.log(`\n   막을 옛 시트 ${olds.length}`);
for (const o of olds) console.log(`      「${o.name}」 ${o.rows}줄${o.rows ? '  ⚠ 값이 있다 — 먼저 원장으로 옮겨야 한다' : ''}`);
const risky = olds.filter((o) => o.rows > 0);

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }
if (risky.length) { console.log('\n⛔ 값이 든 옛 시트가 있다. 옮기기 전에는 안 막는다.\n'); process.exit(1); }

for (const e of need) {
  // ★알림 메일은 안 보낸다 — 검토 안 한 글이 소유자 이름으로 나가면 안 된다.
  await call(`https://www.googleapis.com/drive/v3/files/${LEDGER}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
    method: 'POST', body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: e }),
  });
  console.log(`   ✓ ${e} 편집 권한`);
}

for (const o of olds) {
  await call(`https://www.googleapis.com/drive/v3/files/${o.id}?supportsAllDrives=true`, {
    method: 'PATCH', body: JSON.stringify({ name: `${RETIRE_MARK} ${o.name}` }),
  });
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${o.id}?fields=sheets.properties(sheetId,title,index)`);
  const props = ((meta.sheets || []) as any[]).map((x) => x.properties);
  const NOTE = '⚠ 안 씁니다';
  let gid = props.find((x: any) => S(x.title) === NOTE)?.sheetId;
  if (gid === undefined) {
    const made = await call(`https://sheets.googleapis.com/v4/spreadsheets/${o.id}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: NOTE, index: 0, gridProperties: { rowCount: 20, columnCount: 3 } } } }] }),
    });
    gid = made.replies[0].addSheet.properties.sheetId;
  }
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${o.id}/values/${encodeURIComponent(`${a1(NOTE)}!A1:B8`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [
      ['이 시트는 안 씁니다', ''],
      ['', ''],
      ['어디에 적나요', '정산원장의 「접수」 탭에 적습니다.'],
      ['', `https://docs.google.com/spreadsheets/d/${LEDGER}/edit`],
      ['', ''],
      ['왜 옮겼나요', '입구가 둘이면 어느 쪽이 맞는지 아무도 모릅니다. 원장 한 곳으로 모았습니다.'],
      ['', '원장에서는 연노랑 칸만 적으면 되고, 나머지는 잠겨 있어 실수로 못 건드립니다.'],
      ['언제', '2026-08-25'],
    ] }),
  });
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${o.id}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [
      { updateSheetProperties: { properties: { sheetId: gid, index: 0, tabColor: { red: 0.85, green: 0.2, blue: 0.2 } }, fields: 'index,tabColor' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 620 }, fields: 'pixelSize' } },
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: 'userEnteredFormat.textFormat' } },
    ] }),
  });
  console.log(`   ✓ 「${o.name}」 막았다`);
}
console.log(`\n■ 끝 — 접수는 원장 한 곳에서만\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
