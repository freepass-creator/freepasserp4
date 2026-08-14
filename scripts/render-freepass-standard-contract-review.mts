import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { inlineContractPdfFonts } from '../lib/server/contract-pdf-assets';
import { buildFreepassContractHtml } from '../lib/server/freepass-contract-html';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'pdf');
const actualMode = process.argv.includes('--actual');
const withDriver = process.argv.includes('--with-driver');
const withGuarantor = process.argv.includes('--with-guarantor');
const outputPath = path.join(
  outputDir,
  withDriver && withGuarantor
    ? 'freepass-standard-rental-contract-v1-optional-parties-review.pdf'
    : withGuarantor
    ? 'freepass-standard-rental-contract-v1-guarantor-review.pdf'
    : withDriver
    ? 'freepass-standard-rental-contract-v1-additional-driver-review.pdf'
    : actualMode
    ? 'freepass-standard-rental-contract-v1-actual.pdf'
    : 'freepass-standard-rental-contract-v1-review.pdf',
);

const fields: Record<string, string> = {
  doc_title: '프리패스 표준 자동차 장기대여 계약서',
  doc_kicker: 'FREEPASS STANDARD LONG-TERM VEHICLE RENTAL AGREEMENT · V1 검토본',
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
  rent_month: '차량 인도일로부터 36개월',
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
  coverage_self_injury: '사망·후유장애 1인당 3천만원 · 부상 1인당 1,500만원',
  coverage_uninsured: '미가입',
  coverage_own_damage: '시세 기준',
  self_damage_coverage: '시세 기준',
  annual_roadside_assistance: '기본 10km (가입증명서 예시)',
  emergency_dispatch_limit: '기본 10km (가입증명서 예시)',
  deductible_liability_person: '30만원',
  deductible_liability_property: '30만원',
  self_damage_deductible_rate: '20%',
  self_damage_deductible_min: '50만원',
  self_damage_deductible_max: '100만원',
  self_damage_exclusions: '단독사고, 가해자 불명, 휠·타이어 단독 손상, 전손, 고의·관리 소홀',
  maintenance_product: '미제공',
  maintenance_replacement: '미제공',
  designated_garage: '임대인 지정 협력 정비공장',
  replacement_car_policy: '미가입 시 미제공',
  payment_cycle: '월납',
  payment_timing: '선불',
  payment_method: 'CMS 자동이체',
  auto_debit_date: '매월 10일',
  invoice_type: '세금계산서',
  invoice_cycle: '월 1회',
  over_mileage_rate: '1km당 200원',
  early_termination_rate_y1: '30',
  early_termination_rate_y2: '20',
  succession_allowed: '협의',
  succession_fee: '1,000,000',
  late_fee_rate: '연 24%',
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
  gps_installed: '장착',
  buyback_option: '만기 반납 · 인수 별도 협의',
  buyback_price: '만기 협의',
  special_terms: '없음',
};

if (withDriver) {
  Object.assign(fields, {
    driver_scope: '계약자 본인 · 추가 운전자 3인',
    drv1_name: '김하늘',
    drv1_relation: '배우자',
    drv1_phone: '010-1111-2222',
    drv2_name: '이바다',
    drv2_relation: '형제',
    drv2_phone: '010-2222-3333',
    drv3_name: '박푸름',
    drv3_relation: '직계가족',
    drv3_phone: '010-3333-4444',
  });
}

if (withGuarantor) {
  Object.assign(fields, {
    guarantor_name: '이보증',
    guarantor_rrn: '850505-1******',
    guarantor_relation: '부',
    guarantor_phone: '010-3333-4444',
    guarantor_occupation: '자영업',
    guarantor_address: '서울특별시 샘플구 예시로 10',
    guarantee_limit: '30,000,000원',
    guarantee_period: '계약 체결일부터 계약 종료 및 정산 완료일까지',
  });
}

