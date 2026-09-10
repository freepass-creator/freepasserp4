import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-freepass-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

// 씨앗(규칙 무시) — 공급사 RP004(영업자 U0045) · 공급사 RP005(영업자 U0018)
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'contract/RP004__A1'), { companyId: 'RP004', provider_company_code: 'RP004', agent_code: 'U0045', _key: 'A1', customer_name: 'A' });
  await setDoc(doc(db, 'contract/RP004__A2'), { companyId: 'RP004', provider_company_code: 'RP004', agent_code: 'U0045', _key: 'A2', customer_name: 'A2' });
  await setDoc(doc(db, 'contract/RP005__B1'), { companyId: 'RP005', provider_company_code: 'RP005', agent_code: 'U0018', _key: 'B1', customer_name: 'B' });
  await setDoc(doc(db, 'settlement/RP004__S1'), { companyId: 'RP004', provider_company_code: 'RP004', agent_code: 'U0045', amount: 100 });
  await setDoc(doc(db, 'user/uidA'), { uid: 'uidA', role: 'agent', status: 'active', is_active: '예', company_code: 'SP999', user_code: 'U0045', agent_channel_code: 'SP999' });
  await setDoc(doc(db, 'user/uidP'), { uid: 'uidP', role: 'provider', status: 'active', is_active: '예', company_code: 'RP004', user_code: 'UP' });
  await setDoc(doc(db, 'user/uidPA'), { uid: 'uidPA', role: 'provider_admin', status: 'active', is_active: '예', company_code: 'RP004', user_code: 'UPA' });
  await setDoc(doc(db, 'user/uidAd'), { uid: 'uidAd', role: 'admin', status: 'active', is_active: '예', company_code: 'PT-0000', user_code: 'ADMIN' });
  await setDoc(doc(db, 'user/uidB'), { uid: 'uidB', role: 'agent', status: 'active', is_active: '예', company_code: 'SP999', user_code: 'U0018', agent_channel_code: 'OTHER' });
  await setDoc(doc(db, 'user/uidDisabled'), { uid: 'uidDisabled', role: 'provider', status: 'active', is_active: '아니오', company_code: 'RP004', user_code: 'UD' });
  await setDoc(doc(db, 'products/RP004__CAR1'), { companyId: 'RP004', provider_company_code: 'RP004', product_code: 'CAR1', car_number: '11가1111' });
  await setDoc(doc(db, 'products/RP005__CAR2'), { companyId: 'RP005', provider_company_code: 'RP005', product_code: 'CAR2', car_number: '22가2222' });
  await setDoc(doc(db, 'policy/RP004__P1'), { companyId: 'RP004', name: '정책A' });
  await setDoc(doc(db, 'partner/RP004__PT1'), { companyId: 'RP004', partner_name: '제일오토' });
  await setDoc(doc(db, 'customer/PT-0000__C1'), { companyId: 'PT-0000', created_by: 'uidA', customer_name: '손님A' });
  await setDoc(doc(db, 'customer/PT-0000__C2'), { companyId: 'PT-0000', created_by: 'uidB', customer_name: '손님B' });
  await setDoc(doc(db, 'rooms/RP004__R1'), { companyId: 'RP004', _key: 'R1', title: '공급사 방' });
  await setDoc(doc(db, 'messages/RP004__M1'), { companyId: 'RP004', _key: 'M1', room_code: 'R1', text: '메시지' });
  await setDoc(doc(db, 'quote/RP004__Q1'), { companyId: 'RP004', _key: 'Q1', room_code: 'R1' });
  await setDoc(doc(db, 'contract_sign/sign_public_1'), { status: 'sent', contract_code: 'CT-1', sign_status: '발송', agent_uid: 'uidA', expires_at: Date.now() + 60_000 });
  await setDoc(doc(db, 'contract_sign/sign_revoked'), { status: 'sent', contract_code: 'CT-R', agent_uid: 'uidA', revoked_at: Date.now(), expires_at: Date.now() + 60_000 });
  await setDoc(doc(db, 'contract_sign/sign_expired'), { status: 'sent', contract_code: 'CT-E', agent_uid: 'uidA', expires_at: Date.now() - 60_000 });
});

