/**
 * **「AI 운영 매뉴얼」 탭을 모든 시트에 같은 글로 찍는다** — 원천대장·판매시트·문패·허브 + 공급사 시트 21곳(숨김). 기본 dry-run, 반영은 `--apply`.
 * 문서 사본 docs/AI_OPERATING_MANUAL.md 도 같이 쓴다.
 *
 * ★사장님 2026-08-18 — 「매뉴얼 확실하게 박아 주라, 어떤 AI가 와도 이렇게 작업될 수 있게끔 — 각 시트에 다 박아 놓자」.
 *   글의 정본은 `lib/domain/ai-operating-manual.ts`. 탭은 기계가 통째로 다시 쓴다(사람 메모는 「AI 인계」에).
 *   공급사 시트·판매시트에서는 숨김(영업자·공급사가 볼 글이 아니다), 원천대장·문패·허브에서는 보임.
 *
 *   npx tsx scripts/publish-ai-manual-tab.mts
 *   npx tsx scripts/publish-ai-manual-tab.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { AI_MANUAL_TITLE, AI_MANUAL_VERSION, buildAiOperatingManual } from '../lib/domain/ai-operating-manual';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY_SHEET = S((process.argv.find((a) => a.startsWith('--sheet=')) || '').slice('--sheet='.length));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const TAB = AI_MANUAL_TITLE;
const VISIBLE_BOOKS: { id: string; name: string }[] = [
  { id: '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg', name: '원천대장' },
  { id: '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY', name: '문패(공급사시트정리)' },
  { id: '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w', name: '허브(프리패스 공급사시트 정리)' },
];
const HIDDEN_BOOKS: { id: string; name: string }[] = [
  { id: '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs', name: '판매시트' },
];

const sections = buildAiOperatingManual();
const rows: string[][] = [[`${TAB} — ${AI_MANUAL_VERSION} · 정본 lib/domain/ai-operating-manual.ts · 이 탭은 사본(고치려면 코드를 고쳐 다시 찍는다: npx tsx scripts/publish-ai-manual-tab.mts --apply)`, '', '']];
for (const sec of sections) { rows.push(['', '', '']); rows.push([sec.title, '', '']); for (const r of sec.rows) rows.push([r[0], r[1], r[2]]); }
const md = [`# ${TAB} (${AI_MANUAL_VERSION})`, '', '정본: `lib/domain/ai-operating-manual.ts` — 모든 시트의 「AI 운영 매뉴얼」 탭과 이 문서는 같은 글이다.', '',
  ...sections.flatMap((sec) => [`## ${sec.title}`, '', '| 항목 | 내용 | 어디서/명령 |', '|---|---|---|', ...sec.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '／')).join(' | ')} |`), ''])].join('\n');
writeFileSync('docs/AI_OPERATING_MANUAL.md', md, 'utf8');
console.log(`  문서 갱신 — docs/AI_OPERATING_MANUAL.md (${rows.length}줄)`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const allTargets = [...VISIBLE_BOOKS.map((b) => ({ ...b, hidden: false })), ...HIDDEN_BOOKS.map((b) => ({ ...b, hidden: true })), ...suppliers.map((b) => ({ ...b, hidden: true }))];
const targets = ONLY_SHEET ? allTargets.filter((t) => t.id === ONLY_SHEET) : allTargets;
if (ONLY_SHEET && targets.length !== 1) throw new Error(`unknown --sheet target: ${ONLY_SHEET}`);
console.log(`■ 「${TAB}」 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳(보임 ${VISIBLE_BOOKS.length} · 숨김 ${targets.length - VISIBLE_BOOKS.length}) · ${rows.length}줄`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
let n = 0;
for (const t of targets) {
  try {
    const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,index)`);
    const props = (meta.sheets || []).map((x: Rec) => x.properties);
    let gid = props.find((p: Rec) => S(p.title) === TAB)?.sheetId;
    if (gid === undefined) {
      const added = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 20, columnCount: 3, frozenRowCount: 1 } } } }] }) });
      gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
    }
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'!A1:Z${Math.max(300, rows.length + 30)}`)}:clear`, { method: 'POST', body: '{}' });
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
    const reqs: Rec[] = [
      { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
      ...[220, 620, 360].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
      { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('FCE8B2'), hidden: t.hidden }, fields: 'tabColor,hidden' } },
    ];
    rows.forEach((r, i) => { if (i > 0 && /^\d\./.test(r[0]) && !r[1]) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }); });
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    n++; console.log(`  ✓ ${t.name}${t.hidden ? '(숨김)' : ''}`);
    await sleep(1200);
  } catch (e) { console.log(`  ✗ ${t.name} — ${String((e as Error).message).slice(0, 120)}`); }
}
console.log(`  반영 ${n}/${targets.length}`);
