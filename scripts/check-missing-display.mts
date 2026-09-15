import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atomDisplayResult, atomDisplayText, isAtomDisplayPlaceholder } from '../lib/domain/missing-value-display';

assert.equal(atomDisplayText('mileage', 0, {}), '0');
assert.deepEqual(atomDisplayResult('옵션(원문)', '', { option_evidence_status: 'PASS' }), { state: 'missing', text: '미입력' });
assert.deepEqual(atomDisplayResult('옵션(원문)', '', { option_explicit_none: true }), { state: 'none', text: '없음' });
assert.equal(atomDisplayText('옵션(원문)', '없음', {}), '없음');
assert.equal(atomDisplayText('배기량', '', { fuel_type: '전기' }), '해당없음');
assert.equal(atomDisplayText('배터리용량', '', { fuel_type: '가솔린' }), '해당없음');
assert.equal(atomDisplayText('배터리용량', '', { fuel_type: '플러그인 하이브리드' }), '미입력');
assert.equal(isAtomDisplayPlaceholder('options', '없음'), false);
assert.equal(isAtomDisplayPlaceholder('자차', '없음'), false);

const publisher = readFileSync('scripts/make-sample-sheet-google.mts', 'utf8');
assert.match(publisher, /atomDisplayText\(col, direct\[col\], v\)/);
assert.match(publisher, /원문'\]\?\.\['옵션'\]\) \|\| S\(v\.options\)/);
assert.doesNotMatch(publisher, /firebase-admin\/database|databaseURL|getDatabase\(|\.ref\(/);
const optionUi = readFileSync('components/product-card-options.tsx', 'utf8');
assert.match(optionUi, /atomDisplayResult\('options', p\.options, p\)/);

console.log('✓ 미입력/없음/해당없음 표시·역유입·Firestore-only 발행 계약 통과');
