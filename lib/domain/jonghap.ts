/**
 * 종합표 생성 — v4 매물+정책 → 프리패스 종합시트. (freepasserp3 jonghap-export.js 이식)
 * 기간=표준 1·12·24·36·48·60 (product.PERIODS). 6·18 등 별도 기간은 종합표 밖·상세에서 관리.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { fuelDisplay, fuelEmbeddedCc } from '@/lib/domain/vehicle-master-match';
// 구분은 화면·필터와 같은 캐논을 쓴다 — 여기서 새로 적으면 종합표만 다른 말을 한다.
import { canonProductType } from '@/lib/domain/product';

/**
 * ★열 순서를 **차종 5단계에 맞춰** 고쳤다(2026-08-10 사장님 지시).
 *
 * 우리 축은 제조사 → 모델 → **세부모델 → 파워트레인 → 세부트림** → 옵션이다.
 * 옛 41열은 「트림」 한 칸뿐이라 파워트레인이 설 자리가 없었고, 연식도 아예 없었다
 * (최초등록만 있어서 「몇 년식이냐」를 등록일로 짐작해야 했다).
 *
 *   세부모델 뒤   외장·내장 → 연식·연료·주행    «무슨 차인가»를 한 번에 읽는다
 *   대여료 뒤     파워트레인·세부트림 → 옵션    좁혀지는 순서대로 선다
 *
 * ⚠ 예전 주석의 「절대 임의변경 금지」는 **사람이 손으로 붙여넣던 시절**의 규칙이다.
 *   지금은 우리가 API 로 직접 쓰고 머리행도 같이 올리므로 순서가 스스로 맞는다.
 *   그래도 바꿀 때는 이 파일 하나만 고친다 — 서식(`jonghap-format.ts`)은 이름으로 열을 찾는다.
 */
export const JONGHAP_COLUMNS = [
  '상태', '입고일자', '구분', '차량번호', '차종분류', '세부모델',
  '외장', '내장', '연식', '연료', 'Km',
  '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '파워트레인', '세부트림', '옵션',
  '최초등록', '소비자가격', '제조사', '배기량', '차고지',
  '운전자범위', '연주행', '분납', '21세', '23세', '1만+',
  '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌',
  // 「공급사」는 코드(RP004)가 아니라 **회사 이름**이다 — 영업자가 코드를 외우지 않는다.
  // 법인격(「주식회사」·「(주)」)은 떼고 부른다. 표기는 `companyAlias` 하나가 정한다.
  '비고', '공급사', '정책코드',
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

/**
 * 구분 — **신차렌트 · 중고렌트 · 신차구독 · 중고구독** 네 가지(사장님 지적 2026-08-10).
 *
 * 옛 종합표는 「신차」·「중고」 둘로만 뭉갰다. 그때는 구독이 없었지만 지금은 별개 상품이라,
 * 뭉개면 영업자가 렌트인지 구독인지 모른 채 안내한다.
 * 저장값엔 옛 표기(「재렌트」·「신차(선출고)」)가 남아 있으므로 `canonProductType` 으로 편다 —
 * 화면·필터가 쓰는 그 함수 그대로다(여기서 새로 적으면 종합표만 다른 말을 한다).
 */
function gubun(p: EntityRecord): string {
  return canonProductType(p.product_type);
}

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
    /**
     * 연식 — 옛 41열엔 아예 없어서 「몇 년식이냐」를 최초등록일로 짐작해야 했다.
     * 연식(모델연도)과 최초등록일은 다르다 — 25년식이 26년 1월에 등록되기도 한다.
     * 둘 다 싣고, 연식이 비면 최초등록에서 연도만 뽑아 채운다(없는 값을 지어내진 않는다).
     */
    연식: (() => {
      const y = String(p.year ?? '').replace(/[^\d]/g, '');
      if (y.length === 4) return y;
      const m = /(20\d{2}|19\d{2})/.exec(String(p.first_registration_date ?? ''));
      return m ? m[1] : '';
    })(),
    Km: p.mileage ? String(p.mileage) : '', 단기보증: anyDep, '1개월': rent('1'), '12개월': rent('12'),
    장기보증: anyDep, '24개월': rent('24'), '36개월': rent('36'), '48개월': rent('48'), '60개월': rent('60'),
    // 차종 5단계의 뒤 두 칸 — 좁혀지는 순서대로 선다(세부모델 → 파워트레인 → 세부트림).
    파워트레인: String(p.variant || ''), 세부트림: String(p.trim_name || ''),
    옵션: String(p.options || ''), 최초등록: String(p.first_registration_date || ''), 소비자가격: won(p.vehicle_price),
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
  /**
   * ★차량번호가 없다고 빼지 않는다(2026-08-10).
   *
   * 옛 규격은 «차번이 곧 차»라 차번 없는 행을 버렸다. 지금은 **번호미정 신차**를 판다 —
   * 번호가 나오기 전에도 차종·가격이 정해져 있고 실제로 계약이 붙는다.
   * 실측: 409대 중 8대가 이 경우인데, 버리면 종합표만 401대가 되어
   * 같은 시트의 두 탭이 서로 다른 대수를 말한다 — 영업자가 어느 쪽을 믿어야 할지 모른다.
   */
  const rows = products
    .filter((p) => p._deleted !== true)
    .sort((a, b) => String(a.maker).localeCompare(String(b.maker), 'ko') || String(a.model).localeCompare(String(b.model), 'ko') || String(a.car_number).localeCompare(String(b.car_number), 'ko'));
  // 셀 정화 — 자유텍스트(비고·옵션)에 탭/개행이 있으면 붙여넣기 행·열이 조용히 밀림. 공백 치환(v3 rowsToTsv clean 이식).
  const clean = (v: string) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  const body = rows.map((p) => productToRow(p, byCode).map(clean).join('\t'));
  return { tsv: [JONGHAP_COLUMNS.join('\t'), ...body].join('\n'), count: rows.length };
}

