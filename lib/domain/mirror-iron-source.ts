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
import { readFileSync } from 'node:fs';
import { fetchIronRentcarCatalog } from '@/lib/server/ironrentcar-source';
import { canonMirrorValue, normName, splitMakerModel } from './mirror-sheet-mapping';
import { canonMakerDisplay } from './maker-display';

/**
 * ★제조사·모델명은 **홈페이지 제목 글자에서만** 뽑는다(2026-08-19).
 *   예전엔 상세 파서가 만든 `product.maker/model`(차종마스터 스냅을 거친 값)을 썼는데, 제목이 제조사 없이 「QM6」 하나면
 *   스냅이 엉뚱한 차로 끌고 갔다 — 실측 244주9107 「QM6」 → 기아 레이. 제목에 제조사가 없으면 모델 이름으로 제조사를 «조회»한다
 *   (차종마스터에 그 모델이 한 제조사에만 있을 때만 — 추정이 아니라 사전 조회).
 */
const MODEL_MAKER = ((): Map<string, string> => {
  const out = new Map<string, string[]>();
  try {
    const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Record<string, unknown>;
    const rows = (Array.isArray(raw) ? raw : (raw.entries as unknown[])) || [];
    for (const r of rows as Record<string, unknown>[]) {
      const k = String(r.model ?? '').toLowerCase().replace(/[\s\-_.]/g, '');
      if (!k) continue;
      const mk = canonMakerDisplay(r.maker);
      const list = out.get(k) || []; if (!list.includes(mk)) list.push(mk); out.set(k, list);
    }
  } catch { /* 사전이 없으면 조회를 건너뛴다 */ }
  return new Map([...out].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
})();
const makerOfModel = (model: string) => MODEL_MAKER.get(String(model).toLowerCase().replace(/[\s\-_.]/g, '')) || '';

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
    const sp = splitMakerModel(title);
    const maker = canonMakerDisplay(sp.maker || makerOfModel(sp.model));
    put('차량번호', S(p.car_number));
    put('상태', item.sold ? '출고불가' : p.vehicle_status);
    put('분류', p.product_type);
    put('제조사', maker);
    // ★사장님 2026-08-19 「맨 위에 제조사 빼고 아래 연식 가기 전까지를 차명으로」 —
    //   홈페이지 제목 「기아 K8 프레스티지」 + 부제 「3.5LPG · 24년 3월 등록(24년식) · 47,400km」 → 모델명 「K8」 · 차명(세부모델+트림) 「K8 프레스티지 3.5LPG」 · 연식 2024 · 최초등록일 2024-03 · 주행거리 47,400.
    const titleNoMaker = sp.model || title;
    const subtitle = S(raw.subtitle);
    const specParts = subtitle.split('·').map(S).filter((seg) => seg && !/년식|등록|km$/i.test(seg));
    put('모델명', splitMakerModel(sp.model).model.split(' ')[0] || sp.model);
    put('차명(세부모델+트림)', [titleNoMaker, ...specParts].filter(Boolean).join(' '));
    const reg = /(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*등록/.exec(subtitle);
    if (reg) put('최초등록일', `${reg[1].length === 2 ? '20' + reg[1] : reg[1]}-${reg[2].padStart(2, '0')}`);
    // ★배기량 — 부제의 배기량 표기(「2.5T가솔린」·「1.6T하이브리드」·「3.5LPG」)를 그대로 cc 로. 공급사가 적은 글자이지 우리가 지어낸 값이 아니다.
    //   전기차(kWh)·표기 없는 차는 비운다. 리터 표기가 없으면 손대지 않는다(옛 값이 있으면 사람이 본다).
    const disp = /(\d)\.(\d)\s*T?\s*(?:가솔린|디젤|하이브리드|LPG|LPI)?/i.exec(specParts.join(' '));
    if (disp && S(p.fuel_type) !== '전기') put('배기량', String(Number(`${disp[1]}.${disp[2]}`) * 1000));
    if (!S(p.fuel_type) || S(p.fuel_type) === '-') { const f = /(하이브리드|LPG|LPI|디젤|가솔린|전기|수소)/i.exec(subtitle); if (f) put('연료', f[1].toUpperCase() === 'LPI' ? 'LPG' : f[1]); }
    put('옵션', p.options);
    put('외부색상', p.ext_color);
    put('내부색상', p.int_color);
    put('연식', p.year || raw.year);
    put('주행거리', p.mileage != null ? String(p.mileage) : '');
    if (S(p.fuel_type) !== '-') put('연료', p.fuel_type);
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
