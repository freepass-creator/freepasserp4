/**
 * **공급사 제공시트 재고탭의 기간별 대여료·보증금 칸 배경을 판매시트와 같은 색으로 칠한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「금액별 대여료는 판매시트랑 동일하게 색깔 좀 칠해줘 — 배경색 말야」
 *   색표는 판매시트 정본 `sales-sheet-format.COL_BG` 그대로다(단기 청록 · 장기 파랑, 길수록 짙다). 여기서 색을 새로 만들지 않는다.
 *   머리행부터 아래 끝까지 열 전체를 칠한다 — 어느 열이 어느 블록인지 위에서부터 보이게.
 * ⚠ 값·글꼴·드롭다운은 안 건드린다. 배경색만.
 *
 *   npx tsx scripts/paint-supplier-period-columns.mts
 *   npx tsx scripts/paint-supplier-period-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { COL_BG, rgb } from '../lib/domain/sales-sheet-format';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const MARK = '차명(트림)';
/** 판매시트에 없는 규격 예비 기간 — 단기 블록 색을 이어 쓴다. */
const EXTRA_BG: Record<string, string> = { '18개월': 'B0DBE0', '72개월': 'A7B9F9', '84개월': '99AEF8' };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(f.name) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
// ⚠ excludeMirrorSheets 는 --include-mirror 면 «같은 배열»을 돌려준다 — 복사본을 넘겨야 targets.length=0 에 같이 안 비워진다(2026-08-19 실측 0열).
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);
let painted = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties`);
  for (const p of (meta.sheets || []).map((x: Rec) => x.properties)) {
    if (p.hidden) continue;
    const title = S(p.title);
    if (isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ8`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const h = rows.findIndex((r) => r.includes(MARK));
    if (h < 0) continue;
    const header = rows[h];
    const reqs: Rec[] = [];
    const hit: string[] = [];
    header.forEach((name, i) => {
      const bg = COL_BG[name] || EXTRA_BG[name];
      if (!bg) return;
      hit.push(name);
      // ★글자색은 검정(사장님 2026-08-19 「기간별 대여료 폰트 그냥 검정색으로」) — 배경이 기간을 가른다. 대여료 굵게 · 보증금 보통.
      reqs.push({ repeatCell: {
        range: { sheetId: p.sheetId, startRowIndex: h + 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: /\d+개월|^기타기간/.test(name) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold',
      } });
      reqs.push({ repeatCell: {
        range: { sheetId: p.sheetId, startRowIndex: h, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { backgroundColor: rgb(bg) } }, fields: 'userEnteredFormat.backgroundColor',
      } });
    });
    if (!reqs.length) { console.log(`  · ${t.name.padEnd(10)} 「${title}」 — 기간 열 없음`); continue; }
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 — ${hit.length}열: ${hit.join(' · ')}`);
    if (!APPLY) continue;
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    painted += hit.length;
  }
}
console.log(APPLY ? `\n  칠함 — ${painted}열` : '\n※ dry-run. 반영은 --apply');
