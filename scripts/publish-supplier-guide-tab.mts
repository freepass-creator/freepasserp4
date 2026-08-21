/**
 * **공급사 제공시트마다 「작성 안내」 탭 한 장** — 재고탭 칸별로 무엇을 어떻게 적나 + 정책 탭 표기 규격 + 탭 규칙. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「공급사 시트 작성 매뉴얼 다 박아」 · 「매뉴얼에 좀 박아두고」 · 「각 공급사 이제 진짜로 통일하자」
 *   (「정책 작성법」 탭만 따로 두는 건 「필요가 없지」 — 그래서 재고·정책을 한 장에 담는다.)
 *   내용은 코드 정본에서 나온다 — 재고 칸: `supplier-template-sheet.TEMPLATE_COLUMNS`(사장님 확정 차례·메모·드롭다운값),
 *   정제칸: `AI_TAIL_COLUMNS`, 정책 표기: `policy-guide.POLICY_WRITING_PRINCIPLES` + `policy-value-spec`. 여기서 새 규칙을 적지 않는다.
 * ⚠ 이 탭은 기계가 통째로 다시 쓴다(사람이 적는 칸이 없다). 재고·정책 탭 값은 건드리지 않는다.
 *
 *   npx tsx scripts/publish-supplier-guide-tab.mts
 *   npx tsx scripts/publish-supplier-guide-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { AI_TAIL_COLUMNS, SHEET_NAME_MATCH, TEMPLATE_COLUMNS, VALUE_LISTS, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { POLICY_WRITING_PRINCIPLES } from '../lib/domain/policy-guide';
import { POLICY_SHEET_FIELDS, USE_LABEL } from '../lib/domain/policy-sheet-layout';
import { POLICY_VALUE_RULE_BY_NAME } from '../lib/domain/policy-value-spec';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';
import { MAKER_STANDARD_NOTE } from '../lib/domain/maker-display';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { AI_TOUCH_RULES } from '../lib/domain/ai-touch-rules';
import { SHEET_READING_RULES } from '../lib/domain/sheet-reading-rules';
import { VEHICLE_REFINE_FLOW } from '../lib/domain/vehicle-refine-flow';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const TAB = '작성 안내';

const rows: string[][] = [];
const R = (...c: string[]) => rows.push([c[0] || '', c[1] || '', c[2] || '', c[3] || '']);
R('프리패스 재고 시트 — 작성 안내', '', '', '');
R('', '이 시트 한 장이 프리패스 영업자 표와 계약서로 그대로 갑니다. 「재고」 탭에 차를, 「정책」 탭에 조건을 적어 주시면 됩니다. 아래 칸 설명과 표기 규격대로 적어 주세요.', '', '');
R('', '보라색 칸(정책코드 오른쪽: 모델행키~차종구분 · ERP 차종코드 · 선택옵션 · 외장/내장)은 프리패스가 채웁니다 — 손대지 않으셔도 됩니다. 엔카 키·기본스펙은 아는 층만 넣고, 모르면 비웁니다.', '', '');
R('', '', '', '');
// ★0. 이 시트가 읽히는 방식(사장님 2026-08-19 「공급사 시트를 댕겨오기 쉽게 만들어 놓고 매뉴얼화」) — 정본 lib/domain/sheet-reading-rules.ts
R('0. 이 시트가 읽히는 방식 — 이것만 지키면 됩니다', '', '', '');
R('무엇', '어떻게', '왜', '');
for (const r of SHEET_READING_RULES) R(r.what, r.how, r.why, '');
R('', '', '', '');
R('1. 재고 탭 — 칸 차례대로', '', '', '');
R('칸', '무엇을 적나 / 예시', '고르는 값(드롭다운)', '비고');
for (const c of TEMPLATE_COLUMNS) {
  if ((c as { divider?: boolean }).divider) { R(c.name, c.note, "", "구분선"); continue; }
  R(c.name, c.note, (VALUE_LISTS[c.name] || []).join(" / "), c.required ? "필수" : "");
  // ★사장님 2026-08-18 — 「제조사는 르노라고만 하고 KGM — 매뉴얼에 박아서 모든 시트 통일」
  if (c.name === '제조사') R('', `⚠ ${MAKER_STANDARD_NOTE} 다르게 적혀 있으면 프리패스가 이 이름으로 바꿉니다.`, '', '');
}
R('', '', '', '');
R('2. 프리패스가 채우는 칸(정제칸) — 공급사는 비워 두세요', '', '', '');
for (const c of AI_TAIL_COLUMNS) R(c.name, c.note, '', '프리패스');
R('', '', '', '');
R('2-1. AI(프리패스 자동화)가 적고 만지는 칸 — 규칙', '', '', '');
R('무엇', '어떻게', '언제', '');
for (const r of AI_TOUCH_RULES) R(r.what, r.how, r.when, '');
R('', '', '', '');
R('2-2. 차명 정제 흐름 — 엔카 차종마스터 → 공급사 행키+기본스펙 → 상품시트', '', '', '');
R('단계', '무엇을', '어디서/명령', '');
for (const f of VEHICLE_REFINE_FLOW) R(f.step, f.what, f.where, '');
R('', '', '', '');
R('3. 탭 규칙', '', '', '');
R('', '「재고」 한 탭에 렌트 차를 다 적습니다. 구독 상품이 따로 있으면 「구독재고」 탭 — 앞쪽 칸(차량번호~차량가격)은 재고와 같고 대여료 칸만 「보증금 인수형·12~60개월 인수형 / 보증금 반납형·12~60개월 반납형」입니다(손오공 방식).', '', '');
R('', '다른 기간을 팔면 「기타기간①②③」 칸의 제목을 「6개월」처럼 바꿔 쓰세요(보증금은 장기보증 적용). 열을 새로 만들거나 자리를 옮기지 마세요 — 열 이름으로 읽어 갑니다.', '', '');
R('', '팔지 않는 차는 행을 지우지 말고 「상태」를 출고불가로. 행 숨김도 «안 파는 차»로 봅니다.', '', '');
R('', '', '', '');
R('4. 정책 탭 — 한 줄이 정책 하나', '', '', '');
R('', '첫 줄 「(프리패스 기본)」은 프리패스 기본 정책, 그 아래가 귀사 정책(정책코드별). 재고 탭 「정책코드」가 이 줄을 가리킵니다. 대부분 드롭다운으로 고르면 되고, 머리글 메모(빨간 삼각형)에 칸별 규격이 있습니다.', '', '');
POLICY_WRITING_PRINCIPLES.forEach((p, i) => R('', `${i + 1}. ${p}`, '', ''));
R('', '', '', '');
R('항목', '무엇을 적나', '표기 규격', '고르는 값');
for (const f of POLICY_SHEET_FIELDS) { const rule = POLICY_VALUE_RULE_BY_NAME[f.name]; R(`${f.name} [${USE_LABEL[f.use]}]`, f.note, rule?.format || '자유 서술', (rule?.allowed || []).join(' / ')); }
R('', '', '', '');
R('5. 시트 권한', '', '', '');
R('', '팀제이피케이 주식회사(teamjpk.com)는 모든 시트를 보고 편집합니다. 이 시트는 링크를 가진 분이 편집할 수 있으니 링크는 담당자에게만 주세요.', '', '');
R('', `마지막 갱신 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST · npx tsx scripts/publish-supplier-guide-tab.mts --apply`, '', '');

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
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
/**
 * ★정제시트(아이카·오토플러스·이안카·아이언 — `mirror-sources`)는 뺀다(사장님 2026-08-18 — 「직접 입력하는 거는 직접 입력하면 되고
 *   그게 아니면 매뉴얼탭을 다 만들어줘」). 거긴 공급사가 적는 시트가 아니라 «여기에 적어 주세요»가 틀린 말이다 —
 *   `publish-mirror-guide-tab` 이 「정제시트 안내」를 둔다.
 */
