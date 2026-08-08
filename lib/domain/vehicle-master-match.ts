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
 *   · 예외(선택 힌트만, 저장값 아님): 마스터 variant.default 조합 — 없으면 구동 2WD·인승 modeSeat.
 *   · 인승 = 세대 안에서 seat가 갈릴 때만(예: 카니발·팰리세이드). 단일·무축 승용은 인승 없음.
 *   · 트림 신호 없거나 사전 미매칭 → 공란 유지.
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
  vehicleSignalBlob,
  withRawVehicleSignals,
} from '@/lib/domain/vehicle-master-signals';
import {
  isNoTrimLabel,
  masterVariantLabel,
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

export function snapToMaster(p: EntityRecord, entries: MasterEntry[]): SnapResult | null {
  // 원본 수집 신호 우선 → 한줄·섞인 표기 분해 → 이후는 구조화 필드 매칭
  p = unpackVehicleSignals(withRawVehicleSignals(p), entries);
  const signalBlob = vehicleSignalBlob(p);
  const wantTurbo = turboHint(p, signalBlob);
  const selected = selectMasterEntry(p, entries, signalBlob, {
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

  const { variant, seatMatters } = selectMasterVariant(
    scored,
    e,
    entries,
    lockedModel,
    signalBlob,
    wantTurbo,
    { norm, normDrive },
  );

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
  const confidence: SnapResult['confidence'] = trimConflict ? 'low' : (ms >= 0.7 && bestScore >= 3) ? 'high' : (ms >= 0.45 && bestScore >= 0.5) ? 'medium' : 'low';
  // 결과 스펙 = 마스터 노드만. 신호·최빈값으로 임의 채우기 금지(미선택=공란).
  return {
    maker: e.maker, model: e.model, sub_model: e.sub_model, gen_code: e.gen_code,
    origin: e.origin,
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
    defaults: Object.keys(hints.filled).length ? hints.filled : undefined,
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
  // 스펙 원자 자체는 마스터 노드만. 기본값 힌트는 미리보기 메타로만 남긴다.
  if (res.defaults && Object.keys(res.defaults).length) next._snap_defaults = res.defaults;
  else delete next._snap_defaults;
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
