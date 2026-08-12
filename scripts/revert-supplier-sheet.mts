/**
 * **재고 정본을 공급사 옛 시트로 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 공급사가 아직 새 시트를 안 쓰는 동안 정본을 우리 시트로 두면, 그쪽이 오늘 고친 것이
 * ERP 에 영영 안 들어오고 재고가 어제 스냅샷에서 멈춘다(사장님 확인 2026-08-12).
 * 새 시트는 그대로 두고 «쓰기 시작하면» 그때 다시 넘긴다(`switch-supplier-sheet`).
 *
 * 옛 주소는 넘길 때 `sheet_note` 에 적어 뒀다 — 그게 없으면 되돌리지 않는다.
 *
 *   npx tsx scripts/revert-supplier-sheet.mts
 *   npx tsx scripts/revert-supplier-sheet.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const HUB = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const rows: { table: string; key: string; row: Rec }[] = [];
for (const [table, src] of [['partners', t3], ['v4/partners', t4]] as [string, Rec][]) {
  for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object' && !dead(v)) rows.push({ table, key: k, row: v });
}
const byCode = new Map<string, typeof rows>();
for (const r of rows) { const c = S(r.row.partner_code); if (!c) continue; byCode.set(c, [...(byCode.get(c) || []), r]); }

console.log(`■ 정본을 공급사 옛 시트로 되돌린다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
// 허브도 같이 되돌린다 — 안 고치면 다음 동기화에 우리 시트로 다시 덮인다.
const hubMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}?fields=sheets(properties(title))`);
const hubTab = S(((hubMeta.sheets || []) as Rec[])[0]?.properties?.title);
const hubVals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values/${encodeURIComponent(hubTab)}`);
const hubRows = ((hubVals.values || []) as string[][]);
const hubHdr = (hubRows[0] || []).map(S);
const cCode = hubHdr.findIndex((h) => /코드/.test(h));
const cUrl = hubHdr.findIndex((h) => /시트|주소|url/i.test(h));

let n = 0;
const writes: { range: string; values: string[][] }[] = [];
for (const [code, list] of byCode) {
  if (ONLY.length && !ONLY.includes(code)) continue;
  const note = S(list.map((r) => S(r.row.sheet_note)).find(Boolean));
  const oldUrl = (note.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+[^\s]*/) || [])[0];
  if (!oldUrl) continue;                       // 넘긴 적 없는 곳
  const now = S(list.map((r) => S(r.row.sheet_url)).find(Boolean));
  if (now && oldUrl.includes((now.match(/\/d\/([\w-]+)/) || [])[1] || '§')) continue;   // 이미 옛 시트
  n++;
  const name = S(list[0].row.partner_name || list[0].row.name) || code;
  console.log(`  ${name.slice(0, 14).padEnd(16)}${code.padEnd(10)}→ ${oldUrl.slice(0, 62)}`);
  if (!APPLY) continue;
  const at = new Date().toISOString();
  for (const r of list) {
    await fetch(`${DB}/${r.table}/${encodeURIComponent(r.key)}.json?access_token=${dbT}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      // 탭 지정은 지운다 — 옛 시트의 탭 구성은 그 시트가 스스로 안다(비우면 보이는 탭 전부).
      body: JSON.stringify({ sheet_url: oldUrl, sheet_tab: '', sheet_gid: '', updatedAt: at }),
    });
  }
  const at2 = hubRows.findIndex((r, i) => i > 0 && S(r[cCode]) === code);
  if (at2 > 0) writes.push({ range: `${hubTab}!${String.fromCharCode(65 + cUrl)}${at2 + 1}`, values: [[oldUrl]] });
}
if (APPLY && writes.length) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes }),
  });
  console.log(`\n  허브 ${writes.length}줄도 되돌림`);
}
console.log(`\n  되돌릴 곳 ${n}곳`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
