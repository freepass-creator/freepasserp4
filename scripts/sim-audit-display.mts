/** 감사로그 v3+v4 표시 호환 회귀검사. 실행: npx tsx scripts/sim-audit-display.mts */
import { buildAuditEntry, normalizeAuditRecord, parseAuditChanges, auditDomainOf } from '../lib/domain/audit';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed += 1; console.log(`PASS ${name}`); return; }
  failed += 1;
  console.error(`FAIL ${name}`, detail ?? '');
};

const legacy = normalizeAuditRecord({
  _key: '-legacy', action: 'update', collection: 'products', record_key: 'P-001', ts: 1780000000000,
  actor_name: '관리자', actor_role: 'admin', fields: ['car_number', 'price'],
  values: { car_number: '12가3456', price: { 36: { rent: 490000 } } },
});
check('legacy collection을 현재 entity로 변환', legacy?.entity === 'product', legacy);
check('legacy record_key/ts를 현재 필드로 변환', legacy?.target_key === 'P-001' && legacy?.at === 1780000000000, legacy);
const legacyWithEmptyCurrentFields = normalizeAuditRecord({
  _key: '-legacy-empty', action: 'update', collection: 'products',
  target_key: ' ', record_key: 'P-002', at: 0, ts: 1780000000004,
});
check('빈 현재 필드는 legacy 식별자·시각으로 fallback',
  legacyWithEmptyCurrentFields?.target_key === 'P-002' && legacyWithEmptyCurrentFields?.at === 1780000000004,
  legacyWithEmptyCurrentFields);
check('legacy 변경 필드 상세 복원', parseAuditChanges(legacy || {}).length === 2, legacy);
check('legacy 가격 변경은 대여료 영역', auditDomainOf(legacy || {}) === 'price', legacy);
check('원본 values 객체는 표시 상태에서 제거', legacy != null && !('values' in legacy), legacy);

const pii = normalizeAuditRecord({
  action: 'update', collection: 'contracts', record_key: 'C-001', ts: 1780000000001,
  fields: ['customer_phone', 'phone', 'birth', 'sender_email', 'business_no', 'doc_license'],
  values: {
    customer_phone: '010-1234-5678', phone: '010-9999-8888', birth: '900101',
    sender_email: 'legacy@example.com', business_no: '1234567890', doc_license: 'https://file.example/license.jpg',
  },
});
check('legacy 민감값과 별칭 모두 마스킹', parseAuditChanges(pii || {}).every((change) => change.to === '***'), pii);

const nestedPii = buildAuditEntry(
  'contract', 'freepass', 'C-PII', 'update', null,
  {
    customer_birth: '900101',
    profile: { sender_email: 'nested@example.com' },
    attachments: [{ url: 'https://file.example/contract.pdf', name: '계약서' }],
  },
  { uid: 'admin-1', role: 'admin', name: '관리자' },
);
const nestedAfter = JSON.parse(String(nestedPii?.after || '{}'));
check('신규 감사로그의 민감 alias·중첩·첨부 마스킹',
  nestedAfter.customer_birth === '***'
  && nestedAfter.profile?.sender_email === '***'
  && nestedAfter.attachments === '***', nestedAfter);

const noise = normalizeAuditRecord({
  action: 'update', collection: 'rooms', record_key: 'R-001', ts: 1780000000002,
  fields: ['unread_for_provider'], values: { unread_for_provider: 0 },
});
check('legacy unread 부산물은 감사목록 제외', noise === null, noise);

const current = { entity: 'contract', target_key: 'C-NEW', at: 1780000000003, action: 'update' };
check('현재 v4 감사레코드는 그대로 보존', normalizeAuditRecord(current) === current);

console.log(`\naudit display: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
