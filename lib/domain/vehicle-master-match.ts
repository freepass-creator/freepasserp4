/**
 * 차종 SSOT 매칭 — 매물의 (거친/부분) 차종 정보를 차종마스터(vehicle-master 1805세대)의 실재 조합으로 스냅.
 *
 * ══ 제품 원칙 ══
 *   어떤 경로로 들어오든(시트·OCR·등록증·수기) 수집 원자를 전부 활용해
 *   손님·영업에게는 차종마스터 규격의차종정보만 제공한다. 표준화가 핵심.
 *
 * ══ 원자 구조 (결과 트리) ══
 *   제조사 → 모델 → 세부모델(세대) → 파워트레인(연료·배기·구동·인승) → 트림
 * 신호 원자(연식·연료·배기·인승·구동·트림·등록증명·옵션·OCR…)로 트리를 고른다.
 * 칸이 붙어 있든 쪼개져 있든 — 수집 신호를 한 블롭으로 모아 분해 후 매칭.
 * 재변환 시 _raw_vehicle 원본을 우선(이미 틀린 스냅값을 다시 쓰지 않음).
 *
 * ══ 없을 때 / 대응 안 될 때 ══
 *   · 맞출 수 있으면 맞춤. 억지 추측 금지.
 *   · 대응 불가·모호 → 그 원자는 미선택(공란) + 검수(_needs_master_review).
 *   · 결과 필드(variant·연료·배기·인승·구동·트림) = 마스터 노드 값만. 임의 재조합·기본값 주입 금지.
 *   · 예외(선택 힌트만, 저장값 아님): 구동 2WD|4WD 후보 중 신호 없음 → 2WD 쪽 variant 선호 가점.
 *   · 인승 = 세대 안에서 seat가 갈릴 때만(카니발 7/9 등). 단일 인승 차는 파워트레인에 인승 없음.
 *   · 트림 신호 없거나 사전 미매칭 → 공란 유지.
 *   · 모델·제조사 신호 전무 → 매칭 자체 null(저장 시 검수).
 *   · 표기 오류(가솔린 2 vs 2.0) = 마스터 JSON 라벨을 고친다. 런타임 폴리시 금지.
 *
 * 반환은 후보(confidence). high·중만 자동확정 경로, low·미매칭은 검수.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { classifyVehicleClass } from '@/lib/domain/vehicle-class';

export type MasterVariant = { label: string; fuel: string; displacement_l: number | null; turbo: boolean; drivetrain: string | null; seat: number | null; battery_kwh: number | null; trims: string[] };
export type MasterEntry = { id: string; maker: string; model: string; sub_model: string; gen_code: string; origin: string; year_start: string; year_end: string; title?: string; variants: MasterVariant[]; trims?: string[] };
export type SnapResult = { maker: string; model: string; sub_model: string; gen_code: string; year_start?: string; year_end?: string; variant?: string; trim_name?: string; fuel_type?: string; engine_cc?: string; seats?: string; drive_type?: string; year?: string; confidence: 'high' | 'medium' | 'low' };

/**
 * 차종 규격화에 쓰는 수집 원자(신호) SSOT.
 * 시트·OCR·등록증·메모·옵션 등 들어오는 모든 단서를 모아 마스터 트리에 맞춘다.
 * 출력(손님·영업에 보이는 차종)은 마스터 노드만 — 이 목록으로 임의 재조합하지 않음.
 */
export const VEHICLE_SIGNAL_KEYS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'catalog_id',
  'vehicle_name', 'cert_car_name', 'type_number', 'engine_type',
  'year', 'first_registration_date',
  'fuel_type', 'engine_cc', 'seats', 'drive_type', 'transmission',
  'vehicle_class', 'options', 'partner_memo', 'usage',
  '_ocr_registration',
] as const;
export type VehicleSignalKey = (typeof VEHICLE_SIGNAL_KEYS)[number];

/** 매물에 쌓인 신호 조각 — 빈값 제외. _raw_vehicle 원본 우선(재변환 시 틀린 스냅값 재사용 방지). */
export function collectVehicleSignals(p: EntityRecord): string[] {
  const base: EntityRecord = { ...p };
  const raw = p._raw_vehicle;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(raw as object)) {
      const v = String((raw as EntityRecord)[k] ?? '').trim();
      if (v) base[k] = v;
    }
  }
  const parts: string[] = [];
  for (const k of VEHICLE_SIGNAL_KEYS) {
    const v = base[k];
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s) parts.push(s);
  }
  return parts;
}

export function vehicleSignalBlob(p: EntityRecord): string {
  return collectVehicleSignals(p).join(' ');
}

/**
 * 매칭 입력 레코드 — 원본(_raw_vehicle) 신원·스펙을 현재 칸에 덮어 재스냅.
 * OCR·등록증 등 원본에 없는 추가 수집칸은 유지.
 */
