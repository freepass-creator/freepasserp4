/**
 * **값은 건드리지 않고 서식만 다시 입힌다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★`build-supplier-sheet-set --force` 는 표를 갈아끼우느라 `deleteTable` 을 하고,
 *   구글은 표를 지울 때 **그 안의 값까지 지운다**(실측 2026-08-11 · 196대가 헤더만 남았다).
 *   공급사가 이미 쓰고 있는 시트에는 그걸 쓸 수 없다. 색·너비·행높이만 바꿀 때는 이 도구를 쓴다.
 *
 * 하는 일 — 조건부서식 갈아끼우기 · 열 너비 · 행 높이 · 글꼴. 표·줄무늬·값은 손대지 않는다.
 *
 *   npx tsx scripts/restyle-supplier-sheets.mts
 *   npx tsx scripts/restyle-supplier-sheets.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  buildBaseFont, buildChipColors, buildColumns, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildTemplateFormat, columnWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ROWS = 500;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);
console.log(`■ 서식만 다시 입힌다 ${APPLY ? '(반영)' : '(dry-run)'} — 값은 안 건드린다\n`);

for (const f of ((found.files || []) as Rec[])) {
  const label = S(f.name).replace('프리패스 재고 · ', '');
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets(properties(sheetId,title),conditionalFormats,tables(range),bandedRanges(bandedRangeId,range))`);
  const sh = ((meta.sheets || []) as Rec[]).find((x) => S(x.properties?.title) === '재고');
  if (!sh) { console.log(`  △ ${label.padEnd(12)}「재고」 탭이 없다`); continue; }
  const gid = Number(sh.properties?.sheetId ?? 0);
  const had = ((sh.conditionalFormats || []) as Rec[]).length;
  const tableEnd = Number(((sh.tables || []) as Rec[])[0]?.range?.endColumnIndex ?? 0);

  // 헤더를 읽어 그 시트의 실제 열 구성을 쓴다 — 공급사마다 기간 열이 다르다.
  const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent('재고!A1:BZ1')}`);
  const hdr = (((vals.values || []) as string[][])[0] || []).map(S);
  if (!hdr.length) { console.log(`  △ ${label.padEnd(12)}헤더가 없다`); continue; }
  /**
   * 헤더 이름으로 **원래 열 정의**(설명·필수 표시)를 되찾는다.
   * 이름만 넘기면 머리행 스타일과 셀 메모가 통째로 빠져 헤더가 밋밋해진다(사장님 지적).
   */
  const known = new Map(buildColumns(hdr.filter((h) => /개월$/.test(h)).map((h) => h.replace('개월', ''))).map((c) => [c.name, c]));
  const cols = hdr.map((name) => known.get(name) || { name, note: '' });

  const reqs: Rec[] = [
    // 조건부서식은 쌓인다 — 뒤에서부터 다 지우고 새로 넣는다.
    ...Array.from({ length: had }, (_, k) => ({ deleteConditionalFormatRule: { sheetId: gid, index: had - 1 - k } })),
    ...buildBaseFont(gid, cols.length, ROWS),
    // 머리행(남색·필수 주황·보증 흐리게)과 셀 메모를 다시 입힌다.
    ...buildTemplateFormat(gid, cols, { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) }, { asTable: true }),
    // 표가 덮는 구간은 표가 스스로 칠한다 — 그 밖만 구간별 줄무늬로 가른다.
    ...((sh.bandedRanges || []) as Rec[])
      .filter((b) => Number(b.range?.startColumnIndex ?? 0) >= tableEnd)
      .map((b) => ({ deleteBanding: { bandedRangeId: Number(b.bandedRangeId) } })),
    ...buildSectionBanding(gid, cols, ROWS, tableEnd),
    ...buildChipColors(gid, cols, HANDLED_MAKER_OPTIONS, ROWS),
    // ★대여료 굵게·보증금 흐리게·천단위 콤마 — baseFont 뒤에 와야 살아남는다.
    ...buildNumberFormats(gid, cols, ROWS),
    ...buildRowHeights(gid, ROWS),
    ...cols.map((c, i) => ({
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: columnWidth(c.name) }, fields: 'pixelSize',
      },
    })),
  ];
  console.log(`  ${label.padEnd(12)}열 ${cols.length} · 옛 서식 ${had} → 새 서식 ${reqs.filter((r) => r.addConditionalFormatRule).length}`);
  if (!APPLY) continue;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: reqs }),
  });
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
