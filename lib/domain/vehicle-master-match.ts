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
 *   · 입력이 빈 축은 마스터 variant.default 조합 — 없으면 구동 2WD·인승 modeSeat — 을 고르고 자동선택 표시.
 *   · 인승 = 세대 안에서 seat가 갈릴 때만(예: 카니발·팰리세이드). 단일·무축 승용은 인승 없음.
 *   · 트림 신호 없음 → 고른 파워트레인의 첫(기본) 트림 + 자동선택 표시.
 *   · 명시 원자가 마스터 조합에 없음 → 억지 기본값 적용 없이 low 검수 + 충돌 근거 보존.
 *   · 모델·제조사 신호 전무 → 매칭 자체 null(저장 시 검수).
 *   · 표기 오류(가솔린 2 vs 2.0) = 마스터 JSON 라벨을 고친다. 런타임 폴리시 금지.
 *
 * 반환은 후보(confidence). high·중만 자동확정 경로, low·미매칭은 검수.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { classifyVehicleClass } from '@/lib/domain/vehicle-class';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import {
  normFuel,
  parseYear,
} from '@/lib/domain/vehicle-master-format';
import {
  appendSnapHistory,
  captureRawVehicle,
  pickSnapTrack,
  SNAP_TRACK_KEYS,
  SNAP_TRACK_LABEL,
  snapFieldDiffs,
  type RawVehicle,
  type SnapHistoryEntry,
  type SnapTrackKey,
} from '@/lib/domain/vehicle-master-snapshot';
import {
  EMPTY_VEHICLE_FILTER,
  masterMakerGroups,
  masterModels,
  masterSubs,
  matchVehicleFilter,
  vehicleFilterCount,
} from '@/lib/domain/vehicle-master-filter';
import {
  collectVehicleSignals,
  VEHICLE_SIGNAL_KEYS,
  vehicleModelSignalBlob,
  vehicleSignalBlob,
  withRawVehicleSignals,
} from '@/lib/domain/vehicle-master-signals';
import { resolveTrim } from '@/lib/domain/vehicle-trim-resolve';
import { isForbiddenAsTrim, sanitizeAxisValue } from '@/lib/domain/vehicle-field-guards';
import {
  isNoTrimLabel,
  masterVariantLabel,
  masterVariantOptionLabel,
  realMasterTrims,
} from '@/lib/domain/vehicle-master-options';
import { snapDefaultHints } from '@/lib/domain/vehicle-defaults';
import { resolveExactMasterPathEngine } from '@/lib/domain/vehicle-master-exact';
import { unpackVehicleSignalsEngine } from '@/lib/domain/vehicle-master-normalize';
import { selectMasterEntry } from '@/lib/domain/vehicle-master-score';
import { selectMasterVariant } from '@/lib/domain/vehicle-master-variant';
import {
  auditMasterFitEngine,
  isMasterPath,
  masterPathSet,
  reconcileToMasterEngine,
} from '@/lib/domain/vehicle-master-operations';
import type {
  ExactMasterPath,
  MasterEntry,
  MasterFitRow,
  MasterVariant,
  SnapDefaultAtoms,
  SnapIssue,
  SnapResult,
  VehicleFilter,
} from '@/lib/domain/vehicle-master-types';

