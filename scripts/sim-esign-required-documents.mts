import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_ESIGN_REQUIRED_DOCUMENTS,
  esignDocumentPreset,
  normalizeEsignRequiredDocuments,
  policyEsignRequiredDocuments,
  serializeEsignRequiredDocuments,
} from '../lib/domain/esign-required-documents';

const personal = esignDocumentPreset('personal-basic');
assert.equal(personal.length, 2);
assert.equal(personal.every((row) => row.required), true);
assert.equal(policyEsignRequiredDocuments({ esign_required_documents: serializeEsignRequiredDocuments(personal) }).length, 2);
assert.deepEqual(normalizeEsignRequiredDocuments('깨진 JSON'), []);
assert.equal(normalizeEsignRequiredDocuments([
  { key: 'same', label: '등본', required: true },
  { key: 'same', label: '가족관계', required: false },
]).map((row) => row.key).join('|'), 'same|same_2');
assert.equal(normalizeEsignRequiredDocuments(Array.from({ length: 20 }, (_, index) => ({
  key: `doc_${index}`, label: `서류 ${index}`, required: true,
}))).length, MAX_ESIGN_REQUIRED_DOCUMENTS);

const read = (path: string) => readFileSync(path, 'utf8');
const server = read('lib/server/freepass-esign.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const uploadRoute = read('app/api/freepass-esign/public/[token]/supporting-document/[docKey]/route.ts');
const assetRoute = read('app/api/freepass-esign/contracts/[contractCode]/asset/[kind]/route.ts');
const customerPage = read('app/sign/[token]/page.tsx');
const policyPage = read('app/policy/page.tsx');

assert.match(server, /const requiredDocuments = policyEsignRequiredDocuments\(args\.policy\)/);
assert.match(uploadRoute, /MAX_SUPPORTING_DOCUMENT_BYTES = 5_000_000/);
assert.match(uploadRoute, /사진\(JPG·PNG·WEBP·HEIC\) 또는 PDF/);
assert.match(uploadRoute, /supportingUploads/);
assert.match(uploadRoute, /\['sent', 'opened'\]\.includes\(S\(current\.status\)\)/);
assert.match(publicRoute, /필수 첨부서류를 제출해 주세요/);
assert.match(publicRoute, /supporting_documents: supportingDocuments/);
assert.match(publicRoute, /required\.add\('documents'\)/);
assert.match(assetRoute, /supporting-\(\[a-z0-9\]/);
assert.match(customerPage, /kind: 'documents'/);
assert.match(customerPage, /uploadSupportingDocuments/);
assert.match(customerPage, /accept="image\/\*,application\/pdf"/);
assert.match(customerPage, /렌터카사 요청서류/);
assert.match(policyPage, /PolicyRequiredDocumentsEditor/);

console.log('✓ 공급사 정책별 추가서류: 규격 편집 · 고객 직접 업로드 · 필수 검증 · 관리자 전용 열람');
