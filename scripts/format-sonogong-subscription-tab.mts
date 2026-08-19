/**
 * **손오공 「구독재고」 탭을 표준 재고탭과 같은 모양(표·칩 드롭다운·줄무늬·숫자서식·열너비)으로 입힌다.**
 *
 * ★사장님 2026-08-18 — 「손오공 구독만 탭 따로 해서 · 양식에 맞춰서 대여료만 다르게」 · 「(렌트재고와) 전혀 안 맞는데」
 *   렌트재고는 create-supplier-sheet 가 만든 표준(구글 표 + 칩 + 블록 줄무늬)이고 구독재고는 맨 셀이라 달라 보였다.
 *   같은 생성기(`supplier-template-sheet` 의 buildTemplateFormat·buildTableRequest·buildSectionBanding…)를
 *   구독 열 구성(앞 14 + 인수형 6·반납형 6 + 정책코드·최초등록일·사진링크 + 정제칸 12)으로 다시 돌린다. 값은 안 건드린다.
 *
 *   npx tsx scripts/format-sonogong-subscription-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  AI_TAIL_COLUMNS, TEMPLATE_COLUMNS, buildBaseFont, buildChipColors, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildTableRequest, buildTemplateFormat, columnWidth, resetSheetRequests, tableWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { COL_BG, rgb } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET = arg('sheet', '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA');
const TAB = arg('tab', '구독재고');
const ROWS = 500;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {};
};
const SH = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const meta = await call(`${SH}?fields=sheets(properties(sheetId,title),bandedRanges,tables)`);
const sheet = (meta.sheets || []).find((s: Rec) => S(s.properties.title) === TAB);
if (!sheet) throw new Error(`탭 없음: ${TAB}`);
const gid = sheet.properties.sheetId;
const header = ((await call(`${SH}/values/${encodeURIComponent(`'${TAB}'!1:1`)}`)).values?.[0] || []).map(S) as string[];
// 열 정의 — 이름이 표준에 있으면 그 메모, 구독 12칸은 요금/보증금 메모
const noteOf = (name: string) => TEMPLATE_COLUMNS.find((c) => c.name === name)?.note || AI_TAIL_COLUMNS.find((c) => c.name === name)?.note
  || (/보증금/.test(name) ? '보증금(원, 숫자만) — 오른쪽 기간을 관할한다' : /개월/.test(name) ? '월 대여료(원, 숫자만)' : '');
const cols = header.map((name) => ({ name, note: noteOf(name), required: TEMPLATE_COLUMNS.find((c) => c.name === name)?.required }));
console.log(`「${TAB}」 ${cols.length}열 · 표 너비 ${tableWidth(cols)}(드롭다운 칸까지) · 기존 표 ${(sheet.tables || []).length} · 줄무늬 ${(sheet.bandedRanges || []).length}`);
if (!APPLY) { console.log('dry-run — --apply'); process.exit(0); }
const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };
/**
 * ⚠⚠ deleteTable 은 표 안의 **값까지 지운다**(실측 2026-08-18 — 22탭이 비어 revision 에서 되살렸다).
 *   이 스크립트는 값을 되쓰지 않으므로 표가 이미 있으면 여기서 멈춘다 — 값을 보전하는 `reformat-supplier-stock-tabs --sheet=… ` 를 쓴다.
 */
if ((sheet.tables || []).length) throw new Error(`「${TAB}」 에 표(Table)가 이미 있다 — deleteTable 은 값을 지운다. reformat-supplier-stock-tabs 를 쓸 것`);
const pre: Rec[] = [];
for (const b of (sheet.bandedRanges || [])) pre.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
pre.push(...resetSheetRequests(gid));
await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: pre }) });
await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  ...buildBaseFont(gid, cols.length, ROWS),
  ...buildTemplateFormat(gid, cols, extras, { asTable: true }),
  ...buildChipColors(gid, cols, HANDLED_MAKER_OPTIONS, ROWS),
  ...buildNumberFormats(gid, cols, ROWS),
  ...buildRowHeights(gid, ROWS),
  ...cols.map((c, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: columnWidth(c.name) || 118 }, fields: 'pixelSize' } })),
] }) });
try { await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid, cols, extras, ROWS, TAB)] }) }); console.log('  ✓ 표(Table) 변환'); }
catch (e) { console.log(`  △ 표 변환 실패 — ${String((e as Error).message).slice(0, 120)}`); }
try { await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildSectionBanding(gid, cols, ROWS, tableWidth(cols)) }) }); console.log('  ✓ 블록 줄무늬'); }
catch (e) { console.log(`  △ 줄무늬 실패 — ${String((e as Error).message).slice(0, 120)}`); }
// 대여료 칸 배경 — 판매시트 색(반납형 파랑·인수형 보라)
const bg: Rec[] = [];
cols.forEach((c, i) => { const hex = COL_BG[c.name]; if (hex) bg.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(hex) } }, fields: 'userEnteredFormat.backgroundColor' } }); });
if (bg.length) await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: bg }) });
console.log(`  ✓ 대여료 배경 ${bg.length}열 · 완료`);
