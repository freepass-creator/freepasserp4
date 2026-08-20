/**
 * **원천대장 「색상마스터」 탭을 찍는다** — @규격(규격색·글자색) · @별칭(코드 기본 + 사람이 더한 줄 보존) · @미매칭(21곳 공급사 시트에서 규격에 못 맞춘 원문).
 * 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「색상은 내가 예전 차종마스터에서 딱 정해 놓은 거 있는데 그거 벗어나면 기타로 · 색상마스터 탭을 하나 만들어서 운용해야 하나」
 *   · 규격색 정본은 코드(color-master.ts EXT_COLORS/INT_COLORS) — 여기서 바꾸지 않는다. 바꾸려면 코드를 고치고 다시 찍는다.
 *   · @별칭 표에서 **사람이 더 적은 줄(비고 「사람」 또는 코드에 없는 원문)** 은 지키고 맨 뒤에 남긴다 → fill/publish 가 읽어 코드 별칭보다 우선.
 *   · @미매칭은 기계가 매번 새로 센다(사람이 규격색을 적어 @별칭으로 옮기면 다음 채움부터 반영). 원문·횟수·시트를 남긴다.
 *
 *   npx tsx scripts/publish-color-master-tab.mts
 *   npx tsx scripts/publish-color-master-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { COLOR_INK, ENCAR_EXTERIOR, ENCAR_INTERIOR, EXT_COLORS, INT_COLORS, colorSwatch, snapColor } from '../lib/domain/color-master';
import { COLOR_MASTER_HEADER, COLOR_MASTER_MARKS, COLOR_MASTER_SHEET_ID, COLOR_MASTER_TAB, parseColorMasterAliases } from '../lib/domain/color-master-sheet';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
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
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

// ── 코드 기본 별칭(원문→규격색) — color-master 의 COLOR_ALIAS 는 비공개라 «snapColor 로 되짚어» 목록화한다: 알려진 원문 후보를 던져 본다.
//    (정본은 코드다. 이 표는 사람이 «어떤 말이 어디로 가는지» 보라고 찍는다.)
const KNOWN_RAW = ['흰색', '하얀색', '백색', 'white', '펄화이트', '진주', '아이보리', '크림', '스노우화이트', '우유니화이트', '세레니티화이트펄', '클라우드화이트펄', '클리어화이트', '미색',
  '검정', '검은색', '흑색', 'black', '팬텀블랙', '어비스블랙', '오로라블랙', '회색', 'gray', '차콜', '건메탈', '다크그레이', '쥐색', '진회색', '티타늄', '은색', 'silver',
  '빨강', '적색', 'red', '버건디', '파랑', '청색', 'blue', '스카이블루', '남색', 'navy', '다크블루', '갈색', 'brown', '커피', 'beige', '살구', '카키', '그린', '초록', 'mint', 'crayon', '그외'];

// ── 지금 탭(사람 줄 보존)
const meta = await call(`${SH}/${COLOR_MASTER_SHEET_ID}?fields=sheets.properties(sheetId,title,index)`);
const props = ((meta.sheets || []) as Rec[]).map((x) => x.properties as Rec);
let gid = props.find((p) => S(p.title) === COLOR_MASTER_TAB)?.sheetId as number | undefined;
let humanAliases: string[][] = [];
if (gid !== undefined) {
  const cur = await call(`${SH}/${COLOR_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${COLOR_MASTER_TAB}'!A1:D2000`)}`) as { values?: string[][] };
  const rows = ((cur.values || []) as string[][]).map((r) => r.map(S));
  let inAlias = false;
  for (const r of rows) {
    if (r[0] === COLOR_MASTER_MARKS.alias) { inAlias = true; continue; }
    if (r[0] && r[0].startsWith('@')) { inAlias = false; continue; }
    if (inAlias && r[1] && r[2] && (r[3] === '사람' || snapColor(r[1], 'ext') !== r[2])) humanAliases.push(['', r[1], r[2], '사람']);
  }
}

// ── 21곳 공급사 시트 — 규격에 못 맞춘 원문
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const unmatched = new Map<string, { kind: 'ext' | 'int'; n: number; where: Set<string> }>();
let scanned = 0;
for (const t of suppliers) {
  const m = await call(`${SH}/${t.id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (m.sheets || []) as Rec[]) {
    const title = S(sh.properties?.title); if (sh.properties?.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)')); if (hi < 0) continue;
    const h = rows[hi]; const ei = h.findIndex((x) => /^(외부색상|외장색|외장색상\(원문\)|색상)$/.test(x.replace(/\s/g, ''))); const ii = h.findIndex((x) => /^(내부색상|내장색)$/.test(x.replace(/\s/g, '')));
    for (const r of rows.slice(hi + 1)) {
      if (!S(r[h.indexOf('차량번호')])) continue;
      scanned++;
      for (const [i, kind] of [[ei, 'ext'], [ii, 'int']] as [number, 'ext' | 'int'][]) {
        if (i < 0) continue; const raw = S(r[i]); if (!raw || raw === '-') continue;
        if (snapColor(raw, kind)) continue;
        const key = `${kind}|${raw}`; const cur = unmatched.get(key) || { kind, n: 0, where: new Set<string>() }; cur.n++; cur.where.add(t.name); unmatched.set(key, cur);
      }
    }
  }
}

// ── 표 만들기
const R: string[][] = [];
R.push([`${COLOR_MASTER_TAB} — 색상 규격·별칭·미매칭 한 장`, `정본 lib/domain/color-master.ts(규격색) · 이 탭의 @별칭 표는 fill/publish 가 읽어 코드보다 우선 · 갱신 ${kst()} KST`, '', 'npx tsx scripts/publish-color-master-tab.mts --apply']);
R.push(['규칙', '규격색 밖의 표기는 「기타」로 간다(사장님 2026-08-19). 새 표기를 규격색에 붙이려면 @별칭에 한 줄(원문 | 규격색 | 비고 「사람」) 적는다 → 다음 채움(fill-supplier-ai-columns)부터 반영. @미매칭은 기계가 매번 새로 센다.', '', '']);
R.push([...COLOR_MASTER_HEADER]);
R.push([COLOR_MASTER_MARKS.spec, '', '', '외장 12 · 내장 10 · 그 밖 = 기타']);
for (const c of EXT_COLORS) R.push(['외장', '', c, `글자색 #${COLOR_INK[c] || '000000'} · 견본 ${colorSwatch(c)}${(INT_COLORS as readonly string[]).includes(c) ? ' · 내장에도 씀' : ''}`]);
for (const c of INT_COLORS) if (!(EXT_COLORS as readonly string[]).includes(c)) R.push(['내장', '', c, `글자색 #${COLOR_INK[c] || '000000'}`]);
R.push([COLOR_MASTER_MARKS.alias, '', '', '원문(별칭) → 규격색. 코드 기본은 「코드」, 사람이 더한 줄은 「사람」(다시 찍어도 지킴, 코드보다 우선)']);
const codeRows: string[][] = [];
for (const raw of KNOWN_RAW) { const c = snapColor(raw, 'ext') || snapColor(raw, 'int'); if (c) codeRows.push(['', raw, c, '코드']); }
R.push(...codeRows);
const humanKeys = new Set(codeRows.map((r) => r[1].replace(/\s/g, '')));
R.push(...humanAliases.filter((r) => !humanKeys.has(r[1].replace(/\s/g, ''))));
R.push(['@참고 엔카 기준', '', '', '엔카 외장 30·내장 10계열 → 우리 규격 대응(사장님 2026-08-19 「학습해 봐, 똑같이 따라할 필요는 없음」). 투톤=바탕색 · 계열=그 색 · 노랑/주황/자주/보라/분홍=기타']);
for (const [raw, c] of ENCAR_EXTERIOR) R.push(['외장(엔카)', raw, c, snapColor(raw, 'ext') === c ? '별칭 반영' : `⚠ 코드 판정 ${snapColor(raw, 'ext') || '(없음→기타)'}`]);
for (const [raw, c] of ENCAR_INTERIOR) R.push(['내장(엔카)', raw, c, snapColor(raw, 'int') === c ? '별칭 반영' : `⚠ 코드 판정 ${snapColor(raw, 'int') || '(없음→기타)'}`]);
R.push([COLOR_MASTER_MARKS.unmatched, '', '', `21곳 재고 ${scanned}줄에서 규격에 못 맞춰 「기타」로 간 원문 ${unmatched.size}종 — 규격색을 적어 @별칭으로 옮기면 다음 채움부터 반영`]);
for (const [key, u] of [...unmatched].sort((a, b) => b[1].n - a[1].n)) R.push([u.kind === 'ext' ? '외장' : '내장', key.split('|')[1], '', `${u.n}건 · ${[...u.where].slice(0, 6).join('·')}`]);
console.log(`■ 「${COLOR_MASTER_TAB}」 ${APPLY ? '반영' : '미리보기'} — 규격 ${EXT_COLORS.length + INT_COLORS.filter((c) => !(EXT_COLORS as readonly string[]).includes(c)).length} · 코드 별칭 ${codeRows.length} · 사람 별칭 ${humanAliases.length} · 미매칭 ${unmatched.size}종(재고 ${scanned}줄)`);
for (const [key, u] of [...unmatched].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`   ${u.kind} ${key.split('|')[1].padEnd(16)} ${String(u.n).padStart(3)}건  ${[...u.where].slice(0, 4).join('·')}`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }

if (gid === undefined) {
  const added = await call(`${SH}/${COLOR_MASTER_SHEET_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: COLOR_MASTER_TAB, gridProperties: { rowCount: R.length + 50, columnCount: 4, frozenRowCount: 3 } } } }] }) });
  gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
}
await call(`${SH}/${COLOR_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${COLOR_MASTER_TAB}'!A1:Z2000`)}:clear`, { method: 'POST', body: '{}' });
await call(`${SH}/${COLOR_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${COLOR_MASTER_TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: R }) });
const reqs: Rec[] = [
  { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 2, endRowIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  ...[110, 260, 120, 520].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
  { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('F4C7C3') }, fields: 'tabColor' } },
];
R.forEach((r, i) => { if (r[0] && r[0].startsWith('@')) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFF4D6'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }); });
// 규격색 줄의 규격색 칸에 그 글자색
R.forEach((r, i) => { const ink = COLOR_INK[r[2]]; if (ink && (r[0] === '외장' || r[0] === '내장' || r[0].endsWith('(엔카)') || r[3] === '코드' || r[3] === '사람')) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true, foregroundColor: rgb(ink) } } }, fields: 'userEnteredFormat.textFormat' } }); });
await call(`${SH}/${COLOR_MASTER_SHEET_ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
console.log(`  ✓ 「${COLOR_MASTER_TAB}」 ${R.length}줄 — https://docs.google.com/spreadsheets/d/${COLOR_MASTER_SHEET_ID}/edit#gid=${gid}`);