export function withRawVehicleSignals(p: EntityRecord): EntityRecord {
  const raw = p._raw_vehicle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return p;
  const out: EntityRecord = { ...p };
  for (const k of [
    'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year',
    'fuel_type', 'engine_cc', 'seats', 'drive_type', 'vehicle_class',
    'catalog_id', 'vehicle_name', 'cert_car_name',
  ] as const) {
    const v = String((raw as EntityRecord)[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}

/**
 * 마스터 파워트레인 라벨 = SSOT. 숫자로 재조합·.0 폴리시 금지.
 * 표기가 틀리면 vehicle-master.json 라벨을 고친다.
 */
export function masterVariantLabel(v: Pick<MasterVariant, 'label'> | null | undefined): string {
  return String(v?.label ?? '').trim();
}

/** 이 세대 파워트레인들이 인승으로 갈리는지 — 2종 이상일 때만 인승 표기·저장. */
export function variantSeatsDiffer(variants: MasterVariant[] | null | undefined): boolean {
  const seats = new Set<number>();
  for (const v of variants || []) {
    if (v.seat != null && v.seat > 0) seats.add(v.seat);
  }
  return seats.size > 1;
}

/** 픽커 옵션 라벨 — 인승은 세대 내 갈릴 때만. 구동은 라벨에 없을 때만 보강. */
export function masterVariantOptionLabel(v: MasterVariant, variants: MasterVariant[]): string {
  const base = masterVariantLabel(v);
  const parts = [base];
  if (variantSeatsDiffer(variants) && v.seat != null && v.seat > 0) parts.push(`${v.seat}인승`);
  const drive = String(v.drivetrain || '').trim();
  if (drive && !base.includes(drive)) parts.push(drive);
  return parts.filter(Boolean).join(' · ');
}

/** 마스터 "(세부등급 없음)" 등 — 트림 미선택과 동일. 선택·저장 값으로 쓰지 않음. */
export function isNoTrimLabel(raw: unknown): boolean {
  const n = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!n) return true;
  return n === '(세부등급없음)' || n === '세부등급없음' || n === '없음' || n === '미선택' || n === '-' || n === '—';
}

/** 마스터에 실재하는 세부트림만(플레이스홀더 제외). */
export function realMasterTrims(list: string[] | null | undefined): string[] {
  return (list || []).filter((t) => !isNoTrimLabel(t));
}

/**
 * 수집 영문 트림 → 마스터 한글 트림.
 * 마스터 JSON은 한글 SSOT. 공급사·시트·OCR이 Premium/FLUX 등으로 주면 여기서 한글 노드로 맞춤.
 */
const TRIM_EN_KO: Record<string, string> = {
  smart: '스마트',
  modern: '모던',
  'modern plus': '모던 플러스',
  'modern+': '모던 플러스',
  premium: '프리미엄',
  flux: '플럭스',
  inspiration: '인스퍼레이션',
  exclusive: '익스클루시브',
  prestige: '프레스티지',
  noblesse: '노블레스',
  signature: '시그니처',
  calligraphy: '캘리그래피',
  caligraphy: '캘리그래피',
  convenience: '컨비니언스',
  style: '스타일',
  luxury: '럭셔리',
  ultimate: '얼티메이트',
  limited: '리미티드',
  standard: '스탠다드',
  trendy: '트렌디',
  gravity: '그래비티',
  elegance: '엘레강스',
  intensive: '인텐시브',
  le: 'LE',
  se: 'SE',
  sel: 'SEL',
  xline: 'X라인',
  'x line': 'X라인',
  'x-line': 'X라인',
  'n line': 'N라인',
  nline: 'N라인',
  'n-line': 'N라인',
  'gt line': 'GT라인',
  'gt-line': 'GT라인',
  gtline: 'GT라인',
  'gt ligne': 'GT라인',
};

/** 영문·표기흔들림 → 마스터 한글 트림. pool이 있으면 그중 실제 노드만 채택. */
export function canonMasterTrim(raw: unknown, pool?: string[] | null): string {
  const src = String(raw ?? '').trim();
  if (!src || isNoTrimLabel(src)) return '';
  const key = src.toLowerCase().replace(/\s+/g, ' ').trim();
  const mapped = TRIM_EN_KO[key] || TRIM_EN_KO[key.replace(/-/g, ' ')] || src;
  const list = pool && pool.length ? realMasterTrims(pool) : null;
  if (!list) return mapped;
  if (list.includes(mapped)) return mapped;
  if (list.includes(src)) return src;
  const nm = norm(mapped);
  const byNorm = list.find((t) => norm(t) === nm);
  if (byNorm) return byNorm;
  // 마스터가 아직 영문 노드(X Line)인데 신호는 한글(X라인)·영문 별칭인 경우
  const byAlias = list.find((t) => {
    const tk = String(t).toLowerCase().replace(/\s+/g, ' ').trim();
    const tMapped = TRIM_EN_KO[tk] || TRIM_EN_KO[tk.replace(/-/g, ' ')] || t;
    return tMapped === mapped || norm(tMapped) === nm;
  });
  return byAlias || '';
}

/** 드롭다운·검증용 — 매물의 값이 마스터 트리에 실재하는 경로인지(임의 추정 없음). */
export type ExactMasterPath = {
  entry: MasterEntry;
  variantIndex: number; // -1 = 파워트레인 미선택
  trim: string;         // 실트림만. 세부등급 없음 세대는 ''
};

/**
 * 제조사·모델·세부모델(또는 catalog_id)·파워트레인 라벨·트림이
 * 마스터 JSON에 있는 그대로일 때만 경로 반환. 비슷함·추정 금지.
 * 세부트림 없는 차(마스터 trims = 세부등급 없음)는 trim='' 이 정상 규격.
 */
export function resolveExactMasterPath(
  entries: MasterEntry[],
  p: Partial<Pick<EntityRecord, 'maker' | 'model' | 'sub_model' | 'catalog_id' | 'variant' | 'trim_name'>> | EntityRecord,
): ExactMasterPath | null {
  if (!entries.length) return null;
  const cat = String(p.catalog_id ?? '').trim();
  const maker = String(p.maker ?? '').trim();
  const model = String(p.model ?? '').trim();
  const sub = String(p.sub_model ?? '').trim();
  // gen_code(catalog_id)만으로 find 금지 — RG3=ICE+EV, KA4=더뉴+기본 등 동코드 다수.
  // 1) 제조사·모델·세부모델 완전일치 2) 동코드 후보를 신원으로 좁힘 3) 후보 1개일 때만 코드단독.
  const eq = (a: unknown, b: string) => String(a ?? '').replace(/\s+/g, ' ').trim() === b;
  let entry: MasterEntry | undefined;
  if (maker && model && sub) {
    entry = entries.find((e) => eq(e.maker, maker) && eq(e.model, model) && eq(e.sub_model, sub));
  }
  if (!entry && cat) {
    let cands = entries.filter((e) => String(e.gen_code ?? '').trim() === cat);
    if (maker) cands = cands.filter((e) => eq(e.maker, maker));
    if (model) cands = cands.filter((e) => eq(e.model, model));
    if (sub) {
      const hit = cands.find((e) => eq(e.sub_model, sub));
      if (hit) entry = hit;
    }
    if (!entry && cands.length === 1) entry = cands[0];
  }
  if (!entry) return null;
  if (maker && !eq(entry.maker, maker)) return null;
  if (model && !eq(entry.model, model)) return null;
  if (sub && !eq(entry.sub_model, sub)) return null;

  const wantVar = String(p.variant ?? '').trim();
  let variantIndex = -1;
  if (wantVar) {
    variantIndex = (entry.variants || []).findIndex((v) => masterVariantLabel(v) === wantVar);
    // 파워트레인 문구가 살짝 달라도(가솔린 2.5 vs 가솔린 2.5 2WD) 세대 경로까지 버리지 않음.
    // 미일치면 vIdx=-1(미선택) — 픽커가 "없는 차"로 초기화하던 원인.
  }
  const wantTrimRaw = String(p.trim_name ?? '').trim();
  const trimPool = realMasterTrims(
    variantIndex >= 0
      ? entry.variants[variantIndex]?.trims
      : (entry.trims || entry.variants?.flatMap((v) => v.trims || []) || []),
  );
  // 영문 Premium 등 → 한글 프리미엄. 마스터 실트림이면 채택, 아니면 미선택(경로 유지).
  const wantTrim = canonMasterTrim(wantTrimRaw, trimPool);
  if (wantTrim && trimPool.includes(wantTrim)) {
    return { entry, variantIndex, trim: wantTrim };
  }
  return { entry, variantIndex, trim: '' };
}

/** 구동 신호 정규화 — 전륜(FF)·4륜(AWD)·사륜 → 마스터 drivetrain 비교용 2WD|4WD. */
export function normDrive(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/\s/g, '');
  if (!s) return '';
  if (/4WD|AWD|4륜|사륜|네바퀴|4MATIC|XDRIVE|콰트로|FOUR/.test(s)) return '4WD';
  if (/2WD|전륜|후륜|FF|FR|이륜|FWD|RWD/.test(s)) return '2WD';
  return driveFromBlob(String(raw ?? ''));
}

/** 터보 신호 — 옵션·원동기·파워트레인 표기. */
export function turboHint(p: EntityRecord, blob: string): boolean {
  return /터보|\bturbo\b|(?:^|[^a-z0-9])t(?:$|[^a-z0-9])/i.test(
    `${p.variant || ''} ${p.engine_type || ''} ${p.options || ''} ${p.transmission || ''} ${blob}`,
  );
}

/** 파인더 차종 필터(매물 집계 5단: 제조사→모델→세부모델→파워트레인→세부트림). */
export type VehicleFilter = {
  maker: string; model: string; sub_model: string; variant: string; trim_name: string;
};
export const EMPTY_VEHICLE_FILTER: VehicleFilter = {
  maker: '', model: '', sub_model: '', variant: '', trim_name: '',
};
export function vehicleFilterCount(v: VehicleFilter): number {
  return [v.maker, v.model, v.sub_model, v.variant, v.trim_name].filter(Boolean).length;
}
export function matchVehicleFilter(p: EntityRecord, v: VehicleFilter): boolean {
  if (v.maker) {
    const pm = makerDisplay(p.maker) || String(p.maker || '');
    const vm = makerDisplay(v.maker) || v.maker;
    if (pm !== vm && String(p.maker || '') !== v.maker) {
      // 르노 국산 계열 표기 흔들림(르노코리아·르노삼성·르노) — 영문 Renault는 별도
      const reno = (s: string) => /르노/.test(s);
      if (!(reno(pm) && reno(vm))) return false;
    }
  }
  if (v.model && String(p.model || '') !== v.model) return false;
  if (v.sub_model && String(p.sub_model || '') !== v.sub_model) return false;
  if (v.variant && String(p.variant || '') !== v.variant) return false;
  if (v.trim_name && String(p.trim_name || '') !== v.trim_name) return false;
  return true;
}

/** 마스터 제조사 그룹(국산 먼저). */
export function masterMakerGroups(entries: MasterEntry[]): { origin: string; makers: string[] }[] {
  const isDom = new Map<string, boolean>();
  for (const e of entries) isDom.set(e.maker, (isDom.get(e.maker) || false) || e.origin === '국산');
  const dom: string[] = [], imp: string[] = [];
  for (const [m, d] of isDom) (d ? dom : imp).push(m);
  dom.sort((a, b) => a.localeCompare(b, 'ko'));
  imp.sort((a, b) => a.localeCompare(b, 'ko'));
  return [{ origin: '국산', makers: dom }, { origin: '수입', makers: imp }];
}
export function masterModels(entries: MasterEntry[], maker: string): string[] {
  if (!maker) return [];
  return [...new Set(entries.filter((e) => e.maker === maker).map((e) => e.model))].sort((a, b) => a.localeCompare(b, 'ko'));
}
export function masterSubs(entries: MasterEntry[], maker: string, model: string): MasterEntry[] {
  if (!maker || !model) return [];
  return entries.filter((e) => e.maker === maker && e.model === model);
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
// 학습 정규화 — 엔카/시트 표기를 매칭 가능 값으로. 실측(v3 522매물): 이 둘로 99%→100% 매칭.
//  · 연식 "17년식"/"2017-03" → 2017 (매처가 Number()로 NaN 되던 구멍)
//  · 연료 별칭 휘발유=가솔린·경유=디젤·엘피지=lpg 등
export function parseYear(y: unknown): number { const m = /(\d{2,4})/.exec(String(y ?? '')); if (!m) return 0; const n = Number(m[1]); return n > 1900 ? n : n < 50 ? 2000 + n : 1900 + n; }
/** 연식 표시 SSOT — 두 자리+년(24년). "24년식"·"2017-03" → 24년·17년. */
export function yearDisplay(raw: unknown): string {
  const n = parseYear(raw);
  if (n <= 0) return '';
  return `${String(n % 100).padStart(2, '0')}년`;
}
const FUEL_ALIAS: Record<string, string> = { 휘발유: '가솔린', 가솔린: '가솔린', 경유: '디젤', 디젤: '디젤', 엘피지: 'lpg', lpg: 'lpg', 하이브리드: '하이브리드', hev: '하이브리드', 전기: '전기', ev: '전기', 수소: '수소' };
// 부분일치까지 — "가솔린2.0"·"HEV1.6"·"LPG 2.0" 처럼 연료 뒤에 배기량 붙는 실표기 흡수.
export const normFuel = (f: unknown) => { const n = norm(f); if (FUEL_ALIAS[n]) return FUEL_ALIAS[n]; for (const k of Object.keys(FUEL_ALIAS)) if (n.includes(k)) return FUEL_ALIAS[k]; return n; };

/** 연료 표시 SSOT — "가솔린1.0"·"LPG3.0" → 가솔린·LPG. 배기량은 engine_cc. */
export function fuelDisplay(raw: unknown): string {
  const n = normFuel(raw);
  if (!n || n === '-') return '';
  if (n === 'lpg') return 'LPG';
  if (n === '가솔린' || n === '디젤' || n === '하이브리드' || n === '전기' || n === '수소') return n;
  return '';
}

/**
 * 제조사 표시 SSOT — 법인 접미사 제거.
 * 르노코리아→르노, KG모빌리티→KG, 케이지모빌리티→케이지.
 */
export function makerDisplay(raw: unknown): string {
  const src = String(raw || '').trim();
  if (!src) return '';
  let s = src
    .replace(/코리아/gi, '')
    .replace(/모빌리티/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^kgm?$/i.test(s)) s = 'KG';
  return s || src;
}

/** 연료칸에 붙은 배기 추출 — "가솔린1.6"→1600, "LPG3.0"→3000. 이미 cc(≥100)면 그대로. */
export function fuelEmbeddedCc(raw: unknown): number {
  if (!fuelDisplay(raw)) return 0;
  const m = /(\d+(?:\.\d+)?)/.exec(String(raw ?? '').replace(/,/g, ''));
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 100 ? Math.round(n) : Math.round(n * 1000);
}
// 제조사 그룹 별칭 — 구데이터 오라벨(제네시스 G90/GV60이 '현대'로) + 표기흔들림(르노삼성=르노코리아=르노(삼성)) 흡수.
//   같은 그룹은 제조사 풀을 공유 → 모델 하드락이 G90을 제네시스에서 찾아 잠금(모델이 최종 판별하므로 안전).
const MAKER_GROUPS: string[][] = [
  ['현대', '기아', '제네시스', '제네사스'],                                  // 현대·기아·제네시스 상시혼동(카니발=기아·EV6=기아·G80=제네시스). 모델락이 갈라줌
  ['르노', '르노코리아', '르노삼성', '르노(삼성)', '삼성'],
  ['쉐보레', '쉐보래', 'gm', 'gm대우', '한국지엠', '지엠', '지엠대우', '대우'],   // 쉐보래=오타·GM대우
  ['벤츠', '메르세데스', '메르세데스벤츠', '메르세데스-벤츠'],
  ['kg모빌리티', '쌍용', '케이지모빌리티', 'kgm', '쌍용자동차'],
  ['도요타', '토요타'],                                                     // 토요타=표기변형
];
const _MG: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const g of MAKER_GROUPS) { const ng = g.map(norm); for (const k of ng) m.set(k, ng); }
  return m;
})();
// 제조사 → 같은 그룹의 정규화 별칭 목록(그룹 없으면 자기자신).
export const makerGroup = (m: string): string[] => {
  if (_MG.has(m)) return _MG.get(m)!;
  for (const [k, g] of _MG) if (m.includes(k) || k.includes(m)) return g; // 부분일치(르노(삼성)⊃르노)
  return [m];
};
// 트림의 모델연식 표기("25MY"·"25년") — 연식/최초등록 없을 때만. 트림의 배기량숫자 오독 방지 위해 MY/년 패턴만.
const trimYear = (t: unknown): number => { const m = /(\d{2})\s?my\b/i.exec(String(t ?? '')) || /(\d{2})년(?!식)/.exec(String(t ?? '')); return m ? 2000 + Number(m[1]) : 0; };
// 세대 추론 연식 = 연식(모델연도) 우선 → 최초등록일 → 트림MY 순 보조(연식 없을 때만).
//  최초등록일은 실제 등록 시점이라 모델연도보다 늦을 수 있어 우선하지 않음(사용자 지시: "참고용"). 실측(v3) 둘 다 있을 때 0건 불일치.
export const carYear = (p: EntityRecord): number => parseYear(p.year) || parseYear(p.first_registration_date) || trimYear(p.trim_name);