/** 열 이름 → 0-based 위치. 서식이 열 번호를 손으로 세지 않게 한다. */
export const JONGHAP_COL = (name: string) => JONGHAP_COLUMNS.indexOf(name);

/** 값만 필요한 곳(시트 쓰기)을 위한 2차원 배열. TSV 를 다시 쪼개지 않는다. */
export function buildJonghapValues(
  products: EntityRecord[],
  policies: EntityRecord[],
  opts: { origin?: string } = {},
): { values: (string | number)[][]; count: number } {
  const byCode = new Map(policies.map((p) => [String(p.policy_code || ''), p]));
  const rows = products
    .filter((p) => p._deleted !== true)
    .sort((a, b) => String(a.maker).localeCompare(String(b.maker), 'ko')
      || String(a.model).localeCompare(String(b.model), 'ko')
      || String(a.car_number).localeCompare(String(b.car_number), 'ko'));
  const clean = (v: string) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  /**
   * ★차량번호 칸에 상세 링크를 건다.
   *
   * 붙여넣기 시절엔 글자뿐이라 영업자가 차를 확인하려면 ERP 를 따로 열어야 했다.
   * 링크가 걸리면 시트에서 바로 그 차로 간다 — 새 표의 사진 칸과 같은 역할이다.
   * ⚠ 로컬 주소로는 걸지 않는다(공유 시트에 박히면 아무도 못 연다).
   */
  const base = String(opts.origin ?? '').trim();
  const shareable = /^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(base);
  const plateAt = JONGHAP_COL('차량번호');
  /** 숫자로 둬야 정렬·합계가 되는 칸 — 글자로 두면 「1,030,000」이 문자열로 줄 선다. */
  const numeric = new Set(['Km', '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월', '소비자가격', '배기량']
    .map((n) => JONGHAP_COL(n)));

  const values = rows.map((p) => {
    const cells: (string | number)[] = productToRow(p, byCode).map(clean);
    for (const i of numeric) {
      const n = Number(String(cells[i] ?? '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n) && String(cells[i] ?? '').trim() !== '') cells[i] = n;
    }
    const code = String(p.product_code || p._key || '').trim();
    const plate = String(cells[plateAt] ?? '').trim();
    if (shareable && code) {
      const label = plate || '번호미정';
      cells[plateAt] = `=HYPERLINK("${base}/q/"&ENCODEURL("${code.replace(/"/g, '""')}"),"${label.replace(/"/g, '""')}")`;
    }
    return cells;
  });
  return { values: [[...JONGHAP_COLUMNS], ...values], count: rows.length };
}
