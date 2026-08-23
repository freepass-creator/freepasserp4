/**
 * **차종마스터·코드 잠금 — 어떤 AI가 와도 이 파일만 보면 된다.**
 *
 * ★사장님 2026-08-21 — 「차종마스터 이제 이거로 확실히 쓸거고 코드관리 확실히 할수 있게끔
 *   다른 AI가 만져도 문제 없게」.
 *
 *   이름 사전 = `public/data/vehicle-master.json` (+ 원천대장 「차종마스터_규격채택」)
 *   트림행키(mf-) 책 = `data/vehicle-trim-key-registry.json` (원천대장 「차종마스터」 탭은 **읽기만**)
 *   엔카 원자 시트 = 중고 시세 행키(M/SM/T)만. 정제칸 이름을 쓰지 않는다.
 *
 * 검사: `npx tsx scripts/check-vehicle-master-lock.mts`
 * 스냅 회귀: `npx tsx scripts/verify-master-pass.mts`
 */
import { MASTER_SHEET_ID } from './legacy-sheets';
import {
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_OLD_TRIM_CODE_COLUMN,
  ENCAR_SUB_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  REQUEST_COLUMN_NAME,
} from './supplier-template-sheet';

export const VEHICLE_NAME_DICTIONARY = 'public/data/vehicle-master.json';
export const VEHICLE_CODE_REGISTRY = 'data/vehicle-trim-key-registry.json';
export const LIVE_VEHICLE_MASTER_SHEET_ID = MASTER_SHEET_ID;
export const LIVE_VEHICLE_MASTER_TAB = '차종마스터';

/**
 * 세부모델 이름 — 모델이 구분만 되면 된다. 기존 그 모델 줄을 보고 따른다.
 * 풀체인지 첫 줄 = `{모델} {코드}` (아반떼 CN8, 아반떼 CN7, 팰리세이드 LX3).
 * 같은 코드 부분변경 = `더 뉴 {모델} {코드}` (더 뉴 아반떼 CN7).
 * `디 올 뉴`/`올 뉴`/`The all new` 는 aliases. 세부모델에 박으면 다음 페리가 `더 뉴 디 올 뉴 …`가 된다.
 */
export const SUBMODEL_NAME_RULE = 'model+gen_code';

/**
 * 세부트림·세부모델의 **제조사 공식 라틴 고유명** — 한글화 금지.
 * Premium→프리미엄 같은 등급어와 다르다. H-PICK·N Line·X Line·GT Line 은 상품명,
 * 아반떼 N·아이오닉5 N 의 N 은 고성능 라인(트림 N Line 과 합치지 않음).
 */
export const LATIN_BRAND_TRIM_CANON = ['H-PICK', 'N Line', 'X Line', 'GT Line'] as const;
const LATIN_BRAND_TRIM_FOLD: Record<string, (typeof LATIN_BRAND_TRIM_CANON)[number]> = {
  'h-pick': 'H-PICK', 'h pick': 'H-PICK', 'hpick': 'H-PICK', 'h-픽': 'H-PICK', 'h픽': 'H-PICK',
  'n line': 'N Line', 'n-line': 'N Line', 'nline': 'N Line', 'n라인': 'N Line', '엔 라인': 'N Line', '엔라인': 'N Line',
  'x line': 'X Line', 'x-line': 'X Line', 'xline': 'X Line', 'x라인': 'X Line',
  'gt line': 'GT Line', 'gt-line': 'GT Line', 'gtline': 'GT Line', 'gt라인': 'GT Line', 'gt ligne': 'GT Line',
};

/** 문장 안의 라틴 고유명만 정본으로. 홀로 선 N(아반떼 N·아이오닉5 N)은 건드리지 않는다. */
export function applyLatinBrandTokens(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/H[\s\-]*픽/gi, 'H-PICK');
  s = s.replace(/H[\s\-]*pick\b/gi, 'H-PICK');
  s = s.replace(/엔\s*라인/g, 'N Line');
  s = s.replace(/N[\s\-]*라인/gi, 'N Line');
  s = s.replace(/\bN[\s\-]*Line\b/gi, 'N Line');
  s = s.replace(/X[\s\-]*라인/gi, 'X Line');
  s = s.replace(/\bX[\s\-]*Line\b/gi, 'X Line');
  s = s.replace(/GT[\s\-]*라인/gi, 'GT Line');
  s = s.replace(/\bGT[\s\-]*Ligne\b/gi, 'GT Line');
  s = s.replace(/\bGT[\s\-]*Line\b/gi, 'GT Line');
  return s.replace(/\s+/g, ' ').trim();
}