// ── 모델 정규화 ── 공급사 표기를 마스터 모델명으로. 실측 L2 96%→100%.
//  · 제조사 접두 제거("벤츠 E클래스"→E클래스, "아우디 A6"→A6) — 수입차 공급사 습관
//  · 세대 접두 제거("더뉴 카니발"→카니발, "디올뉴 스포티지"→스포티지)
//  · 클래스/약칭 별칭(E클래스→E-클래스, 팰리→팰리세이드)
//  · model=제조사만("테슬라") → sub_model 이 모델신호
const GEN_PREF = ['디올뉴', '올뉴', '더뉴', '신형'];
const IMPORT_MK = ['벤츠', '메르세데스', 'bmw', '아우디', '테슬라', '볼보', '미니', '폭스바겐', '지프', '포드', '렉서스'];
const MODEL_ALIAS: Record<string, string> = { e클래스: 'e-클래스', c클래스: 'c-클래스', s클래스: 's-클래스', a클래스: 'a-클래스', b클래스: 'b-클래스', g클래스: 'g-클래스', 팰리: '팰리세이드', 아반데: '아반떼', 그랜져: '그랜저', 소나타: '쏘나타', 펠리세이드: '팰리세이드' };
const stripMaker = (raw: string, mk: string): string => { let m = raw.trim(); for (const x of [mk, ...IMPORT_MK]) { const nx = x.trim(); if (nx && m.toLowerCase().startsWith(nx.toLowerCase()) && m.length > nx.length) m = m.slice(nx.length).trim(); } return m; };
export function normModel(model: unknown, maker: unknown, sub: unknown): string {
  const mk = String(maker ?? '');
  let nm = norm(stripMaker(String(model ?? ''), mk));
  for (const g of GEN_PREF) if (nm.startsWith(g) && nm.length > g.length) { nm = nm.slice(g.length); break; }
  nm = MODEL_ALIAS[nm] ?? nm;
  if (!nm || nm === norm(mk)) nm = norm(stripMaker(String(sub ?? ''), mk)); // 모델=제조사만 → sub로
  return nm;
}
// 세부모델에서 모델명만 추출(제조사·세대접두·세대코드 제거) — P3(모델↔세부 충돌 시 세부 우선) 락용.
function modelFromSub(sub: unknown, maker: unknown, codes: Set<string>): string {
  let s = stripMaker(String(sub ?? ''), String(maker ?? ''));
  for (const t of s.match(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?|[A-Za-z]{2,4}/g) || []) if (codes.has(t.toUpperCase())) s = s.replace(t, '');
  let nm = norm(s);
  for (const g of GEN_PREF) if (nm.startsWith(g) && nm.length > g.length) { nm = nm.slice(g.length); break; }
  return nm;
}
// ── 세대코드 추출 ── sub_model 에 박힌 마스터 세대코드(NQ5·W214·CN7·KA4)를 직접 잡아 세대 확정.
let _genCache: { entries: MasterEntry[]; codes: Set<string> } | null = null;
const genCodes = (entries: MasterEntry[]): Set<string> => {
  if (_genCache && _genCache.entries === entries) return _genCache.codes;
  const codes = new Set<string>();
  for (const e of entries) { const g = String(e.gen_code ?? '').trim().toUpperCase(); if (g.length >= 2) codes.add(g); }
  _genCache = { entries, codes };
  return codes;
};
const extractGen = (sub: unknown, codes: Set<string>): string | null => {
  const toks = String(sub ?? '').match(/[A-Za-z]{1,3}\d{1,3}[A-Za-z]?|[A-Za-z]{2,4}/g) || [];
  for (const t of toks) if (codes.has(t.toUpperCase())) return t.toUpperCase();
  return null;
};
// ── "N세대" 서수 매핑 ── 공급사가 "더 뉴 K5 3세대"처럼 서수로 적으면 세대코드(DL3)를 못 읽던 구멍.
//   모델별 세대코드를 연대순(year_start)으로 나열 → N세대 = N번째 세대코드.
let _ordCache: { entries: MasterEntry[]; order: Map<string, string[]> } | null = null;
const genOrder = (entries: MasterEntry[]): Map<string, string[]> => {
  if (_ordCache && _ordCache.entries === entries) return _ordCache.order;
  const firstYear = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const g = e.gen_code, ys = Number(e.year_start);
    if (!g || !Number.isFinite(ys)) continue;
    let mm = firstYear.get(e.model); if (!mm) { mm = new Map(); firstYear.set(e.model, mm); }
    const prev = mm.get(g); if (prev == null || ys < prev) mm.set(g, ys);
  }
  const order = new Map<string, string[]>();
  for (const [model, gm] of firstYear) order.set(model, [...gm.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g));
  _ordCache = { entries, order };
  return order;
};
const ordinalGen = (text: unknown): number => { const m = /([1-9])\s*세대/.exec(String(text ?? '')); return m ? Number(m[1]) : 0; };
const grams = (s: string) => { const g = new Set<string>(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const sim = (a: string, b: string): number => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.includes(na) || na.includes(nb)) return 0.75;
  const ga = grams(na), gb = grams(nb); if (!ga.size || !gb.size) return 0;
  let inter = 0; ga.forEach((x) => { if (gb.has(x)) inter++; });
  return inter / Math.max(ga.size, gb.size);
};

