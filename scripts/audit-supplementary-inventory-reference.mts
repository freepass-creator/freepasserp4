/** 오플·손오공 보완 시트와 고정된 Firestore 판매 스냅샷을 읽기 전용으로 대조한다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compareSupplementaryInventoryReference } from '../lib/domain/supplementary-inventory-reference';
import { getInventorySource } from '../lib/domain/inventory-source-registry';
import { isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { tabOf } from '../lib/domain/sales-atom-row';
import { findPlateAndStatusColumns } from '../lib/domain/supplier-sheet-read';
import { readSheetGrid } from '../lib/server/google-sheets';
import { readSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';

const S = (value: unknown) => String(value ?? '').trim();
const arg = (name: string) => (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const snapshotPath = arg('snapshot');
if (!snapshotPath) throw new Error('--snapshot=... 필요');
const snapshot = readSalesPublishSnapshot(snapshotPath);

const definitions = [
  { code: 'RP012', sheetTab: '구독재고', canonicalTab: '손오공상품' },
  { code: 'RP012', sheetTab: '픽업재고', canonicalTab: '픽업구독' },
  { code: 'RP023', sheetTab: '재고', canonicalTab: '오플구독' },
] as const;

const results = [];
for (const definition of definitions) {
  const source = getInventorySource(definition.code);
  const spreadsheetId = source.projection?.spreadsheetId;
  if (!spreadsheetId || !source.projection?.tabs?.includes(definition.sheetTab)) {
    throw new Error(`보완참조 위치 미등록: ${definition.code}/${definition.sheetTab}`);
  }
  const grid = await readSheetGrid(spreadsheetId, definition.sheetTab);
  const columns = findPlateAndStatusColumns(grid.header);
  if (columns.plate < 0 || columns.status < 0) throw new Error(`보완참조 필수 열 없음: ${definition.code}/${definition.sheetTab}`);
  const referenceKeys = grid.rows
    .filter((row) => !/출고불가|판매완료|종료|삭제/.test(S(row[columns.status])))
    .map((row) => row[columns.plate]);
  const canonicalKeys = snapshot.products
    .filter((product) => S(product.provider_company_code) === definition.code)
    .filter((product) => isOpenInventoryAtom(product))
    .filter((product) => tabOf(product) === definition.canonicalTab)
    .map((product) => product.car_number);
  results.push({
    partnerCode: definition.code,
    referenceTab: definition.sheetTab,
    canonicalTab: definition.canonicalTab,
    readAt: grid.readAt,
    ...compareSupplementaryInventoryReference(referenceKeys, canonicalKeys),
  });
}
const receipt = { schema: 'supplementary-inventory-reference/v1', snapshotId: snapshot.snapshotId, observedAt: new Date().toISOString(), results };
const output = arg('out') || `tmp/supplementary-reference/${snapshot.snapshotId}.json`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(receipt, null, 2), 'utf8');
for (const result of results) console.log(`${result.status} ${result.partnerCode}/${result.referenceTab}: 참조 ${result.referenceCount} · 새 원천 ${result.canonicalCount} · 공통 ${result.sharedCount} · 참조만 ${result.referenceOnlyCount} · 새 원천만 ${result.canonicalOnlyCount} · 참조중복 ${result.duplicateReferenceKeys}`);
console.log(`✓ 보완참조 관측 증거 저장 — 새 원천 발행 판정에는 사용하지 않음 · ${output}`);