export function canonLatinBrandTrim(raw: unknown): string {
  const src = String(raw ?? '').trim();
  if (!src) return '';
  const key = src.toLowerCase().replace(/\s+/g, ' ').trim();
  return LATIN_BRAND_TRIM_FOLD[key] || LATIN_BRAND_TRIM_FOLD[key.replace(/-/g, ' ')] || '';
}

/** 스냅·원문 대조용 — N Line ↔ N라인, H-PICK ↔ H-픽. 정본 N 과 N Line 은 서로 넣지 않는다. */
export function latinBrandNeedles(phrase: string): string[] {
  const src = String(phrase ?? '').trim();
  if (!src) return [];
  const canon = applyLatinBrandTokens(src);
  const out = new Set<string>([src, canon]);
  out.add(canon
    .replace(/\bN Line\b/g, 'N라인')
    .replace(/\bX Line\b/g, 'X라인')
    .replace(/\bGT Line\b/g, 'GT라인')
    .replace(/H-PICK/g, 'H-픽'));
  for (const [alias, token] of Object.entries(LATIN_BRAND_TRIM_FOLD)) {
    if (canon === token || canon.includes(token)) {
      out.add(alias);
      out.add(canon.split(token).join(alias));
    }
  }
  return [...out].filter(Boolean);
}

/** fill 이 우리 차종마스터에서 박는 칸. stamp(엔카)가 쓰면 A6가 e-트론이 된다. */
export const FILL_OWNED_COLUMNS = [
  '제조사(정제)', '모델', '세부모델', '세부트림',
  '배기량(정제)', '연료(정제)', '구동방식',
  '차종분류', '차종분류코드', '차명(정제)', '원산지',
  '차종코드', '연식',
] as const;

/** stamp 가 공급사 시트에 쓸 수 있는 칸 — 엔카 행키 + 점검사항. */
export const STAMP_ALLOWED_COLUMNS = [
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_SUB_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  ENCAR_OLD_TRIM_CODE_COLUMN,
  REQUEST_COLUMN_NAME,
] as const;

export function isFillOwnedColumn(name: string): boolean {
  return (FILL_OWNED_COLUMNS as readonly string[]).includes(name);
}

export function isStampAllowedColumn(name: string): boolean {
  return (STAMP_ALLOWED_COLUMNS as readonly string[]).includes(name);
}

/** 라이브 원천대장 「차종마스터」 탭에 쓰지 못하게. 상품마스터·규격채택 탭은 이 검사가 통과한다. */
export function assertNotLiveVehicleMasterTabWrite(spreadsheetId: string, rangeOrTab: string, what = 'write') {
  if (String(spreadsheetId || '').trim() !== LIVE_VEHICLE_MASTER_SHEET_ID) return;
  const raw = String(rangeOrTab || '');
  const tab = raw.replace(/^'+|'.*$/g, '').split('!')[0].replace(/''/g, "'").trim();
  if (tab === LIVE_VEHICLE_MASTER_TAB) {
    throw new Error(`refusing to ${what} live ERP 「${LIVE_VEHICLE_MASTER_TAB}」 tab — 이름은 ${VEHICLE_NAME_DICTIONARY}, 코드는 ${VEHICLE_CODE_REGISTRY} (읽기만)`);
  }
}

/** stamp 가 정제칸 이름을 쓰려 하면 즉시 실패 — 다른 AI가 한 줄 넣어도 여기서 막힌다. */
export function assertStampColumnAllowed(name: string) {
  if (isStampAllowedColumn(name)) return;
  throw new Error(`stamp는 엔카 행키(M/SM/T)·점검사항만. 「${name}」은 fill(${VEHICLE_NAME_DICTIONARY}) 몫이다`);
}