const results: string[] = [];
const check = async (name: string, kind: 'ok' | 'deny', p: Promise<unknown>) => {
  try { await (kind === 'ok' ? assertSucceeds(p) : assertFails(p)); results.push(`  ✓ ${name}`); }
  catch (e) { results.push(`  ✗ ${name} — ${(e as Error).message.slice(0, 80)}`); }
};

// 영업자 A (agent_code=U0045) — 자기 계약 O · 남의 계약 X
const A = env.authenticatedContext('uidA', { role: 'agent', agent_code: 'U0045', company: 'SP999' }).firestore();
const B = env.authenticatedContext('uidB', { role: 'agent', agent_code: 'U0018', company: 'SP999' }).firestore();
const NEW = env.authenticatedContext('uidNew', { role: 'agent', agent_code: 'uidNew', company: 'SP999' }).firestore();
await check('영업자A 자기계약(U0045) 읽기', 'ok', getDoc(doc(A, 'contract/RP004__A1')));
await check('영업자A 남의계약(U0018) 차단', 'deny', getDoc(doc(A, 'contract/RP005__B1')));
await check('영업자A 자기정산 읽기', 'ok', getDoc(doc(A, 'settlement/RP004__S1')));

// 공급사 RP004 — 자기 공급사 계약 O · 남의 공급사 X
const P = env.authenticatedContext('uidP', { role: 'provider', provider_company_code: 'RP004', company: 'RP004' }).firestore();
const PA = env.authenticatedContext('uidPA', { role: 'provider_admin', provider_company_code: 'RP004', company: 'RP004' }).firestore();
const PD = env.authenticatedContext('uidDisabled', { role: 'provider', provider_company_code: 'RP004', company: 'RP004' }).firestore();
await check('공급사RP004 자기계약 읽기', 'ok', getDoc(doc(P, 'contract/RP004__A1')));
await check('공급사관리자RP004 자기계약 읽기', 'ok', getDoc(doc(PA, 'contract/RP004__A1')));
await check('공급사RP004 남의공급사(RP005) 차단', 'deny', getDoc(doc(P, 'contract/RP005__B1')));
await check('비활성 공급사 자기계약 차단', 'deny', getDoc(doc(PD, 'contract/RP004__A1')));

// 관리자 — 전부
const AD = env.authenticatedContext('uidAd', { role: 'admin', company: 'x' }).firestore();
await check('관리자 계약 전부 읽기', 'ok', getDoc(doc(AD, 'contract/RP005__B1')));

// 비로그인 — 차단
const AN = env.unauthenticatedContext().firestore();
await check('비로그인 계약 차단', 'deny', getDoc(doc(AN, 'contract/RP004__A1')));

// 정산 금액변경 — 영업자 차단(admin만)
await check('영업자 정산 쓰기 차단', 'deny', setDoc(doc(A, 'settlement/RP004__S1'), { amount: 999 }));

// === 상품 원자 — 로그인 read, admin 전체 write, 공급사는 자기 원자만 create/update, client delete 금지 ===
await check('영업자 상품 읽기', 'ok', getDoc(doc(A, 'products/RP004__CAR1')));
await check('영업자 상품 쓰기 차단', 'deny', setDoc(doc(A, 'products/RP004__CAR1'), { car_number: '11가9999' }, { merge: true }));
await check('공급사 자기 상품 생성', 'ok', setDoc(doc(P, 'products/RP004__CAR3'), {
  companyId: 'RP004', provider_company_code: 'RP004', product_code: 'CAR3', car_number: '33가3333',
}));
await check('공급사 자기 상품 수정', 'ok', setDoc(doc(P, 'products/RP004__CAR1'), { car_number: '11가1112' }, { merge: true }));
await check('공급사관리자 자기 상품 수정', 'ok', setDoc(doc(PA, 'products/RP004__CAR1'), { car_number: '11가1113' }, { merge: true }));
await check('공급사 남의 상품 수정 차단', 'deny', setDoc(doc(P, 'products/RP005__CAR2'), { car_number: '22가9999' }, { merge: true }));
await check('공급사 코드 갈아타기 차단', 'deny', setDoc(doc(P, 'products/RP004__CAR1'), { provider_company_code: 'RP005' }, { merge: true }));
await check('공급사 상품 하드삭제 차단', 'deny', deleteDoc(doc(P, 'products/RP004__CAR1')));
await check('관리자 상품 수정', 'ok', setDoc(doc(AD, 'products/RP005__CAR2'), { car_number: '22가2223' }, { merge: true }));

