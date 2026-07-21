/**
 * 종합표 생성 — v4 매물+정책 → 프리패스 종합시트 41컬럼 TSV. (freepasserp3 jonghap-export.js 이식)
 * 직원이 구글시트 종합탭에 붙여넣기 하던 작업 대체. 컬럼 순서=시트 헤더와 1:1(절대 임의변경 금지).
 * 기간=표준 1·12·24·36·48·60 (product.PERIODS). 6·18 등 별도 기간은 종합표 밖·상세에서 관리.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { fuelDisplay, fuelEmbeddedCc } from '@/lib/domain/vehicle-master-match';

export const JONGHAP_COLUMNS = [
  '상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델', '연료', '외장', '내장', 'Km',
  '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '트림', '옵션', '최초등록', '소비자가격', '제조사', '배기량', '차고지',
  '운전자범위', '연주행', '분납', '21세', '23세', '1만+',
  '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌',
  '비고', '공급사코드', '정책코드',
];

const won = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return n ? n.toLocaleString('ko-KR') : ''; };
const shortLimit = (v: unknown) => String(v ?? '').replace(/원$/, '').trim();
const manOnly = (v: unknown) => { const s = String(v ?? '').trim(); if (!s || s === '없음') return s; const m = s.match(/([\d,]+)\s*만/); return m ? m[1] : s; };
const stripYearly = (v: unknown) => String(v ?? '').replace(/^연간\s*/, '').trim();
const ownComp = (v: unknown) => String(v ?? '').replace(/가액$/, '').trim();

type Pol = Record<string, unknown> | null | undefined;
function policyCells(pol: Pol): Record<string, string> {
  if (!pol) return {};
  const join = (limit: unknown, ded: unknown) => { const l = shortLimit(limit), d = manOnly(ded); if (!l && !d) return ''; return d ? `${l}/${d}` : l; };
  const own = () => {
    const comp = ownComp(pol.own_damage_compensation);
    const lo = manOnly(pol.own_damage_min_deductible), hi = manOnly(pol.own_damage_max_deductible);
    const range = lo && hi ? `${lo}~${hi}` : (lo || hi || '');
    if (!comp && !range) return ''; return range ? `${comp}/${range}` : comp;
  };
  return {
    운전자범위: String(pol.personal_driver_scope || ''),
    연주행: stripYearly(pol.annual_mileage),
    분납: String(pol.deposit_installment || '').replace('불가능', '불가'),
    대인: join(pol.injury_compensation_limit, pol.injury_deductible),
    대물: join(pol.property_compensation_limit, pol.property_deductible),
    자차: own(),
    자손: join(pol.self_body_accident, pol.self_body_deductible),
    무보험: shortLimit(pol.uninsured_damage),
    정비: String(pol.maintenance_service || ''),
  };
}

function gubun(p: EntityRecord): string { const t = String(p.product_type || ''); if (t.startsWith('신차')) return '신차'; return t ? '중고' : ''; }

function productToRow(p: EntityRecord, byCode: Map<string, EntityRecord>): string[] {
  const pol = (p._policy as Pol) || (p.policy_code ? byCode.get(String(p.policy_code)) : null);
  const c = policyCells(pol);
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number }>;
  const rent = (m: string) => {
    if (price[m]?.rent) return won(price[m].rent);
    const pre = m + '_';
    const vals = Object.entries(price).filter(([k]) => k.startsWith(pre)).map(([, v]) => Number(v?.rent) || 0).filter((v) => v > 0);
    return vals.length ? won(Math.min(...vals)) : '';
  };
  const anyDep = (() => { for (const v of Object.values(price)) if (v?.deposit) return won(v.deposit); return ''; })();
  const meta = (p.sheet_meta || {}) as Record<string, unknown>;
  const byCol: Record<string, string> = {
    상태: String(p.vehicle_status || ''), 입고일자: String(p.arrival_note || ''), 구분: gubun(p), 차량번호: String(p.car_number || ''),
    차종분류: String(p.model || ''), 세부모델: String(p.sub_model || ''), 연료: fuelDisplay(p.fuel_type) || String(p.fuel_type || ''), 외장: String(p.ext_color || ''), 내장: String(p.int_color || ''),
    Km: p.mileage ? String(p.mileage) : '', 단기보증: anyDep, '1개월': rent('1'), '12개월': rent('12'),
    장기보증: anyDep, '24개월': rent('24'), '36개월': rent('36'), '48개월': rent('48'), '60개월': rent('60'),
    트림: String(p.trim_name || ''), 옵션: String(p.options || ''), 최초등록: String(p.first_registration_date || ''), 소비자가격: won(p.vehicle_price),
    제조사: String(p.maker || ''), 배기량: (() => { const cc = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type); return cc > 0 ? String(cc) : ''; })(), 차고지: String(p.location || ''),
    ...c,
    '21세': String(meta.age_21 || ''), '23세': String(meta.age_23 || meta.age_21 || ''), '1만+': String(meta.year_1plus || ''),
    전용계좌: '', 비고: String(p.partner_memo || ''), 공급사코드: String(p.provider_company_code || p.partner_code || ''), 정책코드: String(p.policy_code || ''),
  };
  return JONGHAP_COLUMNS.map((col) => byCol[col] ?? '');
}

/** 매물+정책 → 종합 41컬럼 TSV(헤더 포함). 삭제·차번없는 매물 제외, 제조사·모델·차번 정렬. */
export function buildJonghapTsv(products: EntityRecord[], policies: EntityRecord[]): { tsv: string; count: number } {
  const byCode = new Map(policies.map((p) => [String(p.policy_code || ''), p]));
  const rows = products
    .filter((p) => p.car_number && p._deleted !== true)
    .sort((a, b) => String(a.maker).localeCompare(String(b.maker), 'ko') || String(a.model).localeCompare(String(b.model), 'ko') || String(a.car_number).localeCompare(String(b.car_number), 'ko'));
  // 셀 정화 — 자유텍스트(비고·옵션)에 탭/개행이 있으면 붙여넣기 행·열이 조용히 밀림. 공백 치환(v3 rowsToTsv clean 이식).
  const clean = (v: string) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const body = rows.map((p) => productToRow(p, byCode).map(clean).join('\t'));
  return { tsv: [JONGHAP_COLUMNS.join('\t'), ...body].join('\n'), count: rows.length };
}
