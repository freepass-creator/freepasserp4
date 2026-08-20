/**
 * **전자계약 테스트용 샘플 공급사 한 벌** — 공급사·정책·가상 차량을 «다 채워진» 상태로 만든다(사장님 2026-08-20).
 *
 * ★왜
 *   실제 공급사는 임대인 정보(주소 등)나 정책 칸이 비어 있어 전자계약을 끝까지 못 돌린다(2026-08-20 실측: 276대 중 5대만 발송 가능).
 *   테스트할 때마다 남의 회사 데이터를 건드릴 수는 없으므로, **손대도 되는 한 벌**을 따로 둔다.
 *
 * ★안전장치
 *   · 이름을 전부 「[샘플]」로 시작한다 — 목록에서 실제 매물과 섞여도 사람이 한눈에 안다.
 *   · 차량번호는 실제로 존재할 수 없는 「00가0001」 꼴.
 *   · 키가 고정이라 여러 번 돌려도 같은 레코드를 덮어쓴다(중복 생성 없음).
 *   · `--remove` 로 통째로 지운다(휴지통 규칙과 같게 _deleted 표시).
 *   ⚠ 출고가능 상태라야 계약서를 만들 수 있어 **영업자 상품찾기에도 보인다** — 그래서 이름에 「[샘플]」을 박는다.
 *
 *   npx tsx scripts/seed-sample-supplier.mts            # 무엇을 쓸지 보여주기만(dry-run)
 *   npx tsx scripts/seed-sample-supplier.mts --apply    # 실제로 만들기
 *   npx tsx scripts/seed-sample-supplier.mts --apply --remove   # 지우기
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_SHEET_FIELDS, POLICY_PREFILL, POLICY_DOCUMENT_CHECKS } from '../lib/domain/policy-sheet-layout';
import { POLICY_COLUMN_FIELDS } from '../lib/domain/supplier-template-sheet';
import { serializeEsignRequiredDocuments } from '../lib/domain/esign-required-documents';
import { applyPolicyDefaults } from '../lib/domain/policy-defaults';
import { sheetPolicyToErp } from '../lib/domain/policy-sheet-to-erp';
import { validateEsignCenterContract, depositInstallmentOptions } from '../lib/domain/esign-center';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const PARTNER_CODE = 'SAMPLE01';
const POLICY_CODE = 'POL-SAMPLE';
const NOW = Date.now();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const token = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const put = async (path: string, body: Rec) => {
  const res = await fetch(`${DB}/${path}.json?access_token=${token}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
};

/** 임대인 정보 — 계약서에 그대로 실리는 칸을 하나도 빼지 않는다(빠지면 발송 게이트가 막는다). */
const partner: Rec = {
  partner_code: PARTNER_CODE,
  partner_type: '공급사',
  name: '[샘플] 프리패스테스트렌터카 주식회사',
  alias: '[샘플] 테스트렌터카',
  business_number: '110-81-00001',
  corporate_registration_no: '110111-0000001',
  biz_category: '서비스 · 자동차대여',
  ceo: '김샘플',
  phone: '02-0000-0001',
  address: '서울특별시 강서구 양천로 100, 1층 (샘플동)',
  rental_business_no: '제 샘플-0001호',
  bank_name: '신한',
  bank_account: '110-000-000001',
  bank_holder: '[샘플] 프리패스테스트렌터카 주식회사',
  contact_name: '이담당',
  contact_phone: '010-0000-0001',
  contact_email: 'sample@teamjpk.com',
  contact: '02-0000-0001',
  esign_contract_enabled: '사용',
  fee_rate: 0.1,
  website: 'https://example.com/sample-rentcar',
  partner_memo: '⚠ 전자계약 테스트용 샘플입니다. 실제 거래처가 아닙니다(2026-08-20 생성).',
  updated_at: NOW,
};

