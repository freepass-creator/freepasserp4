/**
 * 스타트업 전자계약의 최소 보호선 회귀 검사.
 * 서비스 약관·내부 권한 정책을 대체하지는 않지만, 고객 링크에 필요한 기본 방어가
 * 빠진 채 배포되는 일을 막는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFreepassConsentProfile, freepassConsentOperationalBlocker, isFrozenFreepassConsentProfile } from '../lib/domain/freepass-esign-consents';

const publicRoute = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
const documentRoute = readFileSync('app/api/freepass-esign/public/[token]/document/route.ts', 'utf8');
const server = readFileSync('lib/server/freepass-esign.ts', 'utf8');
const signPage = readFileSync('app/sign/[token]/page.tsx', 'utf8');

// 링크·계약서 응답은 브라우저/검색엔진/외부 Referer에 남기지 않는다.
for (const source of [publicRoute, documentRoute]) {
  assert.match(source, /Cache-Control': '.*no-store/, '민감 계약 응답은 no-store 여야 합니다');
  assert.match(source, /X-Robots-Tag': 'noindex, nofollow, noarchive'/, '계약 링크는 검색 엔진에서 제외해야 합니다');
  assert.match(source, /Referrer-Policy': 'no-referrer'/, '계약 토큰이 Referer로 전달되면 안 됩니다');
}

// 공개 링크는 만료·해지·한 번의 제출 상태를 서버에서 확인한다.
assert.match(publicRoute, /revokedAt/, '해지 링크 차단이 없습니다');
assert.match(publicRoute, /expiresAt/, '만료 링크 차단이 없습니다');
assert.match(publicRoute, /submissionClaimAvailable/, '중복 제출 경쟁상태 차단이 없습니다');

// 주민번호·신분증 등은 공개 계약 노드가 아니라 암호문/비공개 저장소에만 둔다.
assert.match(publicRoute, /residentIdEncrypted: encryptRrn/, '매출증빙 주민번호 암호화 저장이 없습니다');
assert.match(publicRoute, /esign_private\//, '고객 제출값의 비공개 저장 경로가 없습니다');
assert.match(server, /cacheControl: 'private, no-store, max-age=0'/, '신분증·서명 파일의 private cache 방어가 없습니다');

// 법적 소명에 필요한 웹 계약조건·약관 전문 열람, 전체 동의, 의미 있는 서명과 확인 기록을 동시에 요구한다.
assert.match(publicRoute, /agreementReadAt/, '약관 전문 열람 기록이 없습니다');
assert.match(publicRoute, /hasMeaningfulFreepassSignature/, '의미 있는 전자서명 검증이 없습니다');
assert.match(publicRoute, /sectionConfirmations/, '계약조건 확인기록이 없습니다');
assert.match(signPage, /세부 계약과 자동차 대여약관의 전체 내용을 확인했습니다\. 전자서명으로 최종 동의합니다/,
  '고객의 전체 내용 동의 문구가 없습니다');
assert.match(signPage, /disabled=\{!readThrough\.agreement\}/,
  '약관 끝까지 확인하기 전 동의 선택을 막아야 합니다');
assert.match(signPage, /onChange=\{\(\) => toggleConsent\('rental_terms'\)\}/,
  '약관 전체 확인의 명시적 선택이 없습니다');

const cmsProfile = buildFreepassConsentProfile({
  landlordCompanyName: '테스트렌터카', gpsInstalled: '미장착', paymentMethod: 'CMS 자동이체',
  screeningCriteria: '무심사', requiredDocuments: [], customerType: '개인',
});
assert.ok(cmsProfile.requiredKeys.includes('cms_debit'), 'CMS 계약에는 출금 동의가 필수여야 합니다');
assert.equal(freepassConsentOperationalBlocker(cmsProfile), '', 'CMS 계약은 고객 링크에서 입력·동의를 받아야 합니다');
assert.ok(isFrozenFreepassConsentProfile(cmsProfile), 'CMS 동의 프로필을 발행 시점에 동결하지 못했습니다');
assert.match(publicRoute, /cms_debit/, 'CMS 출금 동의 제출값이 없습니다');
assert.match(publicRoute, /accountNoEncrypted: encryptPrivateValue/, 'CMS 계좌번호 암호화 저장이 없습니다');
assert.match(server, /const cmsComplete/, 'CMS 출금정보 완료 검증이 없습니다');
assert.match(server, /cmsComplete\n    && S\(handover/, 'CMS 계약은 출금 동의 없이 인도 완료되면 안 됩니다');

console.log('✓ 전자계약 기본보호: no-store·noindex·토큰 만료/해지·비공개 저장·암호화·웹 계약/약관 열람·동의/서명 기록');