/** 한 칸에 뭉친 차명인가 — "아반떼 1.6 인스퍼레이션 20년식" · "팰리세이드 프레스티지" */
function looksCompoundVehicleText(s: unknown): boolean {
  const t = String(s ?? '').trim();
  if (!t) return false;
  if (/\d\.\d/.test(t)) return true;
  if (/\d{2,4}\s*년/.test(t)) return true;
  if (/\d{3,4}\s*cc/i.test(t)) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return true;
  // 2토큰이어도 뒤가 흔한 트림급이면 뭉친 표기(팰리세이드 프레스티지)
  if (parts.length === 2 && /프레스티지|인스퍼레이션|캘리그래피|익스클루시브|모던|스마트|프리미엄|노블레스|시그니처|르블랑|기본형|최고급형/.test(parts[1])) return true;
  return false;
}

/** 블롭에서 연식 — "20년식"·"2020년"·"2020"(배기 1.6과 안 겹침). */
function yearFromBlob(blob: string): number {
  const m =
    /(\d{2,4})\s*년\s*식/.exec(blob) ||
    /(20\d{2}|\d{2})\s*년(?!\s*식)/.exec(blob) ||
    /\b(20\d{2})\b/.exec(blob);
  return m ? parseYear(m[1]) : 0;
}

/** 블롭에서 배기 — "1.6"·"1.6L" → 1600. 연식 연도는 배기로 안 봄. */
function ccFromBlob(blob: string): number {
  const lit = /(?:^|[^\d])(\d\.\d)\s*(?:l|L|리터)?(?=$|[^\d])/.exec(blob);
  if (lit) {
    const n = Number(lit[1]);
    if (n >= 0.6 && n <= 8) return Math.round(n * 1000);
  }
  const cc = /(?:^|[^\d])([1-7]\d{3})\s*(?:cc|CC)?(?=$|[^\d.])/.exec(blob);
  if (cc) {
    const n = Number(cc[1]);
    if (n >= 600 && n <= 8000 && !(n >= 1990 && n <= 2099)) return n;
  }
  return 0;
}

/** 블롭에서 인승 — "7인승"·"8인". */
export function seatsFromBlob(blob: string): number {
  const m = /(\d{1,2})\s*인승?/.exec(blob);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 2 && n <= 15 ? n : 0;
}

/** 블롭에서 구동 — 4WD/AWD/사륜 · 2WD. */
export function driveFromBlob(blob: string): string {
  const s = blob.toLowerCase();
  if (/4\s*wd|awd|사륜|네바퀴|4륜/.test(s)) return '4WD';
  if (/2\s*wd|이륜|후륜|전륜/.test(s)) return '2WD';
  return '';
}

/** variant 목록에서 가장 많은 인승(동률이면 더 큰 인승). */
export function modeSeat(variants: MasterVariant[]): number | null {
  const counts = new Map<number, number>();
  for (const v of variants) {
    if (v.seat == null || !(v.seat > 0)) continue;
    counts.set(v.seat, (counts.get(v.seat) || 0) + 1);
  }
  let best: number | null = null, n = -1;
  for (const [seat, c] of counts) {
    if (c > n || (c === n && best != null && seat > best)) { n = c; best = seat; }
  }
  return best;
}

/** 모델 전체(전 세대 variant)에서 최빈 인승. */
export function modeSeatForModel(entries: MasterEntry[], model: string): number | null {
  if (!model) return null;
  return modeSeat(entries.filter((e) => e.model === model).flatMap((e) => e.variants || []));
}

/**
 * 공급사 거친 표기 → 매칭용 신호 분해(SSOT).
 *
 * 전제: 칸이 붙어 있을 수도·쪼개져 있을 수도 있다.
 *   → 수집 원자(VEHICLE_SIGNAL_KEYS + _raw_vehicle)를 한 블롭으로 이어 푼다.
 *   → 이미 쪼개진 칸은 유지하고, 빈 칸·뭉친 칸만 채운다.
 *
 * 예 A(한 줄): model="아반떼 1.6 인스퍼레이션 20년식 가솔린"
 * 예 B(칸별): model=아반떼 · trim=인스퍼레이션 · year=20년식 · fuel=가솔린 · engine_cc=1.6
 *   → 둘 다 maker=현대 · model=아반떼 · trim=인스퍼레이션 · year=2020 · fuel=가솔린 · cc=1600
 */