/**
 * 정책 — 운영정책 시트 61항목을 «시트에 적었다고 치고» 그대로 넣는다.
 *   프리패스 표준(POLICY_PREFILL)을 바탕으로, 표준이 없는 칸만 아래에서 채운다 → 빈칸 0.
 */
const SHEET_EXTRA: Record<string, string> = {
  불가조건: '3년 이내 음주운전 이력',
  '불가조건 2': '개인회생·파산 진행 중',
  특이사항: '샘플 정책 — 테스트 전용, 실제 판매 조건이 아님',
  '기타사항 1': 'GPS·블랙박스 임의 탈거 시 손해배상',
  '기타사항 2': '차량 반납 시 실내 흡연 흔적은 별도 청구',
  '필요서류 1': '재직증명서',
  대여지역: '전국',
  무보험보상: '2억원',
  '초과주행 국산(1km당)': '200원',
  '초과주행 수입(1km당)': '400원',
};
const sheetRow = new Map<string, string>();
for (const f of POLICY_SHEET_FIELDS) {
  const v = SHEET_EXTRA[f.name] ?? POLICY_PREFILL[f.name] ?? '';
  if (v) sheetRow.set(f.name, v);
}
for (const d of POLICY_DOCUMENT_CHECKS) sheetRow.set(d.name, 'TRUE');   // 제출서류 6종 전부 체크
const { patch: fromSheet, review, blank } = sheetPolicyToErp(sheetRow);
const policy: Rec = {
  ...(applyPolicyDefaults({ policy_code: POLICY_CODE }).next as Rec),
  ...fromSheet,
  policy_code: POLICY_CODE,
  policy_name: '[샘플] 렌트 · 보험포함 (테스트용)',
  policy_type: '신차렌트',
  provider_company_code: PARTNER_CODE,
  contract_authoring: '프리패스가 작성',
  esign_required_documents: fromSheet.esign_required_documents
    || serializeEsignRequiredDocuments(POLICY_DOCUMENT_CHECKS.map((d) => ({ key: d.key, label: d.name, note: d.note, required: true }))),
  updated_at: NOW,
};

/** 가상 차량 — 실제로 존재할 수 없는 번호(00가000N). 기간별 대여료·보증금을 넣어 3번 카드가 열리게 한다. */
const vehicle = (n: number, over: Rec): Rec => ({
  product_code: `${PARTNER_CODE}_00가000${n}`,
  provider_company_code: PARTNER_CODE,
  partner_code: PARTNER_CODE,
  provider_name: '[샘플] 테스트렌터카',
  car_number: `00가000${n}`,
  vehicle_status: '출고가능',
  product_type: '신차렌트',
  policy_code: POLICY_CODE,
  is_active: true,
  status: 'active',
  source: 'sample-seed',
  partner_memo: '⚠ 전자계약 테스트용 가상 차량입니다. 실제 재고가 아닙니다(2026-08-20 생성).',
  created_at: NOW,
  updated_at: NOW,
  ...over,
});
const vehicles: Rec[] = [
  vehicle(1, {
    maker: '현대', model: '아반떼', sub_model: 'CN7', trim_name: '모던', variant: '가솔린 1.6',
    vehicle_name: '현대 아반떼 CN7 가솔린 1.6 모던', year: '2026', fuel_type: '가솔린',
    ext_color: '흰색', mileage: 10, first_registration_date: '2026-08-01', options: '내비게이션, 후방카메라',
    price: { 24: { rent: 450000, deposit: 900000 }, 36: { rent: 420000, deposit: 840000 }, 48: { rent: 400000, deposit: 800000 } },
  }),
  vehicle(2, {
    maker: '기아', model: 'K5', sub_model: 'DL3', trim_name: '노블레스', variant: '가솔린 2.0',
    vehicle_name: '기아 K5 DL3 가솔린 2.0 노블레스', year: '2026', fuel_type: '가솔린',
    ext_color: '검정', mileage: 12, first_registration_date: '2026-08-01', options: '파노라마선루프, 스마트키',
    price: { 24: { rent: 620000, deposit: 1240000 }, 36: { rent: 580000, deposit: 1160000 }, 48: { rent: 550000, deposit: 1100000 } },
  }),
];

