/**
 * 「ERP4 차종마스터 원천대장」 서식 정합 — 글꼴 9pt · 행 22px · 구분 열 글자색.
 *
 * ★사장님 2026-08-18 — 「차종마스터 전체 글씨 크기가 영업자가 보는 건 아니니까 전체 9로」
 *   「글씨 줄인 애들은 간격도 조정」 · 「규격검토 페이지 연료랑 제조사 제조국 … 글씨 색깔을 좀 다르게」
 * 값·수식·굵기·배경은 건드리지 않는다(값 write 0). 규칙은 `lib/domain/vehicle-master-sheet-format` 이 정본이다.
 *
 *   npx tsx scripts/format-vehicle-master-sheet.mts            # dry-run
 *   npx tsx scripts/format-vehicle-master-sheet.mts --apply
 *   npx tsx scripts/format-vehicle-master-sheet.mts --apply --tab=차종마스터_규격검토
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID } from '../lib/domain/product-master-sheet';
import {
  MASTER_CATEGORY_COLORS, MASTER_FONT, MASTER_FONT_SIZE, MASTER_ROW_PX,
  masterCategoryColorRequests, masterFontRequest, masterRowHeightRequest,
} from '../lib/domain/vehicle-master-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
const ONLY = arg('tab');
/** 글을 줄바꿈해 읽는 안내 탭 — 행 높이를 고정하지 않고 내용에 맞춘다. */
const TEXT_TABS = new Set(['사용안내', '공급사 데이터 매뉴얼', '공급사 열 매핑', '차종마스터_매뉴얼']);
/**
 * 구분색을 거는 탭. 사장님이 지목한 규격검토만(규격채택은 채택기가 건 상태 규칙 3개가 있어 제외).
 * ⚠ 차종마스터·상품마스터는 이미 조건부서식(검수 강조 등)이 42·15개 걸려 있다 — 여기서 지우면 안 된다.
 *   구분색은 기존 규칙을 교체하는 방식이라 규칙 0개인 탭에만 건다.
 */
const COLOR_TABS = new Set((arg('color-tabs', '차종마스터_규격검토')).split(',').map(S).filter(Boolean));
/** 규격채택 탭은 머리글이 `규격_연료`처럼 접두가 붙는다 — 접두를 떼고 같은 색표를 쓴다. */
const colorKey = (header: string) => header.replace(/^규격_/, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const token = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(120_000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : {};
};
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const meta = await api(`${base}?fields=properties(title),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)),conditionalFormats)`);
const sheets = (meta.sheets || []).filter((s: Rec) => !ONLY || S(s.properties.title) === ONLY);
if (!sheets.length) throw new Error(`탭 없음: ${ONLY}`);

const requests: Rec[] = [];
const summary: string[] = [];
for (const s of sheets) {
  const p = s.properties;
  const rows = Number(p.gridProperties.rowCount), cols = Number(p.gridProperties.columnCount);
  requests.push(masterFontRequest(p.sheetId, rows, cols));
  let note = `${MASTER_FONT} ${MASTER_FONT_SIZE}pt`;
  if (TEXT_TABS.has(S(p.title))) {
    requests.push({ autoResizeDimensions: { dimensions: { sheetId: p.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows } } });
    note += ' · 행 자동맞춤';
  } else {
    requests.push(masterRowHeightRequest(p.sheetId, rows));
    note += ` · 행 ${MASTER_ROW_PX}px`;
  }
  // 구분 열 글자색 — 머리글에 해당 열이 있는 탭만.
  const head = await api(`${base}/values/${encodeURIComponent(`'${p.title}'!1:1`)}`);
  const headers = ((head.values || [[]])[0] as unknown[]).map(S);
  const colored = COLOR_TABS.has(S(p.title)) ? headers.filter((h) => MASTER_CATEGORY_COLORS[colorKey(h)]) : [];
  if (colored.length) {
    if ((s.conditionalFormats || []).length && !process.argv.includes('--replace-rules')) {
      throw new Error(`${p.title}: 기존 조건부서식 ${(s.conditionalFormats || []).length}개가 있어 구분색을 덧씌우지 않음(--replace-rules 로 교체 가능)`);
    }
    const rules = masterCategoryColorRequests({ sheetId: p.sheetId, headers: headers.map(colorKey), rowCount: rows, existingRuleCount: (s.conditionalFormats || []).length });
    requests.push(...rules);
    note += ` · 구분색 ${colored.join('/')} (규칙 ${rules.filter((r) => r.addConditionalFormatRule).length}, 기존 ${(s.conditionalFormats || []).length} 교체)`;
  }
  summary.push(`  ${p.hidden ? '(숨김) ' : ''}${p.title} ${rows}×${cols} — ${note}`);
}
console.log(`${meta.properties?.title} · 탭 ${sheets.length}개 · 요청 ${requests.length}건`);
console.log(summary.join('\n'));
if (!APPLY) { console.log('dry-run — 반영하려면 --apply'); process.exit(0); }
// 한 번에 보내면 커서 오래 걸린다 — 탭 단위 묶음으로 나눠 보낸다.
for (let i = 0; i < requests.length; i += 400) {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: requests.slice(i, i + 400) }) });
}
const check = await api(`${base}?fields=sheets(properties(title),conditionalFormats,data(rowMetadata(pixelSize),rowData(values(effectiveFormat(textFormat(fontFamily,fontSize))))))&ranges=${sheets.map((s: Rec) => encodeURIComponent(`'${s.properties.title}'!A2:A3`)).join('&ranges=')}`);
for (const s of check.sheets || []) {
  const tf = s.data?.[0]?.rowData?.[0]?.values?.[0]?.effectiveFormat?.textFormat || {};
  console.log(`  ✓ ${s.properties.title}: ${tf.fontFamily} ${tf.fontSize} · 행 ${(s.data?.[0]?.rowMetadata || []).map((r: Rec) => r.pixelSize).join('/')}px · 조건부서식 ${(s.conditionalFormats || []).length}`);
}
console.log('반영 완료 — 값 write 0');