// === 어댑터 쿼리 패턴(list) 격리 — 규칙은 «필터가 아니라 검증»이라 제약 없으면 쿼리 자체가 거부된다 ===
await check('영업자A list(agent_code) 허용', 'ok', getDocs(query(collection(A, 'contract'), where('agent_code', '==', 'U0045'))));
await check('영업자A list(companyId=SP999) 거부(옛 방식)', 'deny', getDocs(query(collection(A, 'contract'), where('companyId', '==', 'SP999'))));
await check('영업자A list(무제약) 거부', 'deny', getDocs(query(collection(A, 'contract'))));
await check('공급사RP004 list(provider_company_code) 허용', 'ok', getDocs(query(collection(P, 'contract'), where('provider_company_code', '==', 'RP004'))));
// 결과 «내용»까지 — 영업자A 는 «자기 2건만», 남의 것 0
try {
  const snap = await getDocs(query(collection(A, 'contract'), where('agent_code', '==', 'U0045')));
  const codes = [...new Set(snap.docs.map((d) => (d.data() as { agent_code?: string }).agent_code))];
  const ok = snap.size === 2 && codes.length === 1 && codes[0] === 'U0045';
  results.push(`  ${ok ? '✓' : '✗'} 영업자A list 결과 = 자기 2건만 (실제 ${snap.size}건, 코드 ${codes.join(',')})`);
} catch (e) { results.push(`  ✗ 영업자A list 결과 확인 실패 — ${(e as Error).message.slice(0, 60)}`); }

// === 참조데이터(정책·파트너) — 영업자가 «어느 공급사» 것이든 read, write 는 admin ===
await check('영업자A 정책(다른공급사 RP004) 읽기', 'ok', getDoc(doc(A, 'policy/RP004__P1')));
await check('영업자A 파트너 읽기', 'ok', getDoc(doc(A, 'partner/RP004__PT1')));
await check('영업자A list(정책 전체) 허용', 'ok', getDocs(collection(A, 'policy')));
await check('영업자A 정책 쓰기 차단(admin만)', 'deny', setDoc(doc(A, 'policy/RP004__P1'), { name: 'X' }));

// === 손님(개인정보) — 만든 사람(created_by=uid)만 ===
await check('영업자A 자기손님(created_by=uidA) 읽기', 'ok', getDoc(doc(A, 'customer/PT-0000__C1')));
await check('영업자A 남의손님(uidB) 차단', 'deny', getDoc(doc(A, 'customer/PT-0000__C2')));
await check('영업자A list(created_by=uidA) 허용', 'ok', getDocs(query(collection(A, 'customer'), where('created_by', '==', 'uidA'))));
await check('영업자A list(무제약 손님) 거부', 'deny', getDocs(query(collection(A, 'customer'))));

// === 이관된 채팅 컬렉션 — 물리 이름은 rooms/messages(복수형) ===
await check('공급사 자기 rooms 읽기', 'ok', getDoc(doc(P, 'rooms/RP004__R1')));
await check('공급사 자기 messages 읽기', 'ok', getDoc(doc(P, 'messages/RP004__M1')));
await check('비로그인 rooms 읽기 차단', 'deny', getDoc(doc(AN, 'rooms/RP004__R1')));
await check('폐기 단수 room 쓰기 차단', 'deny', setDoc(doc(P, 'room/RP004__R2'), { companyId: 'RP004', _key: 'R2' }));
await check('공급사 자기 quote 읽기', 'ok', getDoc(doc(P, 'quote/RP004__Q1')));
await check('폐기 복수 quotes 쓰기 차단', 'deny', setDoc(doc(P, 'quotes/RP004__Q2'), { companyId: 'RP004', _key: 'Q2' }));

