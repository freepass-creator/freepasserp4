/**
 * **축 레지스트리 ↔ 흩어진 여섯 곳이 같은지 강제한다.** 순수 검사 — Google·ERP 를 읽지 않는다.
 *
 * ★왜(사장님 2026-08-22 「그럼 오류 없게끔 만들어줘」)
 *   열 하나를 세우려면 여섯 곳을 고쳐야 하는데 사람도 AI 도 다 못 챙긴다(실제로 하루에 두 번 빠뜨렸다).
 *   이제 `lib/domain/sales-axis-registry.SALES_AXES` 한 줄만 맞게 적으면, 어느 한 곳을 빼먹었을 때 **여기서 걸린다.**
 *
 *   npx tsx scripts/check-sales-axes.mts
 */
import { SALES_AXES, RETIRED_AXES } from '../lib/domain/sales-axis-registry';
import { SALES_COLUMNS, SALES_RETIRED_COLUMNS } from '../lib/domain/sales-sheet-mapping';
import { LEFT_COLUMNS, RIGHT_COLUMNS, CENTER_COLUMNS } from '../lib/domain/sales-sheet-format';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { autoMapHeaders } from '../lib/domain/sheet-import';
import { ENTITIES } from '../lib/intake/entities';
import { HEADERS as INVENTORY_HEADERS, TABLE_COLUMNS as INVENTORY_TABLE } from '../lib/domain/inventory-sheet-export';

let bad = 0;
const fail = (what: string, detail: string) => { bad++; console.log(`  ✗ ${what.padEnd(22)} ${detail}`); };
const ok = (what: string, detail = '') => console.log(`  ✓ ${what.padEnd(22)} ${detail}`);

console.log('■ 축 레지스트리 대조 — 선언 한 줄이 여섯 곳에 다 반영됐나\n');

// ① 판매시트 열에 서 있나
for (const axis of SALES_AXES) {
  if (!SALES_COLUMNS.includes(axis.column)) {
    fail(`열 없음 ${axis.column}`, 'SALES_MAPPING 에 줄을 넣어라 — 없으면 ERP 로 영영 안 간다');
  }
}
if (!bad) ok('판매시트 열', `${SALES_AXES.length}축 전부 서 있다`);

// ② 정렬이 선언과 같나 — 안 넣으면 «조용히 가운데»로 떨어진다(세부모델·세부트림이 실제로 그랬다)
const alignBefore = bad;
for (const axis of SALES_AXES) {
  const actual = LEFT_COLUMNS.includes(axis.column) ? 'left'
    : RIGHT_COLUMNS.includes(axis.column) ? 'right'
      : CENTER_COLUMNS.includes(axis.column) ? 'center' : 'center(기본값)';
  const want = axis.align;
  if (actual !== want && !(want === 'center' && actual === 'center(기본값)')) {
    fail(`정렬 ${axis.column}`, `선언 ${want} ≠ 실제 ${actual} — sales-sheet-format 의 ${want === 'left' ? 'LEFT' : want === 'right' ? 'RIGHT' : 'CENTER'}_COLUMNS 에 넣어라`);
  }
}
if (bad === alignBefore) ok('정렬', '선언과 서식이 같다');

// ③ ERP 필드가 선언과 같나 — 별칭이 없으면 값이 통째로 버려진다(차종코드가 6,605대 중 0건이었다)
const erpBefore = bad;
const mapped = autoMapHeaders([...SALES_COLUMNS]) as Record<string, number | undefined>;
const fieldOfColumn = new Map<string, string>();
for (const [field, idx] of Object.entries(mapped)) {
  if (idx == null) continue;
  fieldOfColumn.set(SALES_COLUMNS[idx], field);
}
for (const axis of SALES_AXES) {
  const actual = fieldOfColumn.get(axis.column) || null;
  if (axis.erpField !== actual) {
    fail(`ERP 필드 ${axis.column}`, `선언 ${axis.erpField ?? '(없음)'} ≠ 실제 ${actual ?? '(안 잡힘)'} — sheet-import 의 HEADER_ALIASES 를 보라`);
  }
}
if (bad === erpBefore) ok('ERP 필드', '판매시트 열이 선언한 필드로 잡힌다');