export function unpackVehicleSignals(p: EntityRecord, entries: MasterEntry[]): EntityRecord {
  if (!entries.length) return p;
  const out: EntityRecord = { ...p };
  const blob = vehicleSignalBlob(out);
  if (!blob.trim()) return out;
  const nblob = norm(blob);

  if (!carYear(out)) {
    const y = yearFromBlob(blob);
    if (y) out.year = String(y);
  } else {
    // "21년식" → 2021 정규화(이미 연식칸에 있을 때)
    const y = parseYear(out.year) || yearFromBlob(String(out.year));
    if (y) out.year = String(y);
  }

  // 배기: 리터(1.6)·cc(1600)·연료임베드·블롭 모두 → cc 정수
  {
    const rawCc = String(out.engine_cc ?? '').trim();
    const n = Number(rawCc.replace(/,/g, ''));
    let cc = 0;
    if (Number.isFinite(n) && n > 0) {
      if (n >= 0.6 && n <= 8) cc = Math.round(n * 1000); // 칸에 "1.6"만 있는 경우
      else if (n >= 600 && n <= 8000) cc = Math.round(n);
    }
    if (!cc) cc = fuelEmbeddedCc(out.fuel_type) || ccFromBlob(blob);
    if (cc) out.engine_cc = String(cc);
  }

  // 인승·구동 — 칸 비었으면 블롭·옵션·메모에서
  if (!(Number(out.seats) > 0)) {
    const s = seatsFromBlob(blob);
    if (s) out.seats = String(s);
  }
  if (!normDrive(out.drive_type)) {
    const d = driveFromBlob(blob);
    if (d) out.drive_type = d;
  } else {
    out.drive_type = normDrive(out.drive_type) || out.drive_type;
  }

  if (!fuelDisplay(out.fuel_type)) {
    for (const k of Object.keys(FUEL_ALIAS)) {
      if (nblob.includes(k)) {
        const d = fuelDisplay(FUEL_ALIAS[k]);
        if (d) { out.fuel_type = d; break; }
      }
    }
  }

  // catalog_id → 세대코드. 동코드 다수(RG3=ICE+EV, GN7=더뉴+기본)면 sub를 첫 hit로 채우지 않음.
  // 전원 동일 maker/model일 때만 빈 칸 보강 — 세부 고르는 건 snap 점수에 맡김.
  const cat = String(out.catalog_id || out.type_number || '').trim().toUpperCase();
  if (cat) {
    let cands = entries.filter((e) => String(e.gen_code || '').trim().toUpperCase() === cat);
    const mk = String(out.maker || '').trim();
    if (mk) {
      const mg = makerGroup(norm(mk));
      cands = cands.filter((e) => mg.some((g) => {
        const em = norm(e.maker);
        return em === g || em.includes(g) || g.includes(em);
      }));
    }
    const md = String(out.model || '').trim();
    if (md && !looksCompoundVehicleText(md)) {
      cands = cands.filter((e) => norm(e.model) === norm(md) || norm(md).includes(norm(e.model)));
    }
    if (cands.length === 1) {
      const hit = cands[0];
      if (!String(out.sub_model ?? '').trim()) out.sub_model = hit.sub_model;
      if (!String(out.model ?? '').trim()) out.model = hit.model;
      if (!mk) out.maker = hit.maker;
    } else if (cands.length > 1) {
      const models = new Set(cands.map((e) => e.model));
      const makers = new Set(cands.map((e) => e.maker));
      if (models.size === 1 && !String(out.model ?? '').trim()) out.model = cands[0].model;
      if (makers.size === 1 && !mk) out.maker = cands[0].maker;
      // sub_model 은 모호하면 비움 유지
    }
  }

  // 모델명 탐지 — 제조사 칸 제외( maker=제네시스 → 현대 모델 '제네시스' 오탐 → G80 소실 → 카니발 오염 ).
  const modelProbe = norm([
    out.model, out.sub_model, out.cert_car_name, out.vehicle_name,
    out.trim_name, out.variant, out.options, out.partner_memo, out.engine_type,
  ].map((x) => String(x ?? '').trim()).filter(Boolean).join(' '));
  const models = [...new Set(entries.map((e) => e.model))].sort((a, b) => b.length - a.length);
  let hitModel = '';
  if (modelProbe) {
    for (const m of models) {
      const nm = norm(m);
      if (nm.length >= 2 && modelProbe.includes(nm)) { hitModel = m; break; }
    }
    if (!hitModel) {
      for (const [alias, canon] of Object.entries(MODEL_ALIAS)) {
        if (!modelProbe.includes(alias)) continue;
        const real = models.find((x) => norm(x) === norm(canon)) || models.find((x) => norm(x) === alias);
        if (real) { hitModel = real; break; }
      }
    }
  }

  // 트림 후보 사전(모델 힌트 있으면 그 모델 우선, 없으면 전체) — 모델 정제 전에 뽑아 "팰리세이드 프레스티지" 분해
  const trimHintModel = hitModel;
  const trimEmpty = !String(out.trim_name ?? '').trim();
  const modelWasBlob = looksCompoundVehicleText(p.model) || looksCompoundVehicleText(p.sub_model) || looksCompoundVehicleText(p.cert_car_name) || looksCompoundVehicleText(p.vehicle_name);
  if (trimEmpty || modelWasBlob) {
    const trimSet = new Set<string>();
    for (const e of entries) {
      if (trimHintModel && e.model !== trimHintModel) continue;
      for (const t of realMasterTrims(e.trims)) trimSet.add(t);
      for (const v of e.variants || []) for (const t of realMasterTrims(v.trims)) trimSet.add(t);
    }
    if (!trimHintModel) {
      for (const e of entries) {
        for (const t of realMasterTrims(e.trims)) trimSet.add(t);
        for (const v of e.variants || []) for (const t of realMasterTrims(v.trims)) trimSet.add(t);
      }
    }
    for (const t of [...trimSet].sort((a, b) => b.length - a.length)) {
      if (norm(t).length < 2) continue;
      if (nblob.includes(norm(t))) { out.trim_name = t; break; }
    }
  }
  // 이미 들어있는 trim이 플레이스홀더·장문 마케팅이면 비움(신호는 블롭에 남음)
  if (isNoTrimLabel(out.trim_name) || String(out.trim_name || '').trim().length > 40) {
    out.trim_name = '';
  } else if (String(out.trim_name || '').trim()) {
    // Premium → 프리미엄 (모델 힌트 풀이 있으면 그 안에서만)
    const pool: string[] = [];
    const hint = String(out.model || hitModel || '').trim();
    for (const e of entries) {
      if (hint && e.model !== hint) continue;
      for (const t of realMasterTrims(e.trims)) pool.push(t);
      for (const v of e.variants || []) for (const t of realMasterTrims(v.trims)) pool.push(t);
    }
    const canon = canonMasterTrim(out.trim_name, pool.length ? pool : null);
    if (canon) out.trim_name = canon;
  }

  if (hitModel) {
    const modelRaw = String(out.model ?? '').trim();
    const peeled = !!(out.trim_name && norm(modelRaw).includes(norm(String(out.trim_name))) && norm(modelRaw).includes(norm(hitModel)) && norm(modelRaw) !== norm(hitModel));
    if (!modelRaw || looksCompoundVehicleText(modelRaw) || peeled) out.model = hitModel;
    if (!String(out.maker ?? '').trim()) {
      const mk = entries.find((e) => e.model === hitModel)?.maker;
      if (mk) out.maker = mk;
    }
  }

  return out;
}

