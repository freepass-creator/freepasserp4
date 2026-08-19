/**
 * **우리 구글시트 전부의 글꼴을 하나로 맞춘다** — 기본 Roboto(`sales-sheet-format.FONT_DEFAULT`). 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「모든 구글시트 Roboto 로 글꼴 통일한다 그게 글씨가 제일 잘 보이네」
 *   대상: 판매시트 · ERP4 차종마스터 원천대장 · 문패(공급사시트정리) · 프리패스 차량정제 · 「○○ 프리패스 재고」 20곳 — 탭 전부(숨김 포함).
 *   글꼴만 바꾼다(fields=textFormat.fontFamily). 크기·굵기·색·배경·행높이는 그대로.
 *
 *   npx tsx scripts/apply-font-all-sheets.mts
 *   npx tsx scripts/apply-font-all-sheets.mts --apply
 *   npx tsx scripts/apply-font-all-sheets.mts --apply --font=Roboto
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { FONT_DEFAULT } from '../lib/domain/sales-sheet-format';
import { SHEET_NAME_MATCH } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const FONT = arg('font', FONT_DEFAULT);
const FIXED: { id: string; name: string }[] = [
  { id: '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs', name: '판매시트(프리패스 상품리스트)' },
  { id: '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg', name: 'ERP4 차종마스터 원천대장' },
  { id: '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY', name: '공급사시트정리(문패)' },
  { id: '1nLwfgBSCpN_GnFUw_2SbG5LdyB9-l6d9ObkMP3IGa5I', name: '프리패스 차량정제' },
];

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
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const targets = excludeMirrorSheets([...FIXED, ...((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name) }))]);
console.log(`■ 글꼴 ${FONT} ${APPLY ? '반영' : '미리보기'} · 시트 ${targets.length}개\n`);
let tabs = 0;
for (const t of targets) {
  let meta: Rec;
  try { meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`); }
  catch (e) { console.log(`  ✗ ${t.name} — ${String((e as Error).message).slice(0, 80)}`); continue; }
  const props = (meta.sheets || []).map((x: Rec) => x.properties);
  const reqs = props.map((p: Rec) => ({ repeatCell: {
    range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: p.gridProperties.rowCount, startColumnIndex: 0, endColumnIndex: p.gridProperties.columnCount },
    cell: { userEnteredFormat: { textFormat: { fontFamily: FONT } } }, fields: 'userEnteredFormat.textFormat.fontFamily',
  } }));
  tabs += reqs.length;
  console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(28)} 탭 ${reqs.length}`);
  if (!APPLY) continue;
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  await new Promise((ok) => setTimeout(ok, 1500));   // 분당 쓰기 쿼터 여유
}
console.log(`\n  ${APPLY ? '반영' : '대상'} — 시트 ${targets.length} · 탭 ${tabs}${APPLY ? '' : ' (반영은 --apply)'}`);
