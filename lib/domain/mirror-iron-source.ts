/**
 * **아이언렌트카 홈페이지 → 정제시트 줄.** 아이언(RP006)은 시트가 아니라 ironrentcar.com 이 정본이다.
 *
 * `fetchIronRentcarCatalog` 가 이미 상세 페이지를 우리 원자(car_number·price·색·옵션…)로 읽어 준다.
 * 여기서는 그 원자를 우리 규격 열 이름으로 옮겨 담기만 한다 — `sync-mirror-sheet --source=iron`.
 *
 * ★판매완료 차는 **주지 않는다** — 원본에서 사라진 차로 보여 미러 규칙대로 «줄은 남기고 상태만 출고불가»가 된다.
 *   (처음부터 47대 판매완료를 줄로 만들면 새 시트가 죽은 줄로 시작한다.)
 * ★보증금은 홈페이지가 한 값이다 → 「장기보증」(단기 기간이 있으면 「단기보증」에도).
 * ★표준 축 밖 기간(53개월 등 — 남은 약정 재렌트)은 표준 칸에 끼워 넣지 않는다(공급사 데이터 매뉴얼).
 *   대신 「기타기간①②③」에 「53개월 1,070,000」처럼 **글자로** 남긴다 — 파서는 안 읽고 사람은 본다(원문보존 후 검수).
 * ★사진링크 = 상세 페이지 주소(사진이 거기 있다). 차량가격은 관리자 전용 원자(privateProduct)에서.
 */
import { fetchIronRentcarCatalog } from '@/lib/server/ironrentcar-source';
import { canonMirrorValue, normName } from './mirror-sheet-mapping';

const S = (v: unknown) => String(v ?? '').trim();
// 제공시트 표준 6기간(`supplier-template-sheet.SHORT_PERIODS/LONG_PERIODS`) + 아이언 시트가 예비칸 제목을 바꿔 쓰는 72·84개월.
// (「아이언 프리패스 재고」 기타기간①→72개월 · ②→84개월, 2026-08-18.) 그 밖(53개월 등)은 기타기간③ 글자로.
const STANDARD_PERIODS = new Set(['1', '12', '24', '36', '48', '60', '72', '84']);
const SHORT_PERIODS = new Set(['1']);
const won = (n: unknown) => { const x = Number(n); return Number.isFinite(x) && x > 0 ? String(Math.round(x)) : ''; };

export async function rowsFromIronCatalog(): Promise<{
  rows: Map<string, Map<string, string>>; listings: number; active: number; sold: number; errors: number; complete: boolean; oddPeriods: string[];
}> {
  const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
  const rows = new Map<string, Map<string, string>>();
  const odd = new Set<string>();
  for (const item of catalog.items) {
    if (item.sold) continue;
    const p = item.product as Record<string, any>;
    const plate = normName(p.car_number);
    if (!plate || rows.has(plate)) continue;
    const m = new Map<string, string>();
    const put = (col: string, v: unknown) => { const s = S(v); if (s) m.set(normName(col), canonMirrorValue(col, s)); };
    const raw = (p._raw_vehicle || {}) as Record<string, string>;
    const title = S(raw.title);
    const maker = S(p.maker || raw.maker);
    put('차량번호', S(p.car_number));
    put('상태', item.sold ? '출고불가' : p.vehicle_status);
    put('분류', p.product_type);
    put('제조사', maker);
    // 차명(트림) = 홈페이지 제목에서 제조사만 뗀 것(「모델Y 주니퍼 RWD」). 제목이 없으면 모델+트림.
    put('차명(트림)', title ? title.replace(new RegExp(`^${maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '') : [S(raw.model), S(raw.trim_name)].filter(Boolean).join(' '));
    put('옵션', p.options);
    put('외부색상', p.ext_color);
    put('내부색상', p.int_color);
    put('연식', p.year || raw.year);
    put('주행거리', p.mileage != null ? String(p.mileage) : '');
    put('연료', p.fuel_type);
    put('차량가격', won((item.privateProduct as Record<string, any>)?.vehicle_price));
    let deposit = '';
    let hasShort = false;
    const oddHere: string[] = [];
    for (const [period, v] of Object.entries((p.price || {}) as Record<string, { rent: number; deposit: number }>)) {
      const key = String(period).replace(/[^\d]/g, '');
      if (!deposit) deposit = won(v.deposit);
      if (!STANDARD_PERIODS.has(key)) { odd.add(`${key}개월`); oddHere.push(`${key}개월 ${Number(won(v.rent)).toLocaleString('ko-KR')}`); continue; }
      put(`${key}개월`, won(v.rent));
      if (SHORT_PERIODS.has(key)) hasShort = true;
    }
    if (deposit) { put('장기보증', deposit); if (hasShort) put('단기보증', deposit); }
    if (oddHere.length) put('기타기간③', oddHere.join(' / '));
    put('사진링크', p.source_url || item.sourceUrl);
    rows.set(plate, m);
  }
  return { rows, listings: catalog.listings, active: catalog.active, sold: catalog.sold, errors: catalog.errors.length, complete: catalog.complete, oddPeriods: [...odd] };
}