export function snapToMaster(p: EntityRecord, entries: MasterEntry[]): SnapResult | null {
  // 원본 수집 신호 우선 → 한줄·섞인 표기 분해 → 이후는 구조화 필드 매칭
  p = unpackVehicleSignals(withRawVehicleSignals(p), entries);
  const maker = norm(p.maker), model = norm(p.model), sub = norm(p.sub_model), year = carYear(p);
  if (!maker && !model && !sub) return null;
  if (!model && !sub) return null; // P4(사용자 정책): 제조사만 있고 모델·세부 공란 = 매칭 안 함(미분류로 사람이 채움)
  const signalBlob = vehicleSignalBlob(p);
  const wantTurbo = turboHint(p, signalBlob);
  const pCatalog = String(p.catalog_id || '').trim().toUpperCase();

  // ── 1단계: 제조사 잠금 ── (아반떼→현대). 그룹 별칭으로 제네시스↔현대·르노 표기흔들림 흡수. 불명이면 전체.
  const mg = maker ? makerGroup(maker) : [];
  const sameMaker = (em: string) => mg.some((g) => em === g || em.includes(g) || g.includes(em));
  let pool = maker ? entries.filter((e) => sameMaker(norm(e.maker))) : entries;
  if (!pool.length) pool = entries;
  if (!pool.length) return null;

  // ── 2단계: 모델 하드 잠금 ── 풀 안 distinct 모델 중 매물 model/sub_model 과 최적 1개로 고정.
  //   "아반떼면 아반떼 안에서만" — 이후 세대·variant·트림은 이 모델 밖으로 못 나감(교차오염 차단).
  const codes = genCodes(entries);
  const pmodel = normModel(p.model, p.maker, p.sub_model);      // 제조사·세대 접두 벗긴 모델신호(모델칸)
  const subModel = modelFromSub(p.sub_model, p.maker, codes);   // 세부에서 뽑은 모델명(P3: 모델↔세부 충돌 시 우선)
  let lockedModel: string | null = null, modelSim = 0;
  for (const em of new Set(pool.map((e) => e.model))) {
    const nem = norm(em);
    // P3(사용자 정책): 세부모델 우선(full) > 모델칸(0.9) > 전체sub유사(0.85). 베뉴(모델)vs카니발(세부)→카니발
    let s = Math.max(sim(subModel, em), sim(pmodel, em) * 0.9, sub ? sim(String(p.sub_model), em) * 0.85 : 0);
    if (nem && sub.includes(nem)) s += 0.02 * nem.length;   // 구체성 우선 — sub에 전체 모델명 포함 시 더 긴 모델(A6 e-트론 > A6)
    if (s > modelSim) { modelSim = s; lockedModel = em; }
  }
  const locked = (lockedModel && modelSim > 0.4) ? pool.filter((e) => e.model === lockedModel) : pool;

  // ── 3단계: 세대 좁히기 ── 잠긴 모델 안에서 세부명·트림·세대코드·연식·파워트레인·등록증 종합.
  const pgen = extractGen(p.sub_model, codes) || extractGen(p.catalog_id, codes) || extractGen(p.type_number, codes);
  const ord = ordinalGen(p.sub_model) || ordinalGen(p.trim_name) || ordinalGen(p.cert_car_name);
  const orderList = lockedModel ? (genOrder(entries).get(lockedModel) || []) : [];
  const targetGen = (ord >= 1 && ord <= orderList.length) ? orderList[ord - 1] : null; // N세대 → 연대순 N번째
  const pfuel = normFuel(p.fuel_type);
  const productIsEv = pfuel === '전기' || pfuel === '수소';
  // EV 힌트 — 수집 전 필드에 전기/일렉트릭 흔적(연료 미상이라도 EV면 배제 안 함).
  const evHint = /전기|일렉트릭|일렉트리파이드|electrified|\bev\b/i.test(signalBlob.toLowerCase());
  const BODY_RE = /쿠페|카브리올레|컨버터블|coupe|cabriolet|convertible/i;
  const pCoupe = BODY_RE.test(signalBlob);
  const scored = locked.map((e) => {
    let s = 0;
    if (sub) s += sim(String(p.sub_model), e.sub_model) * 2.2 + sim(String(p.sub_model), e.title || '') * 0.5;
    if (p.trim_name) s += sim(String(p.trim_name), e.sub_model) * 1.0;              // 트림의 세대신호(뉴라이즈→페이스리프트)
    if (p.cert_car_name) s += sim(String(p.cert_car_name), e.sub_model) * 0.8 + sim(String(p.cert_car_name), e.title || '') * 0.4;
    if (p.vehicle_name) s += sim(String(p.vehicle_name), e.sub_model) * 0.6;
    const genLock = (pgen && String(e.gen_code).toUpperCase() === pgen)
      || (targetGen && e.gen_code === targetGen)
      || (!!pCatalog && String(e.gen_code).toUpperCase() === pCatalog);
    if (genLock) s += 5;                                                            // 세대코드 명시(NQ5) 또는 "N세대" 서수 = 지배적
    const ys = Number(e.year_start) || 0, ye = /\d{4}/.test(String(e.year_end)) ? Number(e.year_end) : 9999;
    // P2(사용자 정책): 세대가 확정(genLock)되면 연식 무시(연식칸 오기 잦음). 아니면 연식으로 세대 좁힘.
    if (year && ys && !genLock) {
      if (year >= ys && year <= ye) s += 3;                                    // 연식이 세대 범위 안 = 강가점
      else if (year >= ys - 1 && year <= ye + 1) s += 1.2;                     // 경계 ±1
      else s -= Math.min(3, (year < ys ? ys - year : year - ye) * 0.6);        // 벗어난 세대 배제
    } else if (year && ys && genLock && year >= ys && year <= ye) s += 1;      // 세대확정+연식도 맞으면 소폭 보강
    if (pfuel && e.variants?.length) {                                             // 파워트레인으로 세대 제약(하이브리드=KA4 전용 등)
      const fuels = new Set(e.variants.map((v) => normFuel(v.fuel)));
      if (fuels.has(pfuel)) s += 0.8;
      else if (pfuel === '하이브리드' || pfuel === '전기') s -= 2;                  // 해당 연료 없는 세대 강배제
    }
    // EV 무음 오스냅 방지(v3 이식) — 제품이 EV 아님(연료 미상 포함)+EV힌트 없음인데 세대가 EV전용이면 강배제(가솔린 G80→일렉트리파이드 방지).
    if (!productIsEv && !evHint && e.variants?.length && e.variants.every((v) => { const f = normFuel(v.fuel); return f === '전기' || f === '수소'; })) s -= 6;
    // 쿠페/카브리올레 불일치 패널티(v3 이식) — 한쪽만 쿠페류 = 다른 차(GV80→GV80쿠페 오매칭 차단).
    if (pCoupe !== BODY_RE.test(`${e.sub_model || ''} ${e.title || ''}`)) s -= 6;
    return { e, s };
  }).sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    // 동점: 연식 시작이 빠른 쪽(기본형) 우선 — catalog만 있을 때 더뉴/EV가 JSON 앞이라 이기던 단순오류 방지
    return (Number(a.e.year_start) || 0) - (Number(b.e.year_start) || 0);
  });

  const best = scored[0];
  if (!best) return null;
  const e = best.e;

  const fuel = normFuel(p.fuel_type), disp = (Number(p.engine_cc) || 0) / 1000;
  const wantSeats = Number(p.seats) > 0 ? Number(p.seats) : 0;
  const wantDrive = normDrive(p.drive_type);
  const seatMatters = variantSeatsDiffer(e.variants); // 카니발·팰리 등 인승이 갈리는 세대만
  const modelModeSeat = seatMatters
    ? (lockedModel ? modeSeatForModel(entries, lockedModel) : modeSeat(e.variants || []))
    : null;
  let variant: MasterVariant | undefined;
  if (e.variants?.length) {
    variant = e.variants.map((v) => {
      let vs = 0;
      const vf = normFuel(v.fuel);
      if (fuel && vf === fuel) vs += 2;
      else if (fuel && vf && (vf.includes(fuel) || fuel.includes(vf))) vs += 1;
      else if (fuel && vf) vs -= 3; // 연료 명확히 다름 = 강페널티
      if (disp && v.displacement_l) vs += Math.max(0, 1 - Math.abs(v.displacement_l - disp) * 1.2);
      // 구동: 명시되면 가점/감점. 없으면 2WD 쪽 variant 선호(힌트만 — 저장은 마스터 노드).
      if (wantDrive && v.drivetrain) {
        const vd = normDrive(v.drivetrain);
        if (vd === wantDrive) vs += 1.5;
        else vs -= 1;
      } else if (!wantDrive && v.drivetrain) {
        const vd = normDrive(v.drivetrain);
        if (vd === '2WD') vs += 0.5;
        else if (vd === '4WD') vs -= 0.25;
      }
      // 인승: 세대 내 인승이 갈릴 때만 매칭·힌트 (단일 5인승 차는 인승 없음)
      if (seatMatters && wantSeats && v.seat) {
        if (v.seat === wantSeats) vs += 1.5;
        else vs -= 0.6;
      } else if (seatMatters && !wantSeats && modelModeSeat != null && v.seat === modelModeSeat) {
        vs += 0.45;
      }
      // 터보 — 옵션·원동기·표기에 T/터보 있으면 turbo 노드 선호
      if (wantTurbo) vs += v.turbo ? 1.2 : -0.8;
      else if (v.turbo) vs -= 0.15;
      // 마스터 라벨이 수집 블롭에 그대로 있으면 강가점
      const vl = masterVariantLabel(v);
      if (vl && norm(signalBlob).includes(norm(vl))) vs += 1.5;
      return { v, vs };
    }).sort((a, b) => b.vs - a.vs)[0]?.v;
  }

  let trim = '';
  const trimSrc = realMasterTrims(variant?.trims?.length ? variant.trims : (e.trims || []));
  // 트림: 마스터 실트림과 높은 일치만. 세부등급 없는 차·미매칭 = 공란.
  // 공급사 마케팅 한줄("The All new G80 2.5 터보…")을 트림으로 남기지 않음.
  if (trimSrc.length) {
    const signal = String(p.trim_name ?? '').trim();
    if (signal && !isNoTrimLabel(signal)) {
      const canon = canonMasterTrim(signal, trimSrc);
      if (canon && trimSrc.includes(canon)) trim = canon;
      else {
        const hit = trimSrc.map((x) => ({ x, ts: sim(signal, x) })).sort((a, b) => b.ts - a.ts)[0];
        if (hit && (hit.ts >= 0.85 || norm(signal) === norm(hit.x))) trim = hit.x;
      }
    }
    if (!trim) {
      for (const t of [...trimSrc].sort((a, b) => b.length - a.length)) {
        if (norm(t).length < 2) continue;
        // 한글 마스터 트림 또는 영문 별칭이 블롭에 있을 때
        const tKey = t.toLowerCase().replace(/\s+/g, ' ').trim();
        const tAsKo = TRIM_EN_KO[tKey] || TRIM_EN_KO[tKey.replace(/-/g, ' ')] || t;
        const enKeys = Object.entries(TRIM_EN_KO)
          .filter(([, ko]) => ko === t || ko === tAsKo || norm(ko) === norm(t))
          .map(([en]) => en);
        const nblob = norm(signalBlob);
        if (nblob.includes(norm(t)) && norm(t).length >= 3) { trim = t; break; }
        if (nblob.includes(norm(tAsKo)) && norm(tAsKo).length >= 3) { trim = t; break; }
        if (enKeys.some((en) => nblob.includes(norm(en)) || signalBlob.toLowerCase().includes(en))) {
          trim = t;
          break;
        }
      }
    }
  }

  // P1(사용자 정책): 세부모델 우선하되, 트림이 잠긴 모델과 "다른 모델"을 강하게 가리키면 저신뢰(사람 검토).
  //   예: 세부=K5인데 트림="K7 프리미어..." → K5로 두되 검토표시.
  //   짧은 모델명(레이·K3)이 트림 글자에 끼는 오탐 금지 — "인스퍼레이션"⊃"레이" → false.
  let trimConflict = false;
  if (p.trim_name && lockedModel) {
    const nt = norm(String(p.trim_name));
    for (const om of new Set(pool.map((x) => x.model))) {
      const no = norm(om);
      if (!no || no === norm(lockedModel)) continue;
      if (no.length < 3) continue;
      // 트림이 다른 모델명으로 시작·동일·또는 긴 모델명 고유사도만
      if (nt === no || nt.startsWith(no) || (no.length >= 4 && sim(String(p.trim_name), om) >= 0.85)) {
        trimConflict = true;
        break;
      }
    }
  }
  // 확신도 = 모델락 강도 × 세대 확정도. 모델 못 잠갔거나 트림충돌이면 저신뢰.
  //   연식+연료만으로 세대가 갈리면(sub 공란 한줄분해) best.s≥3·modelSim≥0.7 → high.
  const ms = Math.min(modelSim, 1);
  const confidence: SnapResult['confidence'] = trimConflict ? 'low' : (ms >= 0.7 && best.s >= 3) ? 'high' : (ms >= 0.45 && best.s >= 0.5) ? 'medium' : 'low';
  // 결과 스펙 = 마스터 노드만. 신호·최빈값으로 임의 채우기 금지(미선택=공란).
  return {
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code,
    year_start: e.year_start, year_end: e.year_end,
    variant: variant ? masterVariantLabel(variant) : undefined,
    trim_name: trim, // '' = 세부트림 없음(정상). undefined 아님 — applySnap이 원본 마케팅 문구를 유지하지 않게.
    fuel_type: variant?.fuel || undefined,
    engine_cc: variant?.displacement_l != null && variant.displacement_l > 0
      ? String(Math.round(variant.displacement_l * 1000))
      : undefined,
    seats: seatMatters && variant?.seat != null ? String(variant.seat) : undefined,
    drive_type: variant?.drivetrain || undefined,
    year: year ? String(year) : (p.year ? String(p.year) : undefined),
    confidence,
  };
}

