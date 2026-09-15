import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atomDisplayResult, atomDisplayText, isAtomDisplayPlaceholder } from '../lib/domain/missing-value-display';
import { excelColFilterMatch, excelPopEntries } from '../lib/domain/excel-col-filter';

assert.equal(atomDisplayText('mileage', 0, {}), '0');
assert.deepEqual(atomDisplayResult('옵션(원문)', '', { option_evidence_status: 'PASS' }), { state: 'missing', text: '미입력' });
assert.deepEqual(atomDisplayResult('옵션(원문)', '', { option_explicit_none: true }), { state: 'none', text: '없음' });
assert.equal(atomDisplayText('옵션(원문)', '없음', {}), '없음');
assert.equal(atomDisplayText('배기량', '', { fuel_type: '전기' }), '해당없음');
assert.equal(atomDisplayText('배터리용량', '', { fuel_type: '가솔린' }), '해당없음');
assert.equal(atomDisplayText('배터리용량', '', { fuel_type: '플러그인 하이브리드' }), '미입력');
assert.equal(isAtomDisplayPlaceholder('options', '없음'), false);
assert.equal(isAtomDisplayPlaceholder('자차', '없음'), false);
const filterRows = [
  { mileage: '', product_type: '', fuel_type: '', maker: '', trim_name: '' },
  { mileage: 0, product_type: '중고렌트', fuel_type: '가솔린', maker: '현대', trim_name: '모던' },
] as any[];
assert.equal(excelPopEntries('mileage', filterRows)?.find((entry) => entry.key === '미입력')?.count, 1);
assert.equal(excelColFilterMatch(filterRows[0], 'mileage', new Set(['미입력'])), true);
assert.equal(excelColFilterMatch(filterRows[1], 'mileage', new Set(['미입력'])), false);
assert.equal(excelPopEntries('product_type', filterRows)?.some((entry) => entry.key === '미입력'), true);
assert.equal(excelPopEntries('maker', filterRows)?.some((entry) => entry.key === '미입력'), true);
assert.deepEqual(atomDisplayResult('options', '해당없음', {}), { state: 'none', text: '없음' });

const publisher = readFileSync('scripts/make-sample-sheet-google.mts', 'utf8');
assert.match(publisher, /atomDisplayText\(col, direct\[col\], v\)/);
assert.match(publisher, /원문'\]\?\.\['옵션'\]\) \|\| S\(v\.options\)/);
assert.doesNotMatch(publisher, /firebase-admin\/database|databaseURL|getDatabase\(|\.ref\(/);
const optionUi = readFileSync('components/product-card-options.tsx', 'utf8');
assert.match(optionUi, /atomDisplayResult\('options', p\.options, p\)/);
const excelUi = readFileSync('features/finder/ExcelResultsTable.tsx', 'utf8');
assert.match(excelUi, /clamp2\('trim_name', p\.trim_name/);
assert.match(excelUi, /<OptionChips p=\{p\} lines=\{2\} \/>/);
const excelColumns = readFileSync('features/finder/excel-columns.ts', 'utf8');
assert.match(excelColumns, /atomDisplayResult\(key, product\.options, product\)/);
const productsApi = readFileSync('app/api/products/route.ts', 'utf8');
assert.match(productsApi, /collection\('products'\)/);
assert.match(productsApi, /named\.map\(stripProductCost\)/);
assert.doesNotMatch(productsApi, /firebaseAdminDatabase|firebase-admin\/database|\.ref\(/);
const sheetApi = readFileSync('app/api/products/sheet/route.ts', 'utf8');
assert.match(sheetApi, /collection\('products'\)/);
assert.match(sheetApi, /collection\('partner'\)/);
assert.doesNotMatch(sheetApi, /firebaseAdminDatabase|firebase-admin\/database|\.ref\(/);
const finderStore = readFileSync('features/finder/finder-data-store.ts', 'utf8');
assert.match(finderStore, /fetchFirestoreProducts\(\)/);
assert.match(finderStore, /meta\.fromCache/);
assert.match(finderStore, /entry\.requestId === streamId/);
assert.doesNotMatch(finderStore, /Firestore 실패 → RTDB 폴백/);
assert.doesNotMatch(finderStore, /NEXT_PUBLIC_FINDER_FROM_FIRESTORE|finderFromFirestoreEnabled/);
const firebaseAdmin = readFileSync('lib/server/firebase-admin.ts', 'utf8');
const gateBlock = firebaseAdmin.slice(firebaseAdmin.indexOf('async function readGateProfile'), firebaseAdmin.indexOf('export async function verifyActiveBearer'));
assert.match(gateBlock, /collection\('user'\)/);
assert.doesNotMatch(gateBlock, /AUTH_GATE_FROM_FIRESTORE|getDatabase\(|\.ref\(/);
const detailPage = readFileSync('app/erp5/products/[code]/page.tsx', 'utf8');
assert.match(detailPage, /String\(value \?\? ''\)/);

console.log('✓ 미입력/없음/해당없음 표시·필터·역유입·Firestore-only 조회/발행 계약 통과');
