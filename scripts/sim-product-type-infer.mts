/**
 * 상품구분 추론 — **모르면 비워 두는가.**
 * 실행: npx tsx scripts/sim-product-type-infer.mts
 *
 * 사장님 기준(2026-08-10): 오플=중고렌트 · 주행 300km 초과=중고 · 번호판·연식으로도 갈림.
 * 다만 「주행 0km」는 신차라는 뜻이 아니라 **공급사가 안 적었다**는 뜻일 때가 많다.
 * 모르면서 신차라고 적으면 손님에게 새 차라고 말하게 된다.
 */
import { inferProductType, USED_KM_THRESHOLD } from '../lib/domain/product-type-infer';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};
const car = (o: Record<string, unknown>) => o as unknown as EntityRecord;
const now = new Date().getFullYear();

// ── 이미 있으면 손대지 않는다 ─────────────────────────────
check('★있는 구분은 안 건드린다',
  inferProductType(car({ product_type: '중고구독', mileage: '50000' })) === null);
check('옛 표기도 «있는 것»으로 본다 — 재렌트',
  inferProductType(car({ product_type: '재렌트', mileage: '0' })) === null);

// ── 공급사 기준 ───────────────────────────────────────────
check('오토플러스는 전부 중고렌트',
  inferProductType(car({ provider_company_code: 'RP023', mileage: '0' }))?.type === '중고렌트');
check('공급사 기본값이 먼저다',
  inferProductType(car({ provider_company_code: 'RP099' }), { RP099: '중고구독' })?.type === '중고구독');

// ── 주행거리 ──────────────────────────────────────────────
check(`주행 ${USED_KM_THRESHOLD}km 초과는 중고`,
  inferProductType(car({ car_number: '12가3456', mileage: '42500', year: String(now) }))?.type === '중고렌트');
check('문턱 이하 + 올해 연식이면 신차',
  inferProductType(car({ car_number: '12가3456', mileage: '120', year: String(now) }))?.type === '신차렌트');

// ── 연식 ──────────────────────────────────────────────────
check('★재작년 차는 주행이 비어도 중고',
  inferProductType(car({ car_number: '12가3456', year: String(now - 2) }))?.type === '중고렌트',
  inferProductType(car({ car_number: '12가3456', year: String(now - 2) })));
check('선출고 신차(내년 연식)는 중고로 안 본다',
  inferProductType(car({ car_number: '', year: String(now + 1) }))?.type === '신차렌트');

// ── 번호판 ────────────────────────────────────────────────
check('임시번호는 신차', inferProductType(car({ car_number: '100신0001', year: String(now) }))?.type === '신차렌트');
check('번호 없으면 신차', inferProductType(car({ car_number: '', year: String(now) }))?.type === '신차렌트');

// ── ★모르면 비운다 ────────────────────────────────────────
check('★주행이 비고 연식도 없으면 채우지 않는다',
  inferProductType(car({ car_number: '12가3456' })) === null,
  inferProductType(car({ car_number: '12가3456' })));
check('★0km 를 신차로 단정하지 않는다',
  inferProductType(car({ car_number: '12가3456', mileage: '0', year: String(now) })) === null,
  inferProductType(car({ car_number: '12가3456', mileage: '0', year: String(now) })));

// 구독은 추론하지 않는다 — 계약 형태라 주행·번호판으로 알 수 없다.
check('구독을 지어내지 않는다',
  !String(inferProductType(car({ car_number: '', year: String(now) }))?.type).includes('구독'));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
