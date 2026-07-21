/**
 * 매물 엑셀(xlsx) 다운로드 — v3 PRODUCT_COLS 이식(전체 컬럼: 식별·스펙·기간별가격·보험·대여조건·관리자).
 * 화면 엑셀뷰는 스캔 핵심만, 실제 xlsx는 여기서 45+컬럼 풀. SheetJS 지연 로드.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, creditDisplay, canonProductType } from '@/lib/domain/product';
import { excelMonths } from '@/lib/domain/product-filters';
import { fuelDisplay, fuelEmbeddedCc } from '@/lib/domain/vehicle-master-match';
import { BRAND } from '@/lib/brand';

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' ? '' : Number(v) || '');
// 정책값 = 매물 임베드 _policy 우선 → 매물 최상위 폴백
const pol = (p: EntityRecord, k: string) => {
  const embed = (p._policy as Record<string, unknown> | undefined)?.[k];
  return str(embed ?? (p as Record<string, unknown>)[k]);
};

type Col = [string, (p: EntityRecord) => string | number];

function buildCols(data: EntityRecord[]): Col[] {
  const months = excelMonths(data);
  // 대여료·보증 = 만원(정수). 원 단위는 상세페이지.
  const toMan = (n: number) => (n ? Math.round(n / 10000) : 0);
  const priceCols: Col[] = months.flatMap((m): Col[] => [
    [`${m}개월 대여료(만)`, (p) => { const e = priceList(p).find((x) => x.m === m); return e ? toMan(e.rent) : ''; }],
    [`${m}개월 보증금(만)`, (p) => { const e = priceList(p).find((x) => x.m === m); return e ? toMan(e.deposit) : ''; }],
  ]);
  return [
    // 상태·구분
    ['차량상태', (p) => str(p.vehicle_status)],
    ['상품분류', (p) => canonProductType(p.product_type)],
    ['심사여부', (p) => creditDisplay(p)],
    // 식별·차종 5단계
    ['차량번호', (p) => str(p.car_number)],
    ['제조사', (p) => str(p.maker)],
    ['모델', (p) => str(p.model)],
    ['세부모델', (p) => str(p.sub_model)],
    ['파워트레인', (p) => str(p.variant)],
    ['세부트림', (p) => str(p.trim_name)],
    // 스펙
    ['연식', (p) => str(p.year)],
    ['주행거리', (p) => num(p.mileage)],
    ['연료', (p) => fuelDisplay(p.fuel_type) || str(p.fuel_type)],
    ['구동', (p) => str(p.drive_type)],
    ['배기량', (p) => num(p.engine_cc) || fuelEmbeddedCc(p.fuel_type) || ''],
    ['인승', (p) => num(p.seats)],
    ['외장색', (p) => str(p.ext_color)],
    ['내장색', (p) => str(p.int_color)],
    ['용도', (p) => str(p.usage)],
    ['최초등록', (p) => str(p.first_registration_date)],
    ['차대번호', (p) => str(p.vin)],
    ['옵션', (p) => str(p.options)],
    // 기간별 대여료·보증금
    ...priceCols,
    // 대여기본
    ['연간주행거리', (p) => pol(p, 'annual_mileage')],
    ['보험포함', (p) => pol(p, 'insurance_included')],
    ['신용등급', (p) => pol(p, 'credit_grade')],
    // 보험(한도·면책금)
    ['대인한도', (p) => pol(p, 'injury_compensation_limit')],
    ['대인면책금', (p) => pol(p, 'injury_deductible')],
    ['대물한도', (p) => pol(p, 'property_compensation_limit')],
    ['대물면책금', (p) => pol(p, 'property_deductible')],
    ['자손사고', (p) => pol(p, 'self_body_accident')],
    ['자손면책금', (p) => pol(p, 'self_body_deductible')],
    ['무보험상해', (p) => pol(p, 'uninsured_damage')],
    ['무보험면책금', (p) => pol(p, 'uninsured_deductible')],
    ['자차보상', (p) => pol(p, 'own_damage_compensation')],
    ['자차자기부담율', (p) => pol(p, 'own_damage_repair_ratio')],
    ['자차면책최소', (p) => pol(p, 'own_damage_min_deductible')],
    ['자차면책최대', (p) => pol(p, 'own_damage_max_deductible')],
    ['긴급출동', (p) => pol(p, 'annual_roadside_assistance')],
    // 대여조건
    ['1만km추가', (p) => pol(p, 'mileage_upcharge_per_10000km')],
    ['보증금분납', (p) => pol(p, 'deposit_installment')],
    ['카드결제', (p) => pol(p, 'deposit_card_payment')],
    ['결제방법', (p) => pol(p, 'payment_method')],
    ['대여지역', (p) => pol(p, 'rental_region')],
    ['탁송비', (p) => pol(p, 'delivery_fee')],
    ['위약금', (p) => pol(p, 'penalty_condition')],
    ['연령하향', (p) => pol(p, 'driver_age_lowering')],
    ['연령상한', (p) => pol(p, 'driver_age_upper_limit')],
    ['연령하향비용', (p) => pol(p, 'age_lowering_cost')],
    ['개인운전자범위', (p) => pol(p, 'personal_driver_scope')],
    ['사업자운전자범위', (p) => pol(p, 'business_driver_scope')],
    ['추가운전자수', (p) => pol(p, 'additional_driver_allowance_count')],
    ['추가운전자비용', (p) => pol(p, 'additional_driver_cost')],
    ['정비서비스', (p) => pol(p, 'maintenance_service')],
    // 관리자
    ['공급사', (p) => str(p.provider_name) || str(p.provider_company_code)],
    ['정책명', (p) => pol(p, 'policy_name') || str(p.policy_name)],
    ['차량가격', (p) => num(p.vehicle_price)],
    ['위치', (p) => str(p.location)],
    ['특이사항', (p) => pol(p, 'partner_memo') || str(p.note)],
  ];
}

/** 현재(필터된) 매물 목록을 전체 컬럼 xlsx로 다운로드. */
export async function downloadProductsExcel(data: EntityRecord[], dateStr: string): Promise<void> {
  const XLSX = await import('xlsx');
  const cols = buildCols(data);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const header = [...cols.map((c) => c[0]), 'ERP'];
  const aoa: (string | number)[][] = [header, ...data.map((p) => [...cols.map((c) => c[1](p)), '열기'])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // ERP 문의 하이퍼링크 — 차량별 상세로 이동(erp3 excel ?car= 이식)
  const erpCol = cols.length;
  for (let r = 0; r < data.length; r++) {
    const ref = XLSX.utils.encode_cell({ r: r + 1, c: erpCol });
    const cell = ws[ref] as { l?: { Target: string; Tooltip?: string } } | undefined;
    if (cell) cell.l = { Target: `${origin}/m/${encodeURIComponent(String(data[r].product_code || ''))}`, Tooltip: 'ERP에서 열기' };
  }
  ws['!cols'] = [...cols.map((c) => ({ wch: Math.max(8, Math.min(20, c[0].length + 4)) })), { wch: 6 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: cols.length } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '매물');
  XLSX.writeFile(wb, `${BRAND}_매물_${dateStr}.xlsx`);
}

/** 정산 목록 xlsx — 순수익(net)은 관리자만 포함. */
export async function downloadSettlementsExcel(data: EntityRecord[], dateStr: string, includeNet: boolean): Promise<void> {
  const XLSX = await import('xlsx');
  const cols: [string, (s: EntityRecord) => string | number][] = [
    ['정산코드', (s) => str(s.settlement_code)], ['계약코드', (s) => str(s.contract_code)],
    ['계약자', (s) => str(s.customer_name)], ['차량번호', (s) => str(s.car_number)],
    ['공급사', (s) => str(s.provider_company_code)], ['영업자', (s) => str(s.agent_code)],
    ['월대여료', (s) => num(s.rent_amount)], ['공급사청구', (s) => num(s.fee_amount)], ['영업지급', (s) => num(s.agent_payout)],
    ...(includeNet ? [['순수익', (s: EntityRecord) => num(s.net_amount)] as [string, (s: EntityRecord) => string | number]] : []),
    ['환수', (s) => num(s.clawback_amount)], ['상태', (s) => str(s.settlement_status)], ['계약일', (s) => str(s.contract_date)],
  ];
  const header = cols.map((c) => c[0]);
  const aoa: (string | number)[][] = [header, ...data.map((s) => cols.map((c) => c[1](s)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map((c) => ({ wch: Math.max(8, c[0].length + 4) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: cols.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '정산');
  XLSX.writeFile(wb, `${BRAND}_정산_${dateStr}.xlsx`);
}

// 그룹 소계행 만들기 — [그룹명·건수·공급사청구(R1)·영업지급(R2)·순수익·환수] + 합계.
function subtotalAoa(data: EntityRecord[], keyField: string, headLabel: string): (string | number)[][] {
  const m = new Map<string, EntityRecord[]>();
  for (const s of data) { const k = str(s[keyField]) || '(미지정)'; const a = m.get(k); if (a) a.push(s); else m.set(k, [s]); }
  const sum = (list: EntityRecord[], f: (s: EntityRecord) => unknown) => list.reduce((n, s) => n + (Number(f(s)) || 0), 0);
  const rows = [...m.entries()].map(([name, list]) => ({
    name, n: list.length,
    r1: sum(list, (s) => s.fee_amount), r2: sum(list, (s) => s.agent_payout),
    net: sum(list, (s) => s.fee_amount) - sum(list, (s) => s.agent_payout), cb: sum(list, (s) => s.clawback_amount),
  })).sort((a, b) => b.net - a.net);
  const header = [headLabel, '건수', '공급사청구', '영업지급', '순수익', '환수'];
  const body: (string | number)[][] = rows.map((g) => [g.name, g.n, g.r1, g.r2, g.net, g.cb]);
  const total: (string | number)[] = ['합계', data.length, sum(data, (s) => s.fee_amount), sum(data, (s) => s.agent_payout), sum(data, (s) => s.fee_amount) - sum(data, (s) => s.agent_payout), sum(data, (s) => s.clawback_amount)];
  return [header, ...body, total];
}

/** 월별 정산서 — 내역 + 공급사별 소계 + 영업채널별 소계 3시트. 환수는 소계·합계에 반영. (관리자 정산서 배포용) */
export async function downloadSettlementReport(data: EntityRecord[], month: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // 1) 내역
  const cols: [string, (s: EntityRecord) => string | number][] = [
    ['계약자', (s) => str(s.customer_name)], ['차량번호', (s) => str(s.car_number)], ['모델', (s) => str(s.sub_model_snapshot)],
    ['공급사', (s) => str(s.provider_company_code)], ['영업채널', (s) => str(s.agent_channel_code)], ['영업자', (s) => str(s.agent_code)],
    ['월대여료', (s) => num(s.rent_amount)], ['공급사청구', (s) => num(s.fee_amount)], ['영업지급', (s) => num(s.agent_payout)],
    ['순수익', (s) => num(s.net_amount)], ['환수', (s) => num(s.clawback_amount)], ['상태', (s) => str(s.settlement_status)], ['계약일', (s) => str(s.contract_date)],
  ];
  const detail: (string | number)[][] = [cols.map((c) => c[0]), ...data.map((s) => cols.map((c) => c[1](s)))];
  const wsD = XLSX.utils.aoa_to_sheet(detail);
  wsD['!cols'] = cols.map((c) => ({ wch: Math.max(8, c[0].length + 4) }));
  wsD['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: cols.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, wsD, '내역');
  // 2) 공급사별  3) 영업채널별
  const wsP = XLSX.utils.aoa_to_sheet(subtotalAoa(data, 'provider_company_code', '공급사'));
  wsP['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsP, '공급사별');
  const wsC = XLSX.utils.aoa_to_sheet(subtotalAoa(data, 'agent_channel_code', '영업채널'));
  wsC['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsC, '영업채널별');
  XLSX.writeFile(wb, `${BRAND}_정산서_${month}.xlsx`);
}
