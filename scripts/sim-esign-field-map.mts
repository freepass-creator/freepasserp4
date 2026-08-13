/**
 * 계약서 치환필드 ↔ 우리 원자 매핑 검증.
 * **현재 fp4 계약서 템플릿과 대조**한다 — 손으로 적은 표는 곧 어긋난다.
 * 실행: npx tsx scripts/sim-esign-field-map.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  FIELD_MAP, coverageByKind, coverageBySource, fieldsForKind, unmappedFields,
} from '../lib/domain/esign-field-map';
import { CONTRACT_KINDS, findContractKind } from '../lib/domain/esign-contract-kind';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

// ── 표 자체의 정합 ──
const keys = FIELD_MAP.map((f) => f.field);
check('필드 이름 중복 없음', new Set(keys).size === keys.length,
  keys.filter((k, i) => keys.indexOf(k) !== i));
check('모든 항목에 라벨', FIELD_MAP.every((f) => !!f.label));
// 「어디서 오는지」를 못 적으면 그 칸은 영원히 빈다.
check('모든 항목에 출처', FIELD_MAP.every((f) => !!f.from));
// 원자 키는 값이 실제로 오는 출처에만 붙는다. 고정문구에 원자를 달면 헷갈린다.
check('원자 키는 데이터 출처에만',
  FIELD_MAP.filter((f) => f.atom).every((f) => ['계약', '재고', '정책', '파트너', '입력', '표기'].includes(f.from)),
  FIELD_MAP.filter((f) => f.atom && !['계약', '재고', '정책', '파트너', '입력', '표기'].includes(f.from)).map((f) => f.field));
check('미정에는 원자가 없다', FIELD_MAP.filter((f) => f.from === '미정').every((f) => !f.atom));
// 주민번호·면허번호를 우리가 받는 걸로 적으면 PII 경계가 무너진다.
check('주민번호·면허는 본인확인 출처',
  FIELD_MAP.filter((f) => /rrn|customer_id|license_no|driver_or_biz/.test(f.field))
    .every((f) => f.from === '본인확인'),
  FIELD_MAP.filter((f) => /rrn|customer_id|license/.test(f.field)).map((f) => `${f.field}:${f.from}`));

// ── 4유형 ──
check('유형별 필드 수가 다르다',
  new Set(CONTRACT_KINDS.map((k) => fieldsForKind(k).length)).size > 1,
  coverageByKind());
const buyout = findContractKind('rent_buyout')!;
const ret = findContractKind('rent_return')!;
check('인수형에만 만기 인수가격',
  fieldsForKind(buyout).some((f) => f.field === 'buyback_price')
  && !fieldsForKind(ret).some((f) => f.field === 'buyback_price'));
check('반납형에만 반납 실사',
  fieldsForKind(ret).some((f) => f.field === 'odometer_return')
  && !fieldsForKind(buyout).some((f) => f.field === 'odometer_return'));
check('반납형에만 인수 옵션(선택)',
  fieldsForKind(ret).some((f) => f.field === 'buyback_option'));
// 구독·렌탈은 만기 축이 같으면 필드가 같다 — 문서명·호칭만 다르다.
check('같은 만기면 필드 구성 동일',
  fieldsForKind(findContractKind('sub_return')!).length === fieldsForKind(ret).length);

// ── 실제 템플릿과 대조 — 이게 없으면 표가 곧 거짓말이 된다 ──
const TPL = 'public/contract-template/rental-contract.html';
// 이전 HTML에는 현재 계약 원자 정책에서 의도적으로 폐기한 필드가 남아 있을 수 있다.
// - insurer_phone: 변동 가능한 보험사 대표번호를 계약서 스냅샷으로 고정하지 않는다.
// - auto_debit_date_inline: auto_debit_date와 중복이므로 정규 필드 하나만 유지한다.
const RETIRED_TEMPLATE_FIELDS = new Set(['insurer_phone', 'auto_debit_date_inline']);
if (existsSync(TPL)) {
  const html = readFileSync(TPL, 'utf8');
  const real = new Set(
    [...html.matchAll(/data-field="([^"]+)"/g)]
      .map((m) => m[1])
      // 템플릿 스크립트가 만든 동적 조각은 필드가 아니다.
      .filter((f) => /^[a-z][a-z0-9_]*$/.test(f))
      .filter((f) => !RETIRED_TEMPLATE_FIELDS.has(f)),
  );
  /**
   * ★대조 대상은 «템플릿에서 오는 필드»뿐이다.
   *
   * 정책에서 오는 원자(`from: '정책'`)는 erp3 의 옛 HTML 템플릿에 있을 리가 없다 —
   * 약관 조항을 표에 박아 두는 대신 정책값으로 뽑아내면서 새로 생긴 것들이다
   * (실측 2026-08-09: 「1년 이내 사고 누적」 `accident_termination_count`).
   * 그걸 「지어낸 필드」로 세면, 약관을 원자화할 때마다 이 sim 이 빨개진다.
   * 템플릿은 **템플릿 필드의** 정본이지 정책 원자의 정본이 아니다.
   */
  const fromTemplate = new Set(FIELD_MAP.filter((f) => f.from !== '정책').map((f) => f.field));
  const mine = new Set(keys);
  // 빠진 것은 **전체**로 센다 — 정책 원자로 옮겼어도 덮고 있으면 덮은 것이다.
  const missing = [...real].filter((f) => !mine.has(f));
  // 지어낸 것은 **템플릿에서 온다고 표시한 필드**만 센다.
  const extra = [...mine].filter((f) => fromTemplate.has(f) && !real.has(f));
  check(`템플릿 필드를 다 덮는다 (실제 ${real.size}개)`, missing.length === 0, missing);
  check('템플릿에서 오는 필드는 지어내지 않았다', extra.length === 0, extra);
} else {
  console.log('⚠ erp3 템플릿 없음 — 대조 생략');
}

// ── 커버리지 ──
const cov = coverageBySource();
const un = unmappedFields();
console.log('\n── 출처별 ──');
for (const [k, v] of Object.entries(cov).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(6)} ${v}`);
console.log(`\n── 미정 ${un.length}개 ──`);
for (const f of un) console.log(`   ${f.field.padEnd(24)} ${f.label}${f.conditional ? ` (${f.conditional})` : ''}`);
console.log('\n── 유형별 ──');
for (const c of coverageByKind()) console.log(`   ${c.kind.padEnd(18)} ${c.mapped}/${c.total} (미정 ${c.unmapped})`);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
