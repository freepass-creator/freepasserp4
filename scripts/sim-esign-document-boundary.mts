import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stripDetachedEsignAppendices } from '../lib/domain/esign-document-boundary';
import { CONTRACT_DOCUMENT_TEMPLATES, findTemplate } from '../lib/domain/esign-templates';

const template = readFileSync('public/contract-template/rental-contract.html', 'utf8');
const mainContract = stripDetachedEsignAppendices(template);
const signPage = readFileSync('app/sign/[token]/page.tsx', 'utf8');
const server = readFileSync('lib/server/freepass-esign.ts', 'utf8');
const documentBuilder = readFileSync('lib/server/freepass-esign-document.ts', 'utf8');
const sharedHtmlBuilder = readFileSync('lib/server/freepass-contract-html.ts', 'utf8');
const reviewRenderer = readFileSync('scripts/render-freepass-standard-contract-review.mts', 'utf8');
const documentPreview = readFileSync('app/esign/preview/[contractCode]/page.tsx', 'utf8');
const publicDocument = readFileSync('app/api/freepass-esign/public/[token]/document/route.ts', 'utf8');
const contractPane = readFileSync('components/FreepassEsignPanes.tsx', 'utf8');
const agreementText = readFileSync('lib/domain/esign-agreement-text.ts', 'utf8');