/** 차종 변환 추적 필드 — 원본(_raw_vehicle)·이력·감사 diff 공용. */
export const SNAP_TRACK_KEYS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year', 'fuel_type', 'engine_cc', 'seats', 'drive_type', 'vehicle_class',
] as const;
export type SnapTrackKey = (typeof SNAP_TRACK_KEYS)[number];
export const SNAP_TRACK_LABEL: Record<SnapTrackKey, string> = {
  maker: '제조사', model: '모델', sub_model: '세부모델', variant: '파워트레인', trim_name: '트림',
  year: '연식', fuel_type: '연료', engine_cc: '배기량', seats: '인승', drive_type: '구동', vehicle_class: '차급',
};
export type RawVehicle = Partial<Record<SnapTrackKey, string>>;
export type SnapHistoryEntry = {
  at: number;
  confidence: string;
  source?: string;
  from: RawVehicle;
  to: RawVehicle;
};

export function pickSnapTrack(rec: EntityRecord | RawVehicle): RawVehicle {
  const o: RawVehicle = {};
  for (const k of SNAP_TRACK_KEYS) {
    const v = String((rec as EntityRecord)[k] ?? '').trim();
    if (v) o[k] = v;
  }
  return o;
}

/** 최초 공급/입력 원본 — 이미 있으면 유지, 없으면 현재값 스냅샷. */
export function captureRawVehicle(rec: EntityRecord): RawVehicle {
  if (rec._raw_vehicle && typeof rec._raw_vehicle === 'object') return rec._raw_vehicle as RawVehicle;
  return pickSnapTrack(rec);
}

export function vehicleIdentityLine(p: EntityRecord | RawVehicle | null | undefined): string {
  if (!p) return '—';
  const parts = [p.maker, p.model, p.sub_model, p.variant]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const trim = String(p.trim_name || '').trim();
  if (trim && !isNoTrimLabel(trim)) parts.push(trim);
  return parts.join(' ') || '—';
}

/** 원본 vs 현재 — 바뀐 칸만. 재고·감사 표시용. */
export function snapFieldDiffs(raw: RawVehicle | null | undefined, cur: EntityRecord): {
  key: SnapTrackKey; label: string; from: string; to: string;
}[] {
  if (!raw) return [];
  const out: { key: SnapTrackKey; label: string; from: string; to: string }[] = [];
  for (const k of SNAP_TRACK_KEYS) {
    const from = String(raw[k] ?? '').trim();
    const to = String(cur[k] ?? '').trim();
    if (from === to) continue;
    if (!from && !to) continue;
    out.push({ key: k, label: SNAP_TRACK_LABEL[k], from: from || '—', to: to || '—' });
  }
  return out;
}

function appendSnapHistory(rec: EntityRecord, from: RawVehicle, to: RawVehicle, confidence: string, source?: string): SnapHistoryEntry[] {
  const changedFrom: RawVehicle = {};
  const changedTo: RawVehicle = {};
  for (const k of SNAP_TRACK_KEYS) {
    const a = String(from[k] ?? '').trim();
    const b = String(to[k] ?? '').trim();
    if (a === b) continue;
    if (a) changedFrom[k] = a;
    if (b) changedTo[k] = b;
  }
  const prev = Array.isArray(rec._snap_history) ? (rec._snap_history as SnapHistoryEntry[]) : [];
  if (!Object.keys(changedFrom).length && !Object.keys(changedTo).length) return prev.slice(-10);
  const entry: SnapHistoryEntry = { at: Date.now(), confidence, source, from: changedFrom, to: changedTo };
  return [...prev, entry].slice(-10);
}