export type {
  ExactMasterPath,
  MasterEntry,
  MasterFitBucket,
  MasterFitRow,
  MasterVariant,
  SnapResult,
  VehicleFilter,
} from '@/lib/domain/vehicle-master-types';
export {
  fuelDisplay,
  fuelEmbeddedCc,
  makerDisplay,
  normFuel,
  parseYear,
  yearDisplay,
} from '@/lib/domain/vehicle-master-format';
export {
  captureRawVehicle,
  pickSnapTrack,
  SNAP_TRACK_KEYS,
  SNAP_TRACK_LABEL,
  snapFieldDiffs,
  type RawVehicle,
  type SnapHistoryEntry,
  type SnapTrackKey,
} from '@/lib/domain/vehicle-master-snapshot';
export {
  EMPTY_VEHICLE_FILTER,
  masterMakerGroups,
  masterModels,
  masterSubs,
  matchVehicleFilter,
  normalizeVehicleFilter,
  productsForVehicleStep,
  vehicleFilterCount,
} from '@/lib/domain/vehicle-master-filter';
export {
  collectVehicleSignals,
  VEHICLE_SIGNAL_KEYS,
  vehicleSignalBlob,
  withRawVehicleSignals,
  type VehicleSignalKey,
} from '@/lib/domain/vehicle-master-signals';
export {
  isNoTrimLabel,
  masterVariantLabel,
  masterVariantOptionLabel,
  realMasterTrims,
  variantSeatsDiffer,
} from '@/lib/domain/vehicle-master-options';
export {
  modeSeat,
  modeSeatForModel,
} from '@/lib/domain/vehicle-master-variant';

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
  /** 공급사 오탈자 — 니로 등 시트에 「트랜디」로 자주 온다. */
  트랜디: '트렌디',
  longrange: '롱 레인지',
  'long range': '롱 레인지',
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
  // 한글 오탈자(트랜디)도 영문 키와 같이 본다.
  const mapped = TRIM_EN_KO[key] || TRIM_EN_KO[key.replace(/-/g, ' ')]
    || TRIM_EN_KO[norm(src)] || src;
  const list = pool && pool.length ? realMasterTrims(pool) : null;
  if (!list) return mapped === src ? src : mapped;
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

/**
 * 제조사·모델·세부모델(또는 catalog_id)·파워트레인 라벨·트림이
 * 마스터 JSON에 있는 그대로일 때만 경로 반환. 비슷함·추정 금지.
 * 세부트림 없는 차(마스터 trims = 세부등급 없음)는 trim='' 이 정상 규격.
 */
