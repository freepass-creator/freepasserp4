/**
 * **상품리스트 연동 계약서를 «코드에서» 뽑아 찍는다** — 읽기 전용(시트·ERP 를 건드리지 않는다).
 *
 * ★왜(사장님 2026-08-22 「이걸 어떻게 연동해야 하는지 코덱스나 다른 AI 가 알 수 있게 해줘 ·
 *   상품리스트에 어떻게 연동하고 뭘 데이터를 가져가야 하는지」)
 *   사람이 손으로 적은 표는 코드가 바뀌면 조용히 거짓말이 된다. 이 명령은 **지금 코드가 진짜로 하는 일**을 찍는다.
 *   문서(`docs/상품리스트-연동.md`)는 «왜·어떤 차례»를 적고, «무엇이 무엇이 되는가»는 여기서 확인한다.
 *
 *   npx tsx scripts/print-sync-contract.mts
 *   npx tsx scripts/print-sync-contract.mts --md    # 문서에 붙일 마크다운 표
 */
import { SALES_MAPPING, SALES_COLUMNS, SALES_RETIRED_COLUMNS } from '../lib/domain/sales-sheet-mapping';
import { HEADER_ALIASES, autoMapHeaders } from '../lib/domain/sheet-import';
import { AI_TAIL_COLUMNS, TEMPLATE_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { LEFT_COLUMNS, RIGHT_COLUMNS, CENTER_COLUMNS } from '../lib/domain/sales-sheet-format';

const MD = process.argv.includes('--md');
const S = (v: unknown) => String(v ?? '').trim();

/** 판매시트 열 → ERP 필드. 자동매핑을 실제 열 차례로 돌려 «먼저 잡는 열»까지 그대로 재현한다. */
const erpByColumn = (() => {
  const map = autoMapHeaders([...SALES_COLUMNS]) as Record<string, number | undefined>;
  const out = new Map<string, string[]>();
  for (const [field, idx] of Object.entries(map)) {
    if (idx == null) continue;
    const col = SALES_COLUMNS[idx];
    out.set(col, [...(out.get(col) || []), field]);
  }
  return out;
})();

const alignOf = (col: string) =>
  (LEFT_COLUMNS.includes(col) ? '왼쪽' : RIGHT_COLUMNS.includes(col) ? '오른쪽' : CENTER_COLUMNS.includes(col) ? '가운데' : '가운데(기본)');

const refinedNames = new Set(AI_TAIL_COLUMNS.map((c) => c.name));
const supplierNames = new Set(TEMPLATE_COLUMNS.map((c) => (typeof c === 'string' ? c : S((c as { name?: string }).name))));

/** 이 판매시트 열은 공급사 시트의 어느 칸에서 오는가 — 정제칸인지 공급사 원문인지 표시한다. */
function sourceOf(cands: string[]): string {
  if (!cands.length) return '(정책 탭·문패에서 만든다)';
  return cands.map((c) => {
    if (refinedNames.has(c)) return `${c}⟨정제칸⟩`;
    if (supplierNames.has(c)) return `${c}⟨공급사 원문⟩`;
    return c;
  }).join(' → ');
}

if (MD) {
  console.log('| # | 판매시트 열 | 공급사 시트에서 오는 칸(먼저 맞는 것) | ERP 필드 | 정렬 |');
  console.log('|---|---|---|---|---|');
  SALES_MAPPING.forEach(([col, cands], i) => {
    const erp = (erpByColumn.get(col) || []).join(' · ') || '—';
    console.log(`| ${i + 1} | ${col} | ${sourceOf(cands)} | ${erp} | ${alignOf(col)} |`);
  });
  console.log(`\n뺀 열(발행기가 세우지 않음): ${SALES_RETIRED_COLUMNS.join(' · ')}`);
} else {
  console.log(`■ 상품리스트 연동 계약 — 판매시트 ${SALES_COLUMNS.length}열\n`);
  console.log('공급사 정제시트 ──(publish-origin-tab)──▶ 중앙 판매시트 3탭 ──(sheet-daily-sync)──▶ ERP(v4/products)\n');
  console.log('열'.padEnd(3) + '판매시트 열'.padEnd(18) + '← 공급사 칸'.padEnd(44) + 'ERP 필드'.padEnd(18) + '정렬');
  console.log('─'.repeat(104));
  SALES_MAPPING.forEach(([col, cands], i) => {
    const erp = (erpByColumn.get(col) || []).join(' · ') || '—';
    console.log(
      String(i + 1).padEnd(3)
      + col.padEnd(18)
      + sourceOf(cands).slice(0, 42).padEnd(44)
      + erp.padEnd(18)
      + alignOf(col),
    );
  });
  console.log(`\n뺀 열(발행기가 세우지 않는다): ${SALES_RETIRED_COLUMNS.join(' · ')}`);
  console.log(`정제칸 ${AI_TAIL_COLUMNS.length}개: ${AI_TAIL_COLUMNS.map((c) => c.name).join(' · ')}`);
  const unmapped = SALES_COLUMNS.filter((c) => !erpByColumn.has(c));
  console.log(`\nERP 로 안 가는 판매시트 열 ${unmapped.length}개(영업자 표시·정책 전용): ${unmapped.join(' · ')}`);
  console.log(`\nHEADER_ALIASES 총 ${Object.keys(HEADER_ALIASES).length}개 별칭 — 판매시트가 아닌 이름(공급사 원문 헤더)도 여기서 ERP 필드로 간다.`);
}
