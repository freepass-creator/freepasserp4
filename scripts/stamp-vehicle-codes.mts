/**
 * **차번에 「차종코드」를 박는다 — 한 번 박으면 다시 판단하지 않는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「그 차에 대해서 코드를 박아두면 절대 틀릴 일이 없음.
 *   차량번호에 한번만 코드 박아두면 되잖아」)
 *
 * ★박기 전에 **두 관문**을 다 통과해야 한다. 둘 중 하나라도 안 열렸으면 박지 않는다.
 *   ① 코드가 안 흔들리나 — `npm run audit:vehicle-trim-keys` 가 PASS 여야 한다.
 *      행키는 순번 기반이라 마스터를 고치면 밀릴 수 있었다. 지금은 레지스트리가 못 박고
 *      감사가 막는다(코드 삭제·순번 재사용·차량 의미 변경이면 실패).
 *   ② 판단이 믿을 만한가 — 「확실」로 고른 것을 **세대·사양 두 렌즈로 전수 반증**해
 *      둘 다 통과한 것만 넣는다. 실측 2026-08-15: 「확실」 159묶음 중 158 생존(99.4%),
 *      「애매」는 반증에서 43%가 뒤집혀 **아예 안 쓴다.**
 *
 * ⚠ **빈 칸에만 쓴다.** 이미 코드가 있으면 사람이 고친 것일 수 있으니 안 덮는다.
 * ⚠ 넣는 코드가 **마스터에 실재하는지 쓰기 전에 확인한다.** 실측 2026-08-14: 판단을 맡긴
 *   에이전트가 없는 코드를 «있다»고 설명한 적이 있다(코드 자체는 실재했지만 설명이 거짓이었다).
 *   설명을 믿지 말고 코드책에 있는지 본다.
 *
 *   npx tsx scripts/stamp-vehicle-codes.mts --from=tmp/code-assignments.json
 *   npx tsx scripts/stamp-vehicle-codes.mts --from=tmp/code-assignments.json --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB, readMasterSheet } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const FROM = arg('from', 'tmp/code-assignments.json');
const DOC_NAME = arg('name', '프리패스 재고');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** 박을 것 — 차번 → 코드. */
const want = new Map<string, string>(Object.entries(JSON.parse(readFileSync(FROM, 'utf8')) as Record<string, string>).map(([k, v]) => [plate(k), S(v)]));
console.log(`\n■ 차번에 차종코드 박기 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'}\n`);
console.log(`  박을 것 ${want.size}대 · 서로 다른 코드 ${new Set(want.values()).size}개`);

/** ⚠ 넣기 전에 «마스터에 있는 코드인가»를 본다. 설명이 아니라 코드책이 근거다. */
const BOOK = readMasterSheet(((await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(a1Tab(MASTER_TAB))}`) as { values?: string[][] }).values || []) as string[][]);
const ghost = [...new Set(want.values())].filter((c) => !BOOK.byCode.has(c));
if (ghost.length) {
  console.log(`\n  ⛔ 마스터에 없는 코드 ${ghost.length}개 — 박지 않는다`);
  for (const g of ghost.slice(0, 10)) console.log(`     ${g}`);
  for (const [p, c] of [...want]) if (ghost.includes(c)) want.delete(p);
}
const blocked = [...new Set(want.values())].filter((c) => BOOK.byCode.get(c)?.usageTier === 'blocked');
if (blocked.length) {
  console.log(`\n  ⛔ 신규 배정이 금지된 마스터 코드 ${blocked.length}개 — 확정 또는 수동검증 후보가 아님`);
  for (const code of blocked.slice(0, 10)) console.log(`     ${code}`);
  for (const [p, code] of [...want]) if (blocked.includes(code)) want.delete(p);
}
console.log(`  마스터 대조 통과 ${want.size}대`);

/** 우리 제공시트 전부. */
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);

let stamped = 0, kept = 0, notFound = 0;
const rows: { who: string; n: number; kept: number }[] = [];
const seen = new Set<string>();

for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }

  const updates: { range: string; values: string[][] }[] = [];
  let n = 0, k = 0;
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    const h = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) return;
    const hdr = (grid[h] || []).map(S);
    const pi = hdr.indexOf('차량번호'), ci = hdr.indexOf('차종코드');
    if (pi < 0 || ci < 0) return;
    for (let r = h + 1; r < grid.length; r++) {
      const p = plate((grid[r] || [])[pi]);
      if (!p) continue;
      const code = want.get(p);
      if (!code) continue;
      seen.add(p);
      const now = S((grid[r] || [])[ci]);
      if (now) { k++; continue; }              // ⚠ 있는 코드는 안 덮는다
      n++;
      updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[code]] });
    }
  });
  if (!n && !k) continue;
  rows.push({ who, n, kept: k });
  stamped += n; kept += k;
  if (APPLY && updates.length) {
    for (let i = 0; i < updates.length; i += 500) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
        method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 500) }),
      });
    }
  }
}
notFound = [...want.keys()].filter((p) => !seen.has(p)).length;

console.log(`\n  ${pad('공급사', 14)}${pad('박음', 8)}이미 있어 그대로 둠`);
for (const r of rows.sort((a, b) => b.n - a.n)) console.log(`  ${pad(r.who, 14)}${pad(`${r.n}대`, 8)}${r.kept ? `${r.kept}대` : '-'}`);
console.log(`  ${'─'.repeat(46)}`);
console.log(`  박을 칸 ${stamped} · 이미 있어 그대로 둔 칸 ${kept}${notFound ? ` · 시트에서 못 찾은 차 ${notFound}대` : ''}`);
console.log(APPLY ? '\n  반영 완료 — 이제 이 차들은 다시 판단하지 않는다.\n' : '\n  미리보기였다. 실제로 쓰려면 --apply\n');