export function resolveExactMasterPath(
  entries: MasterEntry[],
  p: Partial<Pick<EntityRecord, 'maker' | 'model' | 'sub_model' | 'catalog_id' | 'variant' | 'trim_name'>> | EntityRecord,
): ExactMasterPath | null {
  return resolveExactMasterPathEngine(entries, p, {
    variantLabel: masterVariantLabel,
    realTrims: realMasterTrims,
    canonicalTrim: canonMasterTrim,
  });
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

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
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
/**
 * ★연식 칸에 **배기량**이 들어온 경우는 믿지 않는다.
 *
 * 실측 2026-08-09(시트 재동기화 후): 「쏘나타」가 `year="2000"` · `engine_cc="2000"` ·
 * `first_registration_date="21-06-24"` 로 들어왔다. 2000cc 가 연식 칸에 복사된 것이다.
 * 값 자체는 «있고» 범위(1980~현재)에도 들어서 일반 검사로는 안 걸린다 —
 * **두 칸이 같다**는 것만이 신호다.
 *
 * 연식은 세대의 1차 관문이라(모델+연식 → 세부모델) 여기가 틀리면 그 아래가 통째로 어긋난다.
 * 실제로 2021년식 DN8 이 1998~2001년 「EF 쏘나타」로 끌려갔다.
 * 의심스러우면 최초등록일로 넘긴다 — 등록은 모델연도보다 늦을 수 있어도 세대는 맞다.
 */
const yearLooksLikeDisplacement = (p: EntityRecord): boolean => {
  const digits = (v: unknown) => String(v ?? '').replace(/[^\d]/g, '');
  const year = digits(p.year);
  if (!year || year.length !== 4) return false;
  const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object')
    ? (p._raw_vehicle as EntityRecord)
    : null;
  // 시트 원본 칸에만 cc 가 있고 상품 칸은 비어 있는 경우도 있다(실측 로체 32루9318).
  const ccs = [p.engine_cc, raw?.engine_cc].map(digits).filter((cc) => cc.length === 4);
  return ccs.some((cc) => cc === year);
};

// 세대 추론 연식 = 연식(모델연도) 우선 → 최초등록일 → 트림MY 순 보조(연식 없을 때만).
//  최초등록일은 실제 등록 시점이라 모델연도보다 늦을 수 있어 우선하지 않음(사용자 지시: "참고용").
export const carYear = (p: EntityRecord): number => (
  (yearLooksLikeDisplacement(p) ? 0 : parseYear(p.year))
  || parseYear(p.first_registration_date)
  || trimYear(p.trim_name)
  || trimYear(p.trim_extra)
);

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

/** 블롭에서 인승 — "7인승"·"8인". */
export function seatsFromBlob(blob: string): number {
  const m = /(\d{1,2})\s*인승?/.exec(blob);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 2 && n <= 15 ? n : 0;
}

/** 블롭에서 구동 — 4WD/AWD/xDrive/4MATIC/사륜 · 2WD/RWD. */
export function driveFromBlob(blob: string): string {
  const s = blob.toLowerCase();
  if (/4\s*wd|awd|x\s*drive|4matic|콰트로|quattro|4모션|사륜|네바퀴|4륜/.test(s)) return '4WD';
  if (/2\s*wd|rwd|fwd|이륜|후륜|전륜/.test(s)) return '2WD';
  return '';
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
  return unpackVehicleSignalsEngine(p, entries, {
    norm,
    carYear,
    seatsFromBlob,
    normDrive,
    driveFromBlob,
    makerGroup,
    looksCompoundVehicleText,
    canonMasterTrim,
    modelAlias: MODEL_ALIAS,
  });
}

/**
 * 같은 세부모델·같은 파워트레인 라벨의 트림을 형제 합친다.
 * 마스터가 축 조합으로 같은 sub_model 을 여러 행에 나눠 둔 경우,
 * 한쪽 행의 variant.trims 만 보면 다른 행에 있는 등급이 사라진다
 * (실측 2026-08-09 · 스타리아 US4 LPG 3.5: 모던 유/무 행 혼재 → 700호2227).
 */
function unionVariantTrims(
  entries: MasterEntry[],
  sub: string,
  variant: MasterVariant | undefined,
  fallbackEntryTrims?: string[],
): string[] {
  if (!variant) return realMasterTrims(fallbackEntryTrims || []);
  const sameCombination = (candidate: MasterVariant): boolean => (
    masterVariantLabel(candidate) === masterVariantLabel(variant)
    && normFuel(candidate.fuel) === normFuel(variant.fuel)
    && candidate.displacement_l === variant.displacement_l
    && candidate.turbo === variant.turbo
    && normDrive(candidate.drivetrain) === normDrive(variant.drivetrain)
    && candidate.seat === variant.seat
    && candidate.battery_kwh === variant.battery_kwh
  );
  const bag = new Set<string>();
  for (const ent of entries) {
    if (ent.sub_model !== sub) continue;
    for (const sib of ent.variants || []) {
      // 라벨만 같은 7인승·9인승은 서로 다른 조합이다. 같은 완성 조합으로 분할된 중복 노드만 합친다.
      if (!sameCombination(sib)) continue;
      for (const t of sib.trims || []) {
        const s = String(t ?? '').trim();
        if (s) bag.add(s);
      }
    }
  }
  for (const t of variant.trims || []) {
    const s = String(t ?? '').trim();
    if (s) bag.add(s);
  }
  // 파워트레인 노드에 트림 목록이 전혀 없는 구형 마스터만 엔트리급 목록으로 보완한다.
  // 노드 목록이 있는데 엔트리 전체 트림을 섞으면 「7인승 프레스티지」처럼 실재하지 않는 조합이 생긴다.
  if (!bag.size) {
    for (const t of fallbackEntryTrims || []) {
      const s = String(t ?? '').trim();
      if (s) bag.add(s);
    }
    for (const ent of entries) {
      if (ent.sub_model !== sub) continue;
      for (const t of ent.trims || []) {
        const s = String(t ?? '').trim();
        if (s) bag.add(s);
      }
    }
  }
  return realMasterTrims([...bag]);
}

/**
 * 정규화 후에도 마스터 트림으로 풀리지 않은 공급사 표기 후보.
 * 풀 차명에서 제조사·세대·연료·숫자만 남은 경우는 «트림 누락»이고,
 * 마지막에 별도 등급 토큰이 남으면 «마스터 누락 또는 공급사 오기»로 검수한다.
 */
function unresolvedTrimEvidence(
  normalizedTrim: unknown,
  rawTrim: unknown,
  entry: MasterEntry,
  variant: MasterVariant | undefined,
): string {
  const normalized = String(normalizedTrim ?? '').trim();
  const known = norm([
    entry.maker,
    entry.model,
    entry.sub_model,
    entry.gen_code,
    variant ? masterVariantLabel(variant) : '',
  ].join(' '));
  const ignore = /^(?:the|all|new|더|뉴|디|올|신형|구형|기본|기본형|자가용|렌터카|렌트|장기렌트|즉시출고|가솔린|휘발유|디젤|경유|lpg|lpi|하이브리드|hev|phev|전기|ev|수소|awd|4wd|2wd|fwd|rwd|터보|turbo|오토|자동)$/i;
  const optionLike = /^(?:\d+인치|sds\d*|패키지\d*|파퓰러|파퓰러패키지\d*|a\/?t|dct|cvt)$/i;
  const optionCompound = (value: string) => /인치|패키지|파퓰러|sds\d/i.test(value)
    && !/프레스티지|노블레스|시그니처|캘리그래피|익스클루시브|인스퍼레이션|모던|스마트|트렌디/i.test(value);
  if (normalized && !isNoTrimLabel(normalized) && !isForbiddenAsTrim(normalized)) {
    const nn = norm(normalized);
    const identityOnly = known.includes(nn)
      || (norm(entry.model).length >= 2 && nn.includes(norm(entry.model)))
      || ignore.test(normalized)
      || optionLike.test(normalized)
      || optionCompound(normalized)
      || /^(?:\d+(?:\.\d+)?(?:cc|l|t|년식|년|my|인승?)?|[a-z]{1,3}\d{1,4}[a-z]?)$/i.test(normalized.replace(/^-+|-+$/g, ''));
    if (!identityOnly) return normalized;
  }

  const raw = String(rawTrim ?? '').trim();
  if (!raw || isNoTrimLabel(raw)) return '';
  const tokens = raw.split(/[\s/|,·]+/).map((token) => token
    .replace(/^[()[\]{}]+|[()[\]{}]+$/g, '')
    .replace(/^-+|-+$/g, '')).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    const nt = norm(token);
    if (nt.length < 2 || ignore.test(token) || optionLike.test(token) || optionCompound(token)) continue;
    if (isForbiddenAsTrim(token)) continue;
    if (/^(?:\d+(?:\.\d+)?(?:cc|l|t|년식|년|my|인승?)?|[a-z]{1,3}\d{1,4}[a-z]?)$/i.test(token)) continue;
    if (known.includes(nt) || (norm(entry.model).length >= 2 && nt.includes(norm(entry.model)))) continue;
    return token.slice(0, 40);
  }
  return '';
}

