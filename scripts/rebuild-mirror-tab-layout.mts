/**
 * **정제시트 재고 탭의 «대여료 블록»만 그 공급사 구조로 다시 세운다.** 앞 14칸·뒤(정책코드·최초등록일·사진링크)·정제칸 12는 표준 그대로.
 * 값은 열 이름으로 옮겨 담아 보존한다(정제칸·정책코드 포함). 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「오토플러스거 정제된 탭 하나 만들자 우리거 규격으로」 · (손오공 선례) 「양식에 맞춰서 대여료만 다르게」.
 *   오토플러스는 기간마다 약정주행이 두 벌(2만/3만km)이다. 표준 6칸에 우겨넣으면 한 벌이 사라진다 —
 *   그래서 손오공 구독재고처럼 **대여료 블록만** 그 공급사 구조로 두고 나머지는 표준을 지킨다.
 *   열 이름 「12개월2만」은 ERP 파서가 그대로 읽는 표기다(`^(\d+)개월(N만)?`). 다른 이름을 쓰면 요금이 안 읽힌다.
 * ⚠ 이 탭에 있던 줄은 전부 남는다(차량번호 기준, 열 이름으로 옮김). 새 이름에 없는 옛 열의 값은 버린다 — 화면에 보여 준다.
 *
 *   npx tsx scripts/rebuild-mirror-tab-layout.mts --sheet=<ID> --tab=재고 --money=장기보증,12개월2만,12개월3만,18개월2만,18개월3만,24개월2만,24개월3만,36개월2만,36개월3만
 *   … --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  AI_TAIL_COLUMNS, TEMPLATE_COLUMNS, buildBaseFont, buildChipColors, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildTableRequest, buildTemplateFormat, columnWidth, periodColumnNote, resetSheetRequests, tableWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { COL_BG, rgb } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET = arg('sheet');
const TAB = arg('tab', '재고');
const MONEY = arg('money').split(',').map(S).filter(Boolean);
if (!SHEET || !MONEY.length) throw new Error('--sheet=<ID> --money=<열,열,…> 이 필요하다');
const ROWS = 500;

/** 표준 앞 14칸(차량번호~차량가격)·뒤 3칸(정책코드·최초등록일·사진링크) — 코드 표준에서 이름만 가져온다. */
const FRONT = TEMPLATE_COLUMNS.slice(0, TEMPLATE_COLUMNS.findIndex((c) => c.name === '단기보증'));
const TAIL = TEMPLATE_COLUMNS.filter((c) => ['정책코드', '최초등록일', '사진링크'].includes(c.name));
const moneyNote = (name: string) => {
  const m = /^(\d+)개월(\d+만)?$/.exec(norm(name));
  if (m) return periodColumnNote(m[2] ? `${m[1]}_${m[2]}` : m[1]);
  return /보증/.test(name) ? '보증금(원, 숫자만) — 오른쪽 기간을 관할한다. 비어 있으면 ERP 가 공급사 보증금 규칙으로 채운다' : '';
};
const cols = [
  ...FRONT,
  ...MONEY.map((name) => ({ name, note: moneyNote(name) })),
  ...TAIL,
  ...AI_TAIL_COLUMNS,
];
/** 배경 — 판매시트 색표(주행 구간 변형은 그 기간 색을 같이 쓴다. 18개월은 예비색). */
const bgOf = (name: string) => {
  if (COL_BG[name]) return COL_BG[name];
  const m = /^(\d+)개월/.exec(norm(name));
  if (m) return COL_BG[`${m[1]}개월`] || (m[1] === '18' ? 'B0DBE0' : m[1] === '6' ? 'CDE9EC' : '');
  return '';
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const meta = await call(`${SH}?fields=properties.title,sheets(properties(sheetId,title),bandedRanges,tables)`);
const sheet = (meta.sheets || []).find((s: Rec) => S(s.properties.title) === TAB);
if (!sheet) throw new Error(`탭 없음: ${TAB}`);
const gid = sheet.properties.sheetId;
const v = await call(`${SH}/values/${encodeURIComponent(`'${TAB}'`)}`) as { values?: string[][] };
const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
if (hi < 0) throw new Error('머리행(차명(세부모델+트림))을 못 찾았다');
const oldHdr = rows[hi];
const pi = oldHdr.findIndex((h) => norm(h) === '차량번호');
const body = rows.slice(hi + 1).filter((r) => S(r[pi]));
const newNames = cols.map((c) => c.name);
const at = new Map(oldHdr.map((h, i) => [norm(h), i] as const));
const outRows = body.map((r) => newNames.map((n) => { const i = at.get(norm(n)); return i === undefined ? '' : S(r[i]); }));
const lost = oldHdr.filter((h) => h && !newNames.some((n) => norm(n) === norm(h)));
const lostWithValues = lost.filter((h) => body.some((r) => S(r[at.get(norm(h))!])));
console.log(`■ 「${S(meta.properties?.title)}」 ${TAB} — 옛 ${oldHdr.filter(Boolean).length}열 ${body.length}줄 → 새 ${cols.length}열`);
console.log(`  새 머리행: ${newNames.join(' | ')}`);
console.log(`  값을 잃는 옛 열: ${lostWithValues.length ? lostWithValues.join(' · ') : '없음'}${lost.length ? ` (빈 열까지: ${lost.join(' · ')})` : ''}`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }

const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };
// ⚠ 표(Table)를 지우면 표에 딸린 줄무늬도 같이 사라진다 — 한 배치에 넣으면 「No BandedRange with id」로 통째로 실패한다. 표 먼저, 줄무늬는 다시 읽어서.
if ((sheet.tables || []).length) await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: (sheet.tables as Rec[]).map((t) => ({ deleteTable: { tableId: t.tableId } })) }) });
const again = await call(`${SH}?fields=sheets(properties(sheetId),bandedRanges)`);
const bands = ((again.sheets || []).find((s: Rec) => s.properties.sheetId === gid)?.bandedRanges || []) as Rec[];
const pre: Rec[] = [];
for (const b of bands) pre.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
pre.push(...resetSheetRequests(gid));
await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: pre }) });
// 값 — 머리행부터 통째로 다시 쓴다(옛 열 자리의 값이 남지 않게 먼저 지운다).
await call(`${SH}/values/${encodeURIComponent(`'${TAB}'!A1:BZ${Math.max(ROWS, rows.length + 5)}`)}:clear`, { method: 'POST', body: '{}' });
await call(`${SH}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [newNames, ...outRows] }) });
await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  ...buildBaseFont(gid, cols.length, ROWS),
  ...buildTemplateFormat(gid, cols, extras, { asTable: true }),
  ...buildChipColors(gid, cols, HANDLED_MAKER_OPTIONS, ROWS),
  ...buildNumberFormats(gid, cols, ROWS),
  ...buildRowHeights(gid, ROWS),
  ...cols.map((c, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: columnWidth(c.name) || 118 }, fields: 'pixelSize' } })),
] }) });
try { await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid, cols, extras, ROWS, TAB)] }) }); console.log('  ✓ 표(Table)'); }
catch (e) { console.log(`  △ 표 변환 실패 — ${String((e as Error).message).slice(0, 120)}`); }
try { await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildSectionBanding(gid, cols, ROWS, tableWidth(cols)) }) }); console.log('  ✓ 블록 줄무늬'); }
catch (e) { console.log(`  △ 줄무늬 실패 — ${String((e as Error).message).slice(0, 120)}`); }
const bg: Rec[] = [];
cols.forEach((c, i) => { const hex = bgOf(c.name); if (hex) bg.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(hex) } }, fields: 'userEnteredFormat.backgroundColor' } }); });
if (bg.length) await call(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: bg }) });
console.log(`  ✓ 대여료 배경 ${bg.length}열 · ${outRows.length}줄 옮김 · 완료`);
