import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { stripDetachedEsignAppendices } from '../lib/domain/esign-document-boundary';

const root = process.cwd();
const templatePath = path.join(root, 'public', 'contract-template', 'rental-contract.html');
const outputDir = path.join(root, 'output', 'pdf');
const outputPath = path.join(outputDir, 'freepass-standard-rental-contract-v1-review.pdf');

const fields: Record<string, string> = {
  doc_title: '프리패스 표준 자동차 렌탈 계약서',
  doc_kicker: 'FREEPASS STANDARD AUTOMOBILE RENTAL AGREEMENT · V1 검토본',
  product_label: '렌트 · 보험료 포함형',
  company_name: '샘플렌터카 주식회사',
  company_ceo: '김대표',
  company_ceo_title: '대표이사',
  company_biz_no: '000-00-00000',
  rental_business_no: '서울-대여-0000',
  company_phone: '02-0000-0000',
  company_address: '서울특별시 샘플구 예시로 00',
  payment_bank: '샘플은행',
  payment_account_no: '000-0000-0000',
  payment_account_holder: '샘플렌터카 주식회사',
  contract_no: 'SAMPLE-2026-0001',
  contract_code: 'SAMPLE-2026-0001',
  contract_date: '2026. 08. 11.',
  contract_place: '샘플렌터카 본점',
  customer_name: '홍길동',
  customer_id: '900101-1******',
  driver_or_biz_no: '서울00-00-000000-00',
  customer_phone: '010-0000-0000',
  customer_email: 'sample@example.com',
  customer_address: '서울특별시 샘플구 예시동 00',
  emergency_contact: '가족 · 010-0000-0001',
  car_number: '00가0000',
  vin: 'KMH-SAMPLE-000001',
  vehicle_name: '2026 현대 아반떼 1.6 가솔린 모던',
  fuel: '가솔린',
  model_year: '2026년식',
  options: '내비게이션, 후방카메라, 스마트크루즈',
  color_exterior: '아틀라스 화이트',
  color_interior: '블랙',
  odometer_delivery: '10km',
  vehicle_classification: '중고렌트',
  rent_month: '36개월',
  contract_start: '2026. 08. 15.',
  contract_end: '2029. 08. 14.',
  rent_amount: '650,000',
  deposit_amount: '3,000,000',
  deposit_installment: '일시납',
  annual_mileage: '연 20,000km',
  driver_age: '만 21세 이상 (가입증명서 예시)',
  driver_scope: '계약자 본인만',
  insurance_condition: '보험료 포함 (월 대여료에 포함)',
  insurer_name: '전국렌터카공제조합',
  coverage_liability_person: '무한',
  coverage_liability_property: '1억원',
  coverage_self_injury: '사망·후유장애 1인당 1억원 / 부상 1인당 1,500만원',
  coverage_uninsured: '1인당 최고 2억원',
  coverage_own_damage: '시세 기준',
  self_damage_coverage: '시세 기준',
  annual_roadside_assistance: '기본 10km (가입증명서 예시)',
  emergency_dispatch_limit: '기본 10km (가입증명서 예시)',
  deductible_liability_person: '30만원',
  deductible_liability_property: '30만원',
  self_damage_deductible_rate: '20',
  self_damage_deductible_min: '50만',
  self_damage_deductible_max: '100만',
  self_damage_exclusions: '단독사고, 가해자 불명, 휠·타이어 단독 손상, 전손, 고의·관리 소홀',
  maintenance_product: '미제공',
  maintenance_replacement: '미제공',
  designated_garage: '임대인 지정 협력 정비공장',
  replacement_car_policy: '미가입 시 미제공',
  payment_cycle: '월납',
  auto_debit_date: '매월 10일',
  invoice_type: '세금계산서',
  invoice_cycle: '월 1회',
  over_mileage_rate: '1km당 200원',
  early_termination_rate_y1: '30',
  early_termination_rate_y2: '20',
  late_fee_rate: '연 12%',
  deposit_return_term: '반납·정산 후 7일 이내',
  engine_control_overdue_days: '3',
  auto_terminate_overdue_days: '10',
  deposit_overdue_rounds: '2',
  accident_termination_count: '각 사고 발생일 기준 직전 1년 내, 해당 사고 포함 과실 50% 이상 총 3회',
  claim_basis: '잔여 대여료 상당액 또는 중도해지수수료 중 하나',
  renewal_notice_days: '30',
  buyout_notice_days: '30',
  impound_keep_days: '7',
  impound_keep_term: '반환 통지 후 7일',
  impound_fee: '1일 10,000원',
  spare_key_count: '1',
  gps_installed: '장착',
  buyback_option: '만기 반납 · 인수 별도 협의',
  buyback_price: '만기 협의',
  special_terms: '노란색 항목은 렌터카회사 확인 후 확정합니다.',
};