/** 마스터 배열 순서 자체가 등급 순서다. 첫 노드가 「세부등급 없음」이면 그것도 유효한 기본 선택이다. */
function baseTrimFromMaster(
  variant: MasterVariant | undefined,
  entryTrims: string[] | undefined,
): { available: boolean; trim: string } {
  const source = variant?.trims?.length ? variant.trims : (entryTrims || []);
  const firstRaw = source.map((value) => String(value ?? '').trim()).find(Boolean) || '';
  if (!firstRaw) return { available: false, trim: '' };
  if (isNoTrimLabel(firstRaw)) return { available: true, trim: '' };
  return { available: true, trim: realMasterTrims(source)[0] || '' };
}

export function snapToMaster(p: EntityRecord, entries: MasterEntry[]): SnapResult | null {
  // 원본 수집 신호 우선 → 한줄·섞인 표기 분해 → 이후는 구조화 필드 매칭
  const rawInput = withRawVehicleSignals(p);
  const rawTrimInput = rawInput.trim_name;
  p = unpackVehicleSignals(rawInput, entries);
  const signalBlob = vehicleSignalBlob(p);
  // 정규화가 다른 보조칸의 짧은 등급을 고르더라도 공급사가 준 원래 차명(트림)을 잃지 않는다.
  const trimSignalBlob = `${signalBlob} ${String(rawTrimInput ?? '').trim()}`.trim();
  const wantTurbo = turboHint(p, signalBlob);
  // ★차종 선택에는 **좁은 블롭**을 쓴다 — 옵션 칸의 「N Line」·「아틀라스 화이트」가
  //   수입차 라인업과 글자로 맞아 아반떼를 파사트로 만든다(실측 2026-08-09).
  //   트림 추출은 아래에서 넓은 `signalBlob` 을 그대로 쓴다.
  const selected = selectMasterEntry(p, entries, vehicleModelSignalBlob(p), {
    norm,
    makerGroup,
    genCodes,
    normModel,
    modelFromSub,
    similarity: sim,
    extractGen,
    ordinalGen,
    genOrder,
    carYear,
    normFuel,
  });
  if (!selected) return null;
  const {
    entry: e,
    score: bestScore,
    modelSimilarity: modelSim,
    lockedModel,
    makerPool: pool,
    year,
  } = selected;

  // 마스터 기본 조합(또는 축 휴리스틱)으로 빈 인승·구동 신호를 맞춘 뒤 variant 고른다(저장값은 노드만).
  const hints = snapDefaultHints(p, e, entries);
  const scored: EntityRecord = { ...p };
  if (hints.filled.seats) scored.seats = hints.seats;
  if (hints.filled.drive_type) scored.drive_type = hints.drive_type;

  let { variant, seatMatters, conflicts } = selectMasterVariant(
    scored,
    e,
    entries,
    lockedModel,
    signalBlob,
    wantTurbo,
    { norm, normDrive, defaulted: hints.filled },
  );

  /**
   * ★트림을 근거로 파워트레인을 되돌아본다(2026-08-09).
   *
   * 계단식으로 좁히면 끝에는 선택지가 몇 개 없다 — 그런데 **중간에서 한 칸 잘못 들면**
   * 그 아래 트림 목록이 통째로 달라져 답이 사라진다.
   *   실측: 아반떼 CN7 이 「가솔린 1.6T」로 잡혔는데 그 아래 트림은 「인스퍼레이션」뿐이라
   *   원문의 「모던」을 못 잡았다. 같은 세대의 「가솔린 1.6」엔 「모던」이 있다.
   *
   * 그래서 **고른 파워트레인에 원문의 트림이 없고, 같은 세대의 다른 파워트레인엔 있으면**
   * 그쪽으로 옮긴다. 후보가 하나로 좁혀질 때만 옮긴다 — 둘 이상이면 근거가 약하다.
   */
  if (variant && Array.isArray(e.variants) && e.variants.length > 1) {
    const here = realMasterTrims(variant.trims?.length ? variant.trims : []);
    if (!resolveTrim(trimSignalBlob, here)) {
      /**
       * ★공급사가 **명시한 제원을 거스르는** 파워트레인으로는 옮기지 않는다.
       *
       * 실측 2026-08-09: 「더 뉴 카니발 KA4 디젤 2.2 7인승 프레스티지」에서
       * 디젤 2.2 쪽 트림 목록에 「프레스티지」가 없다고 가솔린 3.5·9인승으로 옮겨
       * **인승이 7 → 9 로 바뀌었다.** 트림 하나 얻자고 인승·연료를 틀리면 손해다.
       * 공급사가 적어 준 값이 마스터 트림 목록보다 세다.
       */
      const digits = (value: unknown) => Number(String(value ?? '').replace(/[^0-9]/g, '')) || 0;
      const wantFuel = normFuel(p.fuel_type);
      const wantSeat = digits(p.seats);
      const wantCc = digits(p.engine_cc);
      // 원문·칸의 구동(xDrive/4MATIC/AWD…)도 거스르지 않는다.
      // 실측: G60 「520i xDrive」가 xDrive 노드(530i만)에 트림 없다고 2WD로 넘어감.
      const wantDrive = normDrive(p.drive_type) || driveFromBlob(trimSignalBlob);
      const contradicts = (v: NonNullable<typeof variant>): boolean => {
        const vFuel = normFuel(v.fuel || masterVariantLabel(v));
        if (wantFuel && vFuel && !vFuel.includes(wantFuel)) return true;
        if (wantSeat && v.seat != null && Number(v.seat) !== wantSeat) return true;
        // 배기량 표기는 반올림이 섞여 0.2L 까지는 같은 것으로 본다.
        if (wantCc && v.displacement_l != null && v.displacement_l > 0
          && Math.abs(Math.round(v.displacement_l * 1000) - wantCc) > 200) return true;
        if (wantDrive && v.drivetrain) {
          const got = normDrive(v.drivetrain);
          if (got && got !== wantDrive) return true;
        }
        return false;
      };

      let better = (e.variants as typeof e.variants)
        .filter((v) => v !== variant && v?.trims?.length && !contradicts(v))
        .map((v) => ({ v, hit: resolveTrim(trimSignalBlob, realMasterTrims(v.trims)) }))
        .filter((x) => x.hit);
      /**
       * 후보가 둘 이상이면 **원문의 연료로 가른다.**
       * 「모던」은 아반떼 CN7 의 「가솔린 1.6」과 「하이브리드 1.6」 양쪽에 있는데,
       * 원문이 「가솔린」이면 답은 하나다. 연료도 못 가리면 손대지 않는다.
       */
      if (better.length > 1) {
        const fuel = normFuel(p.fuel_type);
        if (fuel) {
          const sameFuel = better.filter((x) => normFuel(masterVariantLabel(x.v)).includes(fuel)
            || normFuel(String((x.v as Record<string, unknown>).fuel_type ?? '')) === fuel);
          if (sameFuel.length === 1) better = sameFuel;
        }
      }
      if (better.length === 1) variant = better[0].v;
    }
  }

  let trim = '';
  const trimSrc = unionVariantTrims(entries, e.sub_model, variant, e.trims);
  // 트림: 고른 완성 조합의 실트림 안에서만 선택한다.
  // 공급사 마케팅 한줄("The All new G80 2.5 터보…")을 트림으로 남기지 않음.
  if (trimSrc.length) {
    const signal = String(p.trim_name ?? '').trim();
    // 1) 원문 트림이 마스터 노드와 정확히(·영문 별칭으로) 같으면 그걸 우선.
    if (signal && !isNoTrimLabel(signal)) {
      const canon = canonMasterTrim(signal, trimSrc);
      if (canon && trimSrc.includes(canon)) trim = canon;
    }
    // 2) 별칭·오탈자·포함 — sim 보다 먼저(「520i M Spt」가 sim 으로 「520i」에 먹히지 않게).
    if (!trim) {
      const hit = resolveTrim(trimSignalBlob, trimSrc);
      if (hit) trim = hit.trim;
    }
    // 3) 최후: 유사도
    if (!trim && signal && !isNoTrimLabel(signal)) {
      const hit = trimSrc.map((x) => ({ x, ts: sim(signal, x) })).sort((a, b) => b.ts - a.ts)[0];
      if (hit && (hit.ts >= 0.85 || norm(signal) === norm(hit.x))) trim = hit.x;
    }
  }

  const defaults: SnapDefaultAtoms = { ...hints.filled };
  // 힌트가 있었어도 실제 선택 노드에 값이 없으면 «자동으로 채웠다»고 표시하지 않는다.
  if (!(seatMatters && variant?.seat != null)) delete defaults.seats;
  if (!variant?.drivetrain) delete defaults.drive_type;

  const suppliedFuel = normFuel(p.fuel_type);
  const suppliedCc = Number(String(p.engine_cc ?? '').replace(/,/g, '')) || 0;
  const suppliedSeats = Number(p.seats) || 0;
  const suppliedDrive = normDrive(p.drive_type);
  const suppliedVariant = String(p.variant ?? '').trim();
  if (variant) {
    if (!suppliedVariant && !suppliedFuel && !suppliedCc && !suppliedSeats && !suppliedDrive && !wantTurbo) {
      defaults.variant = true;
    }
    if (!suppliedFuel && variant.fuel) defaults.fuel_type = true;
    if (!suppliedCc && variant.displacement_l != null && variant.displacement_l > 0) defaults.engine_cc = true;
  }

  // 트림이 정말 비었으면 선택된 파워트레인 노드의 첫 순서(마스터의 기본/최저 트림)를 쓴다.
  // 반대로 공급사가 별도 등급을 적었는데 조합에 없으면 기본값으로 숨기지 않고 검수로 보낸다.
  let trimIssueValue = '';
  if (!trim) {
    trimIssueValue = unresolvedTrimEvidence(p.trim_name, rawTrimInput, e, variant);
    if (!trimIssueValue) {
      const baseTrim = baseTrimFromMaster(variant, e.trims);
      if (baseTrim.available) {
        trim = baseTrim.trim;
        defaults.trim_name = true;
      } else if (trimSrc.length) {
        trim = trimSrc[0] || '';
        defaults.trim_name = true;
      }
    }
  }

  const conflictValue = (field: (typeof conflicts)[number]): string => {
    if (field === 'fuel_type') return String(p.fuel_type ?? '').trim();
    if (field === 'engine_cc') return String(p.engine_cc ?? '').trim();
    if (field === 'seats') return String(p.seats ?? '').trim();
    if (field === 'drive_type') return String(p.drive_type ?? '').trim();
    return '터보';
  };
  const issues: SnapIssue[] = [...new Set(conflicts)].map((field) => ({
    code: 'powertrain_conflict' as const,
    field,
    value: conflictValue(field),
  }));
  if (trimIssueValue) issues.push({ code: 'trim_not_in_master', field: 'trim_name', value: trimIssueValue });

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
  const confidence: SnapResult['confidence'] = (trimConflict || issues.length)
    ? 'low'
    : (ms >= 0.7 && bestScore >= 3) ? 'high' : (ms >= 0.45 && bestScore >= 0.5) ? 'medium' : 'low';
  // 결과 스펙 = 마스터 노드만. 신호·최빈값으로 임의 채우기 금지(미선택=공란).
  return {
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code,
    origin: e.origin,
    year_start: e.year_start, year_end: e.year_end,
    variant: variant ? masterVariantOptionLabel(variant, e.variants || [], e) : undefined,
    trim_name: trim, // '' = 세부트림 없음(정상). undefined 아님 — applySnap이 원본 마케팅 문구를 유지하지 않게.
    fuel_type: variant?.fuel || undefined,
    engine_cc: variant?.displacement_l != null && variant.displacement_l > 0
      ? String(Math.round(variant.displacement_l * 1000))
      : undefined,
    seats: seatMatters && variant?.seat != null ? String(variant.seat) : undefined,
    // 구동도 고른 마스터 조합 노드 값만. 노드에 없으면 발명하지 않는다.
    drive_type: variant?.drivetrain ? String(variant.drivetrain).trim() : undefined,
    year: year ? String(year) : (p.year ? String(p.year) : undefined),
    confidence,
    defaults: Object.keys(defaults).length ? defaults : undefined,
    issues: issues.length ? issues : undefined,
  };
}