/**
 * ★만들기 전에 «정말 발송까지 가는가»를 확인한다 — 반쯤 채워진 샘플을 만들어 두면
 *   테스트하다 막혔을 때 그게 코드 문제인지 데이터 문제인지 또 뒤져야 한다.
 */
function checkSendable(): string[] {
  const car = vehicles[0];
  const price = car.price['36'];
  const draft = {
    contract_source: 'direct',
    provider_company_code: PARTNER_CODE,
    policy_code: POLICY_CODE,
    product_code: car.product_code,
    vehicle_name_snapshot: car.vehicle_name,
    car_number_snapshot: car.car_number,
    rent_month_snapshot: 36,
    rent_amount_snapshot: price.rent,
    deposit_amount_snapshot: price.deposit,
    payment_timing_snapshot: S(policy.payment_timing) || '선불',
    driver_age_snapshot: S(policy.basic_driver_age),
    additional_driver: '없음',
    contract_draft: JSON.stringify({ deposit_installment: depositInstallmentOptions(policy, price.deposit)[0] || '일시납' }),
  };
  return validateEsignCenterContract(draft, partner, policy, car)
    .filter((c) => c.level === 'BLOCK')
    .map((c) => `${c.label}: ${c.message}`);
}

console.log(`■ 샘플 공급사 ${REMOVE ? '삭제' : '만들기'} ${APPLY ? '— 실제 반영' : '(dry-run)'}\n`);
if (REMOVE) {
  console.log(`  파트너 ${PARTNER_CODE} · 정책 ${POLICY_CODE} · 차량 ${vehicles.length}대를 삭제 표시(_deleted)합니다.`);
  if (APPLY) {
    await put(`v4/partners/${PARTNER_CODE}`, { _deleted: true, deletedAt: NOW });
    await put(`v4/policies/${POLICY_CODE}`, { _deleted: true, deletedAt: NOW });
    for (const v of vehicles) await put(`v4/products/${v.product_code}`, { _deleted: true, deletedAt: NOW });
    console.log('  ✓ 지웠습니다.');
  }
} else {
  const filled = POLICY_SHEET_FIELDS.filter((f) => sheetRow.get(f.name)).length;
  console.log(`  파트너 ${PARTNER_CODE} — ${partner.name}`);
  console.log(`  정책   ${POLICY_CODE} — ${policy.policy_name} · 시트 ${filled}/${POLICY_SHEET_FIELDS.length}항목 채움 · 미기재 ${blank} · 규격밖 ${review.length}`);
  for (const r of review) console.log(`     ⚠ ${r.name}: 「${r.raw}」 — ${r.note}`);
  for (const v of vehicles) console.log(`  차량   ${v.product_code} — ${v.vehicle_name} · ${Object.keys(v.price).join('/')}개월`);
  const blocks = checkSendable();
  console.log(blocks.length
    ? `\n  ⛔ 이대로는 발송이 막힙니다 — ${blocks.join(' · ')}`
    : '\n  ✓ 발송 게이트 통과 — 이 샘플로 계약서를 끝까지 만들 수 있습니다.');
  if (blocks.length) { console.log('  반영하지 않습니다. 위 항목을 채운 뒤 다시 돌리세요.'); process.exitCode = 1; }
  else if (APPLY) {
    await put(`v4/partners/${PARTNER_CODE}`, partner);
    await put(`v4/policies/${POLICY_CODE}`, policy);
    for (const v of vehicles) await put(`v4/products/${v.product_code}`, v);
    console.log('\n  ✓ 만들었습니다. 계약서관리 → 새 계약 만들기 → 회사에서 「[샘플] …」을 고르세요.');
  }
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
