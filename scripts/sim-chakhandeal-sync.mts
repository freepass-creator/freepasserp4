import { projectChakhandealStatus } from '../lib/domain/chakhandeal-esign-sync';

function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${label}: expected=${String(expected)} actual=${String(actual)}`);
  console.log(`PASS ${label}`);
}

const now = 1_800_000_000_000;
const base = {
  contractId: 'chd_test', externalRef: 'CT-001', signUrl: 'https://sign.example/test',
  status: 'issued', expiresAt: now + 60_000, progress: 0, progressTotal: 8,
};

check('발행 상태', projectChakhandealStatus(base, 'CT-001', now).patch.sign_status, '발행');
check('열람 상태', projectChakhandealStatus({ ...base, status: 'opened', openedAt: now }, 'CT-001', now).patch.sign_status, '열람');

const signed = projectChakhandealStatus({
  ...base, status: 'signed', signedAt: now, documentReady: true,
  documentSha256: 'a'.repeat(64), documentBytes: 1234, sealHash: 'seal',
  verifyUrl: 'https://api.example/v/1', documentUrl: 'https://api.example/document',
  consents: { signed: now }, progress: 8,
}, 'CT-001', now);
check('서명 완료 상태', signed.patch.sign_status, '서명완료');
check('서명 시각', signed.patch.sign_signed_at, now);
check('ERP PDF 프록시', signed.patch.signed_pdf_url, '/api/chakhandeal/contracts/CT-001/document');
check('PDF 없는 signed는 완료 아님', projectChakhandealStatus({
  ...base, status: 'signed', signedAt: now, documentReady: false,
}, 'CT-001', now).patch.sign_status, '발행');
check('만료 상태', projectChakhandealStatus({ ...base, expiresAt: now - 1 }, 'CT-001', now).patch.sign_status, '만료');

let mismatch = false;
try { projectChakhandealStatus(base, 'CT-OTHER', now); } catch { mismatch = true; }
check('외부 계약번호 불일치 차단', mismatch, true);