assert.match(template, /부속서류 1 · 차량 인수증/);
assert.doesNotMatch(mainContract, /부속서류 1 · 차량 인수증/);
assert.doesNotMatch(mainContract, /부속서류 2 · 임대차 계약 사실확인서/);
assert.doesNotMatch(mainContract, /부속서류 3 · 운전자격 검증 확인서/);
assert.doesNotMatch(mainContract, /부속서류 4 · 개인정보/);
assert.doesNotMatch(mainContract, /부속서류 5 · 개인신용정보/);
assert.doesNotMatch(mainContract, /부속서류 6 · 위치정보/);
assert.doesNotMatch(mainContract, /부속서류 7 · 자동이체\(CMS\)/);
assert.match(template, /별도 계약 · 연대보증 약정서/);
assert.doesNotMatch(mainContract, /별도 계약 · 연대보증 약정서/);
assert.doesNotMatch(mainContract, /연대보증인 정보/);
assert.match(mainContract, /data-contract-option="driver"/);
assert.match(mainContract, /data-contract-option="guarantor"/);
assert.match(mainContract, /k==='special_terms'[\s\S]*?setDom\(k,'없음'\)/);
assert.match(mainContract, /\.special-terms-value\.is-empty\{min-height:0/);
assert.match(mainContract, /if\(k==='special_terms'\) e\.classList\.toggle\('is-empty'/);
assert.match(mainContract, /class="special-terms-value" data-field="special_terms">없음</);
assert.doesNotMatch(mainContract, /<div class="k">특약 사항<\/div>/);
assert.match(mainContract, /class="empty-contract-option" data-empty="driver"[^>]*>해당 없음</);
assert.match(mainContract, /class="empty-contract-option" data-empty="guarantor"[^>]*>해당 없음</);
assert.match(mainContract, /보증 최고액/);
assert.match(mainContract, /data-contract-page="special-parties"/);
assert.ok(mainContract.indexOf('data-field="driver_age"') < mainContract.indexOf('data-contract-page="special-parties"'));
assert.ok(mainContract.indexOf('data-field="driver_scope"') < mainContract.indexOf('data-contract-page="special-parties"'));
assert.equal((mainContract.match(/data-field="driver_age"/g) || []).length, 1);
assert.equal((mainContract.match(/data-field="driver_scope"/g) || []).length, 1);
assert.ok(mainContract.indexOf('data-contract-option="special-terms"') < mainContract.indexOf('data-contract-option="driver"'));
assert.ok(mainContract.indexOf('data-contract-option="driver"') < mainContract.indexOf('data-contract-option="guarantor"'));
assert.doesNotMatch(template, /partyPage\.style\.display='none'/);
assert.match(documentBuilder, /inlineContractPdfFonts/);
assert.match(documentBuilder, /document\.fonts\.ready/);
assert.match(documentBuilder, /__rebuildTerms/);
assert.match(documentBuilder, /buildFreepassContractHtml/);
/*
 * ★계약서 «파일 경로»를 발행 데이터가 고를 수 없어야 한다 — 이 가드의 원래 뜻이다.
 *   예전에는 파일명이 빌더 안에 문자열로 박혀 있어 `/rental-contract\.html/` 하나로 확인했다.
 *   이제 파일명은 허용목록(CONTRACT_DOCUMENT_TEMPLATES)으로 옮겼으므로, 같은 성질을 셋으로 나눠 본다.
 *   (2026-08-28 — 레지스트리 리팩터로 옛 문자열이 사라져 이 가드가 깨져 있었다.)
 */
// ① 빌더는 반드시 허용목록을 거친다. templateId 로 경로를 «짓지» 않는다.
assert.match(sharedHtmlBuilder, /CONTRACT_DOCUMENT_TEMPLATES/);
assert.match(sharedHtmlBuilder, /findTemplate/);
// ①' 그리고 «실제로 돌려서» 확인한다 — 정규식은 안전한 코드까지 잡거나 위험한 코드를 놓친다.
//    발행 데이터가 무엇을 넣든 허용목록 밖 파일로 못 나가야 한다.
for (const injected of ['../../../etc/passwd', '/etc/passwd', 'rental-contract.html', 'freepass-standard/../x', '', null, undefined]) {
  const picked = findTemplate(injected);
  const file = CONTRACT_DOCUMENT_TEMPLATES[picked?.documentTemplate || 'freepass-standard'].file;
  assert.ok(
    Object.values(CONTRACT_DOCUMENT_TEMPLATES).some((entry) => entry.file === file),
    `허용목록 밖 서식이 골라졌습니다: ${String(injected)} → ${file}`,
  );
  assert.doesNotMatch(file, /[\/]|\.\./, `서식 파일명에 경로가 섞였습니다: ${file}`);
}
// ② 기본값은 언제나 표준 계약서다. 여기가 바뀌면 아무 지시 없는 계약이 남의 서식으로 나간다.
assert.equal(CONTRACT_DOCUMENT_TEMPLATES['freepass-standard'].file, 'rental-contract.html');
// ③ 등록된 서식은 실제로 있어야 한다. 없으면 그 상품 계약이 발행 시점에 터진다.
for (const [key, entry] of Object.entries(CONTRACT_DOCUMENT_TEMPLATES)) {
  assert.ok(
    existsSync(`public/contract-template/${entry.file}`),
    `계약서 서식 파일이 없습니다: ${key} → ${entry.file}`,
  );
}
assert.match(sharedHtmlBuilder, /stripDetachedEsignAppendices/);
assert.match(sharedHtmlBuilder, /\[data-main-exclude=""\]\{display:none!important\}/);
assert.match(template, /class="section" data-contract-option="guarantor"/);
assert.match(reviewRenderer, /buildFreepassContractHtml/);
assert.match(documentPreview, /document\?draft=1&format=pdf/);
assert.match(publicDocument, /buildFrozenFreepassHtml/);
assert.match(publicDocument, /preview/);
assert.match(publicDocument, /download/);
assert.match(template, /서면 계약서에 서명·기명날인하거나 전자계약/);
assert.match(template, /서면 계약은 당사자가 서명·기명날인한 계약서를 각 1부씩 보관/);
assert.match(template, /임차인 서명·날인/);
assert.doesNotMatch(template, /본인인증 후 서명/);
assert.match(agreementText, /계약의 세칙·통지 및 계약서 교부/);
assert.match(contractPane, /A4 미리보기/);
assert.match(contractPane, /'링크 만들기'/);
// 2026-08-19: 미리보기 URL 은 previewUrl('a4') — /esign/preview/{code}?view=a4&back={basePath}
assert.match(contractPane, /\/esign\/preview\/\$\{encodeURIComponent\(code\)\}\?\$\{params\.toString\(\)\}/);
assert.match(contractPane, /params\.set\('view', 'a4'\)/);
assert.doesNotMatch(signPage.match(/const REQUIRED_CONSENTS[^;]+/)?.[0] || '', /cms/);
assert.doesNotMatch(server.match(/FREEPASS_ESIGN_REQUIRED_CONSENTS[^;]+/)?.[0] || '', /cms/);

console.log('✓ 본계약 문서 경계: 서면·전자 공용 원본, A4 출력·전자서명 분기, 부속서류 분리');