// ④ 정제칸 선언이 실제 정제칸 목록과 같나
const refinedBefore = bad;
const refinedNames = new Set(AI_TAIL_COLUMNS.map((c) => c.name));
for (const axis of SALES_AXES) {
  if (!axis.fromRefined) continue;
  // 정제칸 이름은 레지스트리가 안다(refinedColumn) — 검사 스크립트마다 따로 적지 않는다.
  const name = axis.refinedColumn ?? axis.column;
  if (name && !refinedNames.has(name)) {
    fail(`정제칸 ${axis.column}`, `「${name}」이 AI_TAIL_COLUMNS 에 없다 — add-supplier-ai-columns 로 칸부터 만들어라`);
  }
}
if (bad === refinedBefore) ok('정제칸', '정제 축이 전부 AI_TAIL_COLUMNS 에 있다');

// ⑤ 재고관리 편집 칸(entities)에 그 필드가 있나 — 없으면 사람이 ERP 값을 고칠 길이 없다
const entBefore = bad;
const productFields = new Set((ENTITIES.product.fields as { key: string }[]).map((f) => f.key));
for (const axis of SALES_AXES) {
  if (!axis.erpField) continue;
  if (!productFields.has(axis.erpField)) {
    fail(`재고관리 칸 ${axis.column}`, `entities.product 에 ${axis.erpField} 가 없다 — 사람이 고칠 길이 없다`);
  }
}
if (bad === entBefore) ok('재고관리 편집 칸', '축마다 고칠 칸이 있다');

/**
 * ⑥ 폐지 축이 되살아나지 않았나 — **판매시트와 재고관리 내보내기 시트 둘 다** 본다.
 *   (사장님 2026-08-23 「우리 재고관리 시트를 개선된 시트를 반영해야 함 · 오류 안 나게 만드는 게 관건」)
 *   실제로 판매시트에서 파워트레인을 뺀 뒤에도 재고관리 내보내기엔 「파워」 열이 그대로 살아 있었다.
 *   한쪽만 보는 검사는 «치웠다»는 착각을 만든다.
 */
const retiredBefore = bad;
const INV_ALIAS: Record<string, string[]> = { 파워트레인: ['파워', '파워트레인'], 차대번호: ['차대번호'], 추가표기: ['추가표기'] };
for (const r of RETIRED_AXES) {
  for (const name of (INV_ALIAS[r.column] || [r.column])) {
    if (INVENTORY_HEADERS.includes(name)) fail(`재고관리 시트 폐지 축 ${name}`, `${r.why} — inventory-sheet-export.HEADERS`);
    if (INVENTORY_TABLE.includes(name)) fail(`재고관리 표 폐지 축 ${name}`, `${r.why} — inventory-sheet-export.TABLE_COLUMNS`);
  }
  if (SALES_COLUMNS.includes(r.column)) fail(`폐지 축 부활 ${r.column}`, r.why);
  if (!SALES_RETIRED_COLUMNS.includes(r.column) && r.column !== '추가표기') {
    fail(`폐지 미등록 ${r.column}`, 'SALES_RETIRED_COLUMNS 에 적어야 시트 @매핑에서도 안 선다');
  }
}
if (bad === retiredBefore) ok('폐지 축', RETIRED_AXES.map((r) => r.column).join(' · ') + ' — 되살아나지 않았다');

console.log(`\n  축 ${SALES_AXES.length} · 어긋남 ${bad}`);
if (bad) {
  console.log('\n  ⛔ 선언과 코드가 다르다. `lib/domain/sales-axis-registry.ts` 가 «무엇이 맞는지»를 적은 곳이다 —');
  console.log('     선언이 맞으면 코드를 고치고, 코드가 맞으면 선언을 고쳐라. 둘 다 안 고치고 넘어가지 마라.');
  process.exit(1);
}
console.log('  ✓ 축 선언과 코드 여섯 곳이 전부 같다');
