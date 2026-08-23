import {
  buildFrozenFreepassHtml,
  renderFreepassPdf,
} from '@/lib/server/freepass-esign-document';
import type { EsignRecord } from '@/lib/server/freepass-esign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 검토용 값만 주입한 샘플이다. HTML 원본·봉인 조립·PDF 렌더 경로는 실제 계약과 같다.
 * 정적 PDF를 따로 보관하면 원본 서식이 고쳐진 뒤 샘플이 낡아지는 문제가 생긴다.
 */
const SAMPLE_SNAPSHOT: EsignRecord = {
  templateState: { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' },
  templateFields: {
    doc_title: '프리패스 표준 자동차 장기대여 계약서',
    doc_kicker: 'FREEPASS STANDARD LONG-TERM VEHICLE RENTAL AGREEMENT · SAMPLE',
    product_label: '렌트 · 보험료 포함형',
    company_name: '샘플렌터카 주식회사', company_ceo: '김대표', company_ceo_title: '대표이사',
    company_biz_no: '000-00-00000', rental_business_no: '서울-대여-0000', company_phone: '02-0000-0000',
    company_address: '서울특별시 샘플구 예시로 00', payment_bank: '샘플은행',
    payment_account_no: '000-0000-0000', payment_account_holder: '샘플렌터카 주식회사',
    contract_no: 'SAMPLE-2026-0001', contract_code: 'SAMPLE-2026-0001', contract_date: '2026. 08. 11.',
    customer_name: '홍길동', customer_id: '900101-1******', driver_or_biz_no: '서울00-00-000000-00',
    customer_phone: '010-0000-0000', customer_address: '서울특별시 샘플구 예시동 00',
    car_number: '00가0000', vin: 'KMH-SAMPLE-000001', vehicle_name: '2026 현대 아반떼 1.6 가솔린 모던',
    fuel: '가솔린', engine_cc: '1,598cc', model_year: '2026년식',
    options: '내비게이션, 후방카메라, 스마트크루즈', color_exterior: '아틀라스 화이트', color_interior: '블랙', odometer_delivery: '10km',
    vehicle_classification: '중고렌트', rent_month: '차량 인도일로부터 36개월',
    contract_start: '2026. 08. 15.', contract_end: '2029. 08. 14.', rent_amount: '650,000', deposit_amount: '3,000,000',
    deposit_installment: '일시납', annual_mileage: '연 20,000km', driver_age: '만 26세 이상 · 만 70세 이하',
    driver_scope: '계약자 본인만', insurance_condition: '보험료 포함 (월 대여료에 포함)', insurer_name: '전국렌터카공제조합',
    coverage_liability_person: '무한', coverage_liability_property: '1억원',
    coverage_self_injury: '사망·후유장애 1인당 3천만원 · 부상 1인당 1,500만원', coverage_uninsured: '미가입',
    coverage_own_damage: '시세 기준', self_damage_coverage: '시세 기준', annual_roadside_assistance: '연 5회',
    deductible_liability_person: '30만원', deductible_liability_property: '30만원',
    self_damage_deductible_rate: '20%', self_damage_deductible_min: '50만원', self_damage_deductible_max: '100만원',
    self_damage_exclusions: '단독사고, 가해자 불명, 휠·타이어 단독 손상, 전손, 고의·관리 소홀',
    maintenance_product: '미제공', maintenance_replacement: '미제공', designated_garage: '임대인 지정 협력 정비공장',
    replacement_car_policy: '미가입 시 미제공', payment_cycle: '월납', payment_timing: '선불', payment_method: 'CMS 자동이체',
    auto_debit_date: '매월 10일', invoice_type: '세금계산서', invoice_cycle: '월 1회', over_mileage_rate: '1km당 200원',
    early_termination_rate_y1: '30', early_termination_rate_y2: '20', succession_allowed: '협의', succession_fee: '1,000,000',
    late_fee_rate: '연 24%', deposit_return_term: '반납·정산 후 7일 이내', engine_control_overdue_days: '3',
    auto_terminate_overdue_days: '10', deposit_overdue_rounds: '2', accident_termination_count: '각 사고 발생일 기준 직전 1년 내 과실 50% 이상 총 3회',
    claim_basis: '잔여 대여료 상당액 또는 중도해지수수료 중 하나', renewal_notice_days: '30', buyout_notice_days: '30',
    impound_keep_term: '반환 통지 후 7일', impound_fee: '1일 10,000원', gps_installed: '장착',
    buyback_option: '만기 반납 · 인수 별도 협의', buyback_price: '만기 협의', special_terms: '없음',
  },
};

export async function GET() {
  try {
    const html = await buildFrozenFreepassHtml(SAMPLE_SNAPSHOT, '', '');
    const pdf = await renderFreepassPdf(html);

    return new Response(Uint8Array.from(pdf).buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="freepass-current-contract-sample.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      { message: '현재 계약서 원본으로 샘플 PDF를 만들지 못했습니다.' },
      { status: 404 },
    );
  }
}