const mirrored = new Set(MIRROR_SOURCES.map((m) => m.to));
const skipped = targets.filter((t) => mirrored.has(t.id));
for (let i = targets.length - 1; i >= 0; i--) if (mirrored.has(targets[i].id)) targets.splice(i, 1);
if (skipped.length) console.log(`  (정제시트라 건너뜀: ${skipped.map((t) => t.name).join(' · ')} — 「정제시트 안내」는 publish-mirror-guide-tab)`);
console.log(`■ 「${TAB}」 탭 ${APPLY ? '반영' : '미리보기'} · 대상 ${targets.length}곳 · ${rows.length}줄`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties`);
  const props = (meta.sheets || []).map((x: Rec) => x.properties);
  let gid = props.find((p: Rec) => S(p.title) === TAB)?.sheetId;
  if (gid === undefined) {
    // 맨 뒤(보이는 탭 끝)에 둔다 — 재고·정책 탭이 앞이어야 공급사가 헤매지 않는다.
    const added = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 10, columnCount: 4 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'!A1:Z${Math.max(400, rows.length + 50)}`)}:clear`, { method: 'POST', body: '{}' });
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
  const reqs: Rec[] = [
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    ...[190, 520, 320, 90].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('DFF3E4') }, fields: 'tabColor' } },
  ];
  for (const [i, r] of rows.entries()) if (r[0] && i !== 0 && /^\d\./.test(r[0])) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  console.log(`  ✓ ${t.name}`);
}
console.log('반영 완료');