/**
 * 검수 트레이스·감사로그 **전용** 원문 표기 = T3.
 * 조립은 vehicle-name.ts 가 SSOT. 여기만 model 과 sub_model 을 둘 다 붙이고
 * makerDisplay 를 안 거친다 — 증거 보존이 목적이라 원문 그대로여야 한다.
 * (그래서 목록의 `기아 쏘렌토 MQ4` 가 여기선 `기아자동차 쏘렌토 쏘렌토 MQ4 2.2 디젤` 로 보인다.
 *  같은 화면에 두 등급을 나란히 놓지 말 것 — 그게 "양식이 다르다"의 원인이었다.)
 */
export function vehicleIdentityLine(p: EntityRecord | RawVehicle | null | undefined): string {
  return vehicleNameOf({ kind: 'raw', raw: p as EntityRecord | null | undefined }, { tier: 'raw', fallback: 'dash' });
}

/**
 * applySnap — 스냅 결과를 매물 레코드에 계단식으로 반영(SSOT). 페이지·일괄 재구현 공용.
 *   · 신원(제조사·모델·세부·세대·variant) = 트리 노드로 덮어쓰기(원본은 evidence였을 뿐).
 *   · 스펙(연료·배기·인승·구동) = 노드 값 우선, 노드에 없을 때만 원본 유지.
 *   · 트림 = 마스터 실트림 우선. 없으면 시트에서 뽑은 짧은 등급 유지(아이카 B형 문장 트림).
 *     긴 마케팅 문장은 trim_extra / _raw_vehicle.
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
  // 마스터에 등급 노드가 없어도 시트에서 뽑은 **짧은 등급**은 유지.
  // 풀 문장(「신형K5 2.0 LPI 렌터카 스탠다드」)은 절대 트림 이름에 남기지 않는다.
  const GRADE_KEEP = /^(?:(?:LPI|GDI|HEV|PHEV|EV)\s*)?(?:트렌디|스탠다드|프레스티지|노블레스|익스클루시브|시그니처|모던|스마트|럭셔리|디럭스|기본형|캘리그래피|인스퍼레이션|르블랑|어스|에어|그래비티|컨비니언스|얼티메이트|리미티드)(?:\s*\([^)]*\))?$/i;
  const trimWasResolvedAsDefault = res.defaults?.trim_name === true;
  const trimNeedsReview = res.issues?.some((issue) => issue.code === 'trim_not_in_master') === true;
  const keepShort = !trimOut && !trimWasResolvedAsDefault && !trimNeedsReview && prevTrim && !isNoTrimLabel(prevTrim)
    && !isForbiddenAsTrim(prevTrim)
    && (
      (prevTrim.length <= 12 && !/\s/.test(prevTrim))
      || GRADE_KEEP.test(prevTrim)
      || (/^[A-Z0-9]{2,5}(?:i|d|e)?(?:\s*M\s*Spt)?$/i.test(prevTrim) && prevTrim.length <= 14)
    );
  const pickedTrim = sanitizeAxisValue('trim_name', trimOut || (keepShort ? prevTrim : ''));
  const next: EntityRecord = {
    ...rec,
    _raw_vehicle: rawVehicle,
    _snapped: true,
    _snap_confidence: res.confidence,
    maker: res.maker, model: res.model, sub_model: res.sub_model, catalog_id: res.gen_code,
    gen_year_start: res.year_start ?? rec.gen_year_start, gen_year_end: res.year_end ?? rec.gen_year_end,
    variant: sanitizeAxisValue('variant', res.variant || ''),
    trim_name: pickedTrim,
    trim_extra: migratedExtra,
    fuel_type: keep(res.fuel_type, rec.fuel_type),
    engine_cc: keep(res.engine_cc, rec.engine_cc),
    seats: keep(res.seats, rec.seats),
    drive_type: keep(res.drive_type, rec.drive_type),
    year: keep(res.year, rec.year),
  };
  // 스펙 원자 자체는 마스터 노드만. 기본값 힌트는 미리보기 메타로만 남긴다.
  // null은 soft-merge에서 «예전 자동/충돌 표식을 지우라»는 명시값이다.
  // 키를 삭제해 버리면 incoming에 필드가 없어 기존 검수 사유가 영구 잔존한다.
  next._snap_defaults = res.defaults && Object.keys(res.defaults).length ? res.defaults : null;
  next._snap_issues = res.issues?.length ? res.issues : null;
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
  return reconcileToMasterEngine(products, entries, opts, snapToMaster, applySnap);
}

export { isMasterPath, masterPathSet } from '@/lib/domain/vehicle-master-operations';

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
  return auditMasterFitEngine(products, entries, snapToMaster);
}