const sealed = {
  state: { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' },
  fields,
  signature: '',
  sealHash: 'REVIEW-DRAFT-NOT-FOR-SIGNATURE',
};

await mkdir(outputDir, { recursive: true });
let html = await inlineContractPdfFonts(await buildFreepassContractHtml(sealed, {
  includePrintButton: false,
  root,
}), root);
if (!actualMode) {
  html = html.replace(/<body([^>]*)>/i, `<body$1><div class="fp-review-banner">렌터카회사 검토용 초안 · 서명 및 실계약 사용 금지</div>`);
  html = html.replace('</style>', `
    .fp-review-banner{position:absolute;top:4mm;left:50%;transform:translateX(-50%);z-index:9999;padding:2mm 5mm;border:1px solid #b45309;background:#fff7ed;color:#9a3412;font:700 10px Pretendard,sans-serif;letter-spacing:.02em}
    .fp-review-variable{background:#fff3a6!important;box-shadow:inset 0 -0.7mm 0 #ffe36a!important}
    @media print{.fp-review-banner{position:absolute}}
  </style>`);
}

const executablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  const pretendardFaces = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces: { family: string; weight: string; status: string }[] = [];
    document.fonts.forEach((face) => {
      if (/^Pretendard$/i.test(face.family.replace(/["']/g, ''))) {
        faces.push({ family: face.family, weight: face.weight, status: face.status });
      }
    });
    return faces;
  });
  if (!pretendardFaces.length || pretendardFaces.some((face) => face.status !== 'loaded')) {
    throw new Error(`Pretendard 폰트 로딩 실패: ${JSON.stringify(pretendardFaces)}`);
  }
  if (!actualMode) await page.evaluate(() => {
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
      'early_termination_rate_y2', 'succession_allowed', 'succession_fee', 'engine_control_overdue_days', 'auto_terminate_overdue_days',
      'accident_termination_count', 'deposit_return_term', 'late_fee_rate', 'buyback_option',
      'buyback_price', 'payment_cycle', 'payment_timing', 'payment_method', 'auto_debit_date', 'invoice_type', 'invoice_cycle',
      'impound_keep_term',
    ];
    for (const field of variableFields) {
      document.querySelectorAll(`[data-field="${field}"]`).forEach((el) => el.classList.add('fp-review-variable'));
    }

  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    (window as Window & { __rebuildTerms?: () => void }).__rebuildTerms?.();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const flowFragments = await page.evaluate(() => ({
    grouped: document.querySelectorAll('.terms-cols [data-flow-group]').length,
    fragments: document.querySelectorAll('.terms-cols .t-flow-fragment').length,
    layout: (window as Window & { __termsLayoutDebug?: unknown }).__termsLayoutDebug,
  }));
  if (flowFragments.grouped || flowFragments.fragments) {
    throw new Error(`약관 자동분할 조각 병합 누락: ${JSON.stringify(flowFragments)}`);
  }
  console.log(`terms-layout=${JSON.stringify(flowFragments.layout)}`);
  const termsMetrics = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.terms-cols .tc')).map((col) => {
    const body = col.closest('.pbody') as HTMLElement | null;
    const last = col.lastElementChild as HTMLElement | null;
    const top = col.getBoundingClientRect().top;
    const bottom = last?.getBoundingClientRect().bottom ?? top;
    const bodyBottom = body?.getBoundingClientRect().bottom ?? bottom;
    return {
      used: Math.round((bottom - top) * 10) / 10,
      available: Math.round((bodyBottom - top - 6) * 10) / 10,
      remaining: Math.round((bodyBottom - bottom - 6) * 10) / 10,
      overflow: bottom > bodyBottom - 6,
    };
  }));
  const termsPageFrames = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('#termsPages > .page')).map((sheet) => {
    const head = sheet.querySelector<HTMLElement>('.rhead');
    const body = sheet.querySelector<HTMLElement>('.pbody');
    const sheetRect = sheet.getBoundingClientRect();
    const headRect = head?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    return {
      headVisible: Boolean(head && getComputedStyle(head).display !== 'none' && headRect && headRect.height > 0),
      headTop: headRect ? Math.round((headRect.top - sheetRect.top) * 10) / 10 : -1,
      bodyBottom: bodyRect ? Math.round((bodyRect.bottom - sheetRect.top) * 10) / 10 : -1,
      sheetHeight: Math.round(sheetRect.height * 10) / 10,
    };
  }));
  if (termsPageFrames.length !== 3 || termsPageFrames.some((frame) => !frame.headVisible || frame.headTop < 0 || frame.bodyBottom > frame.sheetHeight)) {
    throw new Error(`약관 A4 페이지 프레임 이탈: ${JSON.stringify(termsPageFrames)}`);
  }
  if (!termsMetrics.length || termsMetrics.some((metric) => metric.overflow)) {
    throw new Error(`약관 A4 단 넘침: ${JSON.stringify(termsMetrics)}`);
  }
  const fillRatios = termsMetrics.map((metric) => metric.used / metric.available);
  const usedHeights = termsMetrics.map((metric) => metric.used);
  if (Math.min(...fillRatios) < 0.985 || Math.max(...usedHeights) - Math.min(...usedHeights) > 18) {
    throw new Error(`약관 A4 단 균형 이탈: ${JSON.stringify(termsMetrics)}`);
  }
  console.log(`terms-metrics=${JSON.stringify(termsMetrics)}`);
  console.log(`terms-pages=${JSON.stringify(termsPageFrames)}`);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(1_000);
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await writeFile(outputPath, pdf);
  console.log(outputPath);
} finally {
  await browser.close();
}