/**
 * applySnap — 스냅 결과를 매물 레코드에 계단식으로 반영(SSOT). 페이지·일괄 재구현 공용.
 *   · 신원(제조사·모델·세부·세대·variant) = 트리 노드로 덮어쓰기(원본은 evidence였을 뿐).
 *   · 스펙(연료·배기·인승·구동) = 노드 값 우선, 노드에 없을 때만 원본 유지.
 *   · 트림 = 마스터 실트림만. 미매칭·세부등급 없음 = 공란(공급사 마케팅 문구 유지 금지 → _raw_vehicle).
 *   · _raw_vehicle = 최초 원본 영구 보존. _snap_history = 변환 이력(최근 10).
 */
export function applySnap(rec: EntityRecord, res: SnapResult, opts?: { source?: string }): EntityRecord {
  const keep = (nodeVal: string | undefined, raw: unknown) => (nodeVal != null && nodeVal !== '' ? nodeVal : String(raw ?? '') || '');
  const beforeTrack = pickSnapTrack(rec);
  const rawVehicle = captureRawVehicle(rec);
  const trimOut = res.trim_name != null && !isNoTrimLabel(res.trim_name) ? String(res.trim_name).trim() : '';
  const prevTrim = String(rec.trim_name ?? '').trim();
  // 마스터 트림으로 못 올린 긴 공급 표기 → 추가표기(trim_extra)로 보존(이미 있으면 유지)
  const prevExtra = String(rec.trim_extra ?? '').trim();
  const migratedExtra = prevExtra
    || (!trimOut && prevTrim && !isNoTrimLabel(prevTrim) && prevTrim.length >= 12 ? prevTrim : '');
  const next: EntityRecord = {
    ...rec,
    _raw_vehicle: rawVehicle,
    _snapped: true,
    _snap_confidence: res.confidence,
    maker: res.maker, model: res.model, sub_model: res.sub_model, catalog_id: res.gen_code,
    gen_year_start: res.year_start ?? rec.gen_year_start, gen_year_end: res.year_end ?? rec.gen_year_end,
    variant: res.variant || '',
    trim_name: trimOut,
    trim_extra: migratedExtra,
    fuel_type: keep(res.fuel_type, rec.fuel_type),
    engine_cc: keep(res.engine_cc, rec.engine_cc),
    seats: keep(res.seats, rec.seats),
    drive_type: keep(res.drive_type, rec.drive_type),
    year: keep(res.year, rec.year),
  };
  next.vehicle_class = classifyVehicleClass(next) || String(rec.vehicle_class ?? '');
  const afterTrack = pickSnapTrack(next);
  next._snap_history = appendSnapHistory(rec, beforeTrack, afterTrack, res.confidence, opts?.source);
  next._snap_at = Date.now();
  next._needs_master_review = !(res.confidence === 'high' || res.confidence === 'medium');
  return next;
}

/**
 * reconcileToMaster — 매물 배열 전체를 차종마스터에 재스냅(일괄 재구현). 원자→트리경로.
 *   mode='auto'(기본 권장): high·medium만 패치. low·미매칭은 카운트만(검수).
 *   mode='all': 저신뢰도 포함 전부 패치(구동작).
 */
export function reconcileToMaster(products: EntityRecord[], entries: MasterEntry[], opts?: { mode?: 'auto' | 'all' }): {
  patches: { key: string; patch: EntityRecord; confidence: SnapResult['confidence'] }[];
  matched: number; high: number; medium: number; low: number; unmatched: number;
} {
  const auto = (opts?.mode ?? 'auto') === 'auto';
  const patches: { key: string; patch: EntityRecord; confidence: SnapResult['confidence'] }[] = [];
  let high = 0, medium = 0, low = 0, unmatched = 0;
  for (const p of products) {
    const key = String(p._key ?? p.product_code ?? '');
    if (!key) continue;
    const res = snapToMaster(p, entries);
    if (!res) { unmatched++; continue; }
    if (res.confidence === 'high') high++;
    else if (res.confidence === 'medium') medium++;
    else { low++; if (auto) continue; }
    const applied = applySnap(p, res, { source: 'reconcile' });
    const patch: EntityRecord = {
      maker: applied.maker, model: applied.model, sub_model: applied.sub_model, catalog_id: applied.catalog_id,
      gen_year_start: applied.gen_year_start, gen_year_end: applied.gen_year_end,
      variant: applied.variant, trim_name: applied.trim_name,
      fuel_type: applied.fuel_type, engine_cc: applied.engine_cc, seats: applied.seats, drive_type: applied.drive_type,
      year: applied.year,
      vehicle_class: applied.vehicle_class, _snap_confidence: res.confidence,
      _raw_vehicle: applied._raw_vehicle, _snapped: true,
      _snap_at: applied._snap_at, _snap_history: applied._snap_history,
    };
    patches.push({ key, patch, confidence: res.confidence });
  }
  return { patches, matched: patches.length, high, medium, low, unmatched };
}

/** 규격 적합 = 마스터에 동일 제조사·모델·세부모델 경로가 실재. */
export function isMasterPath(p: EntityRecord, pathSet: Set<string>): boolean {
  const k = `${norm(p.maker)}|${norm(p.model)}|${norm(p.sub_model)}`;
  return !!(norm(p.maker) && norm(p.model) && norm(p.sub_model) && pathSet.has(k));
}
export function masterPathSet(entries: MasterEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) s.add(`${norm(e.maker)}|${norm(e.model)}|${norm(e.sub_model)}`);
  return s;
}

export type MasterFitBucket = 'ok' | 'high' | 'medium' | 'low' | 'none' | 'no_signal';
export type MasterFitRow = {
  key: string; car: string; bucket: MasterFitBucket;
  before: string; after?: string; year?: string; confidence?: SnapResult['confidence'];
};
/**
 * 전수 검수(쓰기 없음) — 수천대 변환 전 규모 파악.
 *  · ok = 이미 마스터 실경로(제조사·모델·세부)
 *  · high/medium/low = 변환 시 스냅 확신도(ok가 아닌 것만)
 *  · none = 신호는 있는데 후보 없음
 *  · no_signal = 모델·세부 둘 다 없어 스냅 자체 스킵
 */
export function auditMasterFit(products: EntityRecord[], entries: MasterEntry[]): {
  total: number;
  ok: number;
  high: number; medium: number; low: number; none: number; no_signal: number;
  offSpec: number;
  autoConvert: number;
  needReview: number;
  samples: { low: MasterFitRow[]; none: MasterFitRow[]; no_signal: MasterFitRow[] };
} {
  const paths = masterPathSet(entries);
  let ok = 0, high = 0, medium = 0, low = 0, none = 0, no_signal = 0;
  const samples = { low: [] as MasterFitRow[], none: [] as MasterFitRow[], no_signal: [] as MasterFitRow[] };
  const pushSample = (bucket: 'low' | 'none' | 'no_signal', row: MasterFitRow) => {
    if (samples[bucket].length < 12) samples[bucket].push(row);
  };

  for (const p of products) {
    const key = String(p._key ?? p.product_code ?? '');
    const car = String(p.car_number || '').trim() || '(차번없음)';
    const before = [p.maker, p.model, p.sub_model].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || '(차종공란)';
    const year = yearDisplay(p.year) || undefined;

    if (isMasterPath(p, paths)) { ok++; continue; }

    const maker = norm(p.maker), model = norm(p.model), sub = norm(p.sub_model);
    if (!maker && !model && !sub) {
      no_signal++;
      pushSample('no_signal', { key, car, bucket: 'no_signal', before, year });
      continue;
    }
    if (!model && !sub) {
      no_signal++;
      pushSample('no_signal', { key, car, bucket: 'no_signal', before, year });
      continue;
    }

    const res = snapToMaster(p, entries);
    if (!res) {
      none++;
      pushSample('none', { key, car, bucket: 'none', before, year });
      continue;
    }
    const after = [res.maker, res.model, res.sub_model].join(' ');
    if (res.confidence === 'high') high++;
    else if (res.confidence === 'medium') medium++;
    else {
      low++;
      pushSample('low', { key, car, bucket: 'low', before, after, year, confidence: res.confidence });
    }
  }

  const total = products.length;
  const offSpec = total - ok;
  return {
    total, ok, high, medium, low, none, no_signal, offSpec,
    autoConvert: high + medium,
    needReview: low + none + no_signal,
    samples,
  };
}