const sealed = {
  state: { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' },
  fields,
  signature: '',
  sealHash: 'REVIEW-DRAFT-NOT-FOR-SIGNATURE',
};

await mkdir(outputDir, { recursive: true });
let html = stripDetachedEsignAppendices(await readFile(templatePath, 'utf8'));
html = html.replace('</head>', `<script>window.__SEALED__=${JSON.stringify(sealed).replace(/</g, '\\u003c')};</script></head>`);
html = html.replace(/<body([^>]*)>/i, `<body$1><div class="fp-review-banner">렌터카회사 검토용 초안 · 서명 및 실계약 사용 금지</div>`);
html = html.replace('</style>', `
  .fp-review-banner{position:absolute;top:4mm;left:50%;transform:translateX(-50%);z-index:9999;padding:2mm 5mm;border:1px solid #b45309;background:#fff7ed;color:#9a3412;font:700 10px system-ui;letter-spacing:.02em}
  .fp-review-variable{background:#fff3a6!important;box-shadow:inset 0 -0.7mm 0 #ffe36a!important}
  .fp-review-summary{margin-top:16mm;border-top:1.2pt solid var(--accent);border-bottom:.5pt solid var(--bd);padding:5mm 0 4mm}
  .fp-review-summary h2{font-size:13px;color:var(--accent-ink);margin-bottom:2.5mm}
  .fp-review-summary .legend{font-size:9px;color:var(--mute);margin-bottom:3mm}
  .fp-review-summary .legend i{display:inline-block;width:9mm;height:3.2mm;background:#fff3a6;box-shadow:inset 0 -.7mm 0 #ffe36a;vertical-align:-.4mm;margin-right:2mm}
  .fp-review-summary .grid{display:grid;grid-template-columns:1fr 1fr;gap:2.5mm 7mm}
  .fp-review-summary .item{font-size:9.5px;line-height:1.45}
  .fp-review-summary .item b{display:block;color:var(--ink2);font-size:10px;margin-bottom:.5mm}
  @media print{.fp-review-banner{position:absolute}}
</style>`);

const executablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(() => {
    const variableFields = [
      'company_name', 'company_ceo', 'company_biz_no', 'company_phone', 'company_address',
      'rental_business_no',
      'contract_place', 'rent_month', 'deposit_installment', 'annual_mileage', 'driver_age', 'driver_scope',
      'insurer_name', 'coverage_liability_person', 'coverage_liability_property',
      'coverage_self_injury', 'coverage_uninsured', 'self_damage_coverage',
      'deductible_liability_person', 'deductible_liability_property',
      'self_damage_deductible_rate', 'self_damage_deductible_min', 'self_damage_deductible_max',
      'annual_roadside_assistance', 'emergency_dispatch_limit', 'maintenance_product', 'designated_garage',
      'replacement_car_policy', 'over_mileage_rate', 'early_termination_rate_y1',
      'early_termination_rate_y2', 'engine_control_overdue_days', 'auto_terminate_overdue_days',
      'accident_termination_count', 'deposit_return_term', 'late_fee_rate', 'buyback_option',
      'buyback_price', 'payment_cycle', 'auto_debit_date', 'invoice_type', 'invoice_cycle',
      'impound_keep_term', 'spare_key_count',
    ];
    for (const field of variableFields) {
      document.querySelectorAll(`[data-field="${field}"]`).forEach((el) => el.classList.add('fp-review-variable'));
    }

    const hero = document.querySelector('.cover-hero');
    if (hero) {
      const summary = document.createElement('div');
      summary.className = 'fp-review-summary';
      summary.innerHTML = `
        <h2>렌터카회사 정책 결정사항 요약</h2>
        <div class="legend"><i></i>노란색 표시 항목은 회사 정책·가입증권 확인 후 확정합니다.</div>
        <div class="grid">
          <div class="item"><b>회사·계약 기본정보</b>임대인 정보, 계약기간, 체결 장소, 만기 인수조건</div>
          <div class="item"><b>보험·사고</b>보험회사, 보상한도, 면책금, 자차 처리, 긴급출동</div>
          <div class="item"><b>요금·정산</b>약정주행, 초과주행 요금, 중도해지수수료, 보증금 반환</div>
          <div class="item"><b>연체·차량관리</b>시동제어일, 차량회수일, 사고 다발 해지 기준</div>
          <div class="item"><b>운전자·정비</b>운전자 연령·범위, 정비상품, 지정 정비점, 대차 조건</div>
          <div class="item"><b>확정 방법</b>회사 선택 → 연결 정책 적용 → 계약 건별 입력값 확인</div>
        </div>`;
      hero.insertAdjacentElement('afterend', summary);
    }
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(1_000);
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await writeFile(outputPath, pdf);
  console.log(outputPath);
} finally {
  await browser.close();
}