// === Firestore 단일 백엔드 전환 경로 ===
await check('본인 프로필 이름 수정', 'ok', setDoc(doc(A, 'user/uidA'), { name: 'A2' }, { merge: true }));
await check('가입자가 관리자 역할로 생성 차단', 'deny', setDoc(doc(NEW, 'user/uidNew'), {
  uid: 'uidNew', status: 'active', role: 'admin', created_at: 1,
}));
await check('본인 프로필 역할 변경 차단', 'deny', setDoc(doc(A, 'user/uidA'), { role: 'admin' }, { merge: true }));
await check('본인 private 이메일 생성', 'ok', setDoc(doc(A, 'users_private/uidA'), { email: 'a@example.test' }));
await check('본인 private 임의 필드 차단', 'deny', setDoc(doc(A, 'users_private/uidA'), { fee_rate: 1 }, { merge: true }));
await check('비로그인 공개서명 단건 읽기', 'ok', getDoc(doc(AN, 'contract_sign/sign_public_1')));
await check('비로그인 폐기 공개서명 읽기 차단', 'deny', getDoc(doc(AN, 'contract_sign/sign_revoked')));
await check('비로그인 만료 공개서명 읽기 차단', 'deny', getDoc(doc(AN, 'contract_sign/sign_expired')));
await check('소유 영업자 만료 공개서명 읽기', 'ok', getDoc(doc(A, 'contract_sign/sign_expired')));
await check('비로그인 공개서명 목록 차단', 'deny', getDocs(collection(AN, 'contract_sign')));
await check('다른 영업자 공개서명 임의수정 차단', 'deny', setDoc(doc(B, 'contract_sign/sign_public_1'), { rent_amount_snapshot: 1 }, { merge: true }));
await check('비로그인 공개서명 제출 허용', 'ok', setDoc(doc(AN, 'contract_sign/sign_public_1'), {
  status: 'pending_review', sign_status: '검토대기', sign_signature: 'data:image/png;base64,x',
  sign_consents: 'rental_terms,privacy,credit,gps,cms', sign_consent_version: 'v1', sign_signed_at: 2,
  updated_at: 2, sign_token: 'sign_public_1',
}, { merge: true }));
await check('비로그인 공개서명 계약코드 변조 차단', 'deny', setDoc(doc(AN, 'contract_sign/sign_public_1'), {
  contract_code: 'CT-HACK',
}, { merge: true }));
await check('비로그인 공개서명 동의값 변조 차단', 'deny', setDoc(doc(AN, 'contract_sign/sign_public_1'), {
  status: 'pending_review', sign_status: '검토대기', sign_signature: 'data:image/png;base64,x',
  sign_consents: 'privacy', sign_consent_version: 'v1', sign_signed_at: 2,
  updated_at: 2, sign_token: 'sign_public_1',
}, { merge: true }));
await check('비로그인 폐기 공개서명 제출 차단', 'deny', setDoc(doc(AN, 'contract_sign/sign_revoked'), {
  status: 'pending_review', sign_status: '검토대기', sign_signature: 'data:image/png;base64,x',
  sign_consents: 'rental_terms,privacy,credit,gps,cms', sign_consent_version: 'v1', sign_signed_at: 2,
  updated_at: 2, sign_token: 'sign_revoked',
}, { merge: true }));
await check('비로그인 공개서명 신규 생성 차단', 'deny', setDoc(doc(AN, 'contract_sign/sign_public_2'), {
  status: 'sent', contract_code: 'CT-2',
}));

console.log('\n=== Firestore 규칙 격리 테스트 ===');
for (const r of results) console.log(r);
const pass = results.filter((r) => r.startsWith('  ✓')).length;
console.log(`\n${pass}/${results.length} 통과`);
await env.cleanup();
process.exit(pass === results.length ? 0 : 1);
