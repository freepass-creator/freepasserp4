/**
 * 주민등록번호가 «평문으로» 저장되지 않는지 지킨다.
 *
 * ★사장님 2026-08-29 결정으로 개인 계약에서 주민번호를 다시 받는다.
 *   그때 실제로 겪은 것: 화면·검증만 되돌리고 «암호화 경로»가 빠져 있었다.
 *   ①~④(고지·라벨·화면·서버)만 하면 RTDB 에 평문으로 쌓인다 — 눈으로는 안 보인다.
 *
 * 개인정보 보호법 시행령 제21조의2 — 주민등록번호는 «암호화하여 저장»한다.
 * 화면 마스킹·접근통제로는 대체되지 않는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const submit = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
const seal = readFileSync('app/api/freepass-esign/contracts/[contractCode]/route.ts', 'utf8');
const crypto = readFileSync('lib/server/rrn-crypto.ts', 'utf8');
const ok = (l: string, f: () => void) => { f(); console.log(`  ✓ ${l}`); };

ok('저장할 때 암호화한다', () => {
  assert.match(submit, /customer_id:\s*[^,\n]*encryptRrn\(/,
    'customer_id 를 encryptRrn 없이 저장합니다 — RTDB 에 평문으로 쌓입니다');
});

ok('봉인할 때만 푼다', () => {
  assert.match(seal, /customer_id:\s*decryptRrn\(/,
    '봉인본을 만들 때 decryptRrn 이 없습니다 — 계약서에 암호문이 찍힙니다');
});

ok('키가 없으면 저장이 실패한다 (fail-closed)', () => {
  assert.match(crypto, /throw new Error\('FREEPASS_RRN_KEY/,
    '키가 없을 때 평문으로 떨어지면 «되긴 되는데 법을 어기는» 상태가 조용히 굳습니다');
});

ok('매출증빙 주민번호도 암호화한다', () => {
  assert.match(submit, /residentIdEncrypted:\s*encryptRrn\(/,
    '현금영수증용 주민번호가 평문입니다');
});

console.log('\n✓ 주민등록번호: 저장은 암호문 · 원문은 봉인본에만 (개인정보 보호법 시행령 §21조의2)');
