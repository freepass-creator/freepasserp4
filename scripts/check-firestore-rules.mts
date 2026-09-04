import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-freepass-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

// 씨앗(규칙 무시) — 공급사 RP004(영업자 U0045) · 공급사 RP005(영업자 U0018)
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'contract/RP004__A1'), { companyId: 'RP004', provider_company_code: 'RP004', agent_code: 'U0045', customer_name: 'A' });
  await setDoc(doc(db, 'contract/RP005__B1'), { companyId: 'RP005', provider_company_code: 'RP005', agent_code: 'U0018', customer_name: 'B' });
  await setDoc(doc(db, 'settlement/RP004__S1'), { companyId: 'RP004', provider_company_code: 'RP004', agent_code: 'U0045', amount: 100 });
});

const results: string[] = [];
const check = async (name: string, kind: 'ok' | 'deny', p: Promise<unknown>) => {
  try { await (kind === 'ok' ? assertSucceeds(p) : assertFails(p)); results.push(`  ✓ ${name}`); }
  catch (e) { results.push(`  ✗ ${name} — ${(e as Error).message.slice(0, 80)}`); }
};

// 영업자 A (agent_code=U0045) — 자기 계약 O · 남의 계약 X
const A = env.authenticatedContext('uidA', { role: 'agent', agent_code: 'U0045', company: 'SP999' }).firestore();
await check('영업자A 자기계약(U0045) 읽기', 'ok', getDoc(doc(A, 'contract/RP004__A1')));
await check('영업자A 남의계약(U0018) 차단', 'deny', getDoc(doc(A, 'contract/RP005__B1')));
await check('영업자A 자기정산 읽기', 'ok', getDoc(doc(A, 'settlement/RP004__S1')));

// 공급사 RP004 — 자기 공급사 계약 O · 남의 공급사 X
const P = env.authenticatedContext('uidP', { role: 'provider', provider_company_code: 'RP004', company: 'RP004' }).firestore();
await check('공급사RP004 자기계약 읽기', 'ok', getDoc(doc(P, 'contract/RP004__A1')));
await check('공급사RP004 남의공급사(RP005) 차단', 'deny', getDoc(doc(P, 'contract/RP005__B1')));

// 관리자 — 전부
const AD = env.authenticatedContext('uidAd', { role: 'admin', company: 'x' }).firestore();
await check('관리자 계약 전부 읽기', 'ok', getDoc(doc(AD, 'contract/RP005__B1')));

// 비로그인 — 차단
const AN = env.unauthenticatedContext().firestore();
await check('비로그인 계약 차단', 'deny', getDoc(doc(AN, 'contract/RP004__A1')));

// 정산 금액변경 — 영업자 차단(admin만)
await check('영업자 정산 쓰기 차단', 'deny', setDoc(doc(A, 'settlement/RP004__S1'), { amount: 999 }));

console.log('\n=== Firestore 규칙 격리 테스트 ===');
for (const r of results) console.log(r);
const pass = results.filter((r) => r.startsWith('  ✓')).length;
console.log(`\n${pass}/${results.length} 통과`);
await env.cleanup();
process.exit(pass === results.length ? 0 : 1);
