/**
 * 차종 축별 «그 칸에 들어오면 안 되는 값» SSOT.
 *
 *   제조사 → 모델 → 세부모델 → 파워트레인 → 세부트림
 *
 * ┌────────────┬──────────────────────────────────────────────────────────┐
 * │ 축         │ 금지 (단독·조각)                                          │
 * ├────────────┼──────────────────────────────────────────────────────────┤
 * │ 세부모델   │ 연료·구동·엔진브랜드·세부등급·용도·인치·인승·연식MY       │
 * │ 파워트레인 │ 세부등급 단독(모던·노블레스…)·용도·옵션조각·인치·인승     │
 * │            │ ※ EV 라인「스탠다드·롱레인지·퍼포먼스」단독은 파워트레인 허용 │
 * │            │ ※ 연료·구동·배기(「가솔린 2.0」「2WD」)는 파워트레인 축     │
 * │ 세부트림   │ 연료·구동·엔진단독(GDI·터보·TFSI)·용도·인치·내비N·세대수 │
 * │            │ ※ 「GDI 노블레스」「GDI X 에디션」「LPI 트렌디」는 허용     │
 * └────────────┴──────────────────────────────────────────────────────────┘
 *
 * 순환 import 방지 — `isNoTrimLabel`을 options에서 가져오지 않음.
 */
const S = (v: unknown) => String(v ?? '').trim();

function isNoTrimLabelLocal(value: unknown): boolean {
  const normalized = S(value).toLowerCase().replace(/\s+/g, '');
  if (!normalized) return true;
  return normalized === '(세부등급없음)'
    || normalized === '세부등급없음'
    || normalized === '없음'
    || normalized === '미선택'
    || normalized === '-'
    || normalized === '—';
}

/** 연료·에너지 — 파워트레인 축. 세부모델·트림 단독 금지. */
const FUEL_ONLY = /^(가솔린|디젤|하이브리드|전기|수소|lpg|lpi|lpe|hev|phev|ev|가스|엘피지)$/i;

/** 구동 — 파워트레인 축. 세부모델·트림 단독 금지. */
const DRIVE_ONLY = /^(2wd|4wd|awd|fwd|rwd|전륜|후륜|사륜|4륜|이륜|xdrive|4matic|콰트로|4모션)$/i;

/** 엔진·변속 브랜드 — 트림·세부모델 단독 금지. 파워트레인도 단독 금지(「가솔린 2.0 TFSI」는 통과). */
const ENGINE_ONLY = /^(gdi|lpi|lpe|mpi|crdi|tdi|tsi|tfsi|cdi|tce|gde|vgt|터보|turbo|스마트\s*스트림|smartstream|전기\s*모터|모터)$/i;

/** 용도·계약 말 — 어느 차종 축에도 아님 */
const USE_ONLY = /^(자가용|렌터카|렌트|리스|장기렌트|택시|영업용|사업용|법인|개인|장애인|장애인용)$/i;

/** 옵션·패키지·메타 조각 */
const OPTION_ONLY = /^(패키지|디자인|셀렉션|세단|초이스|choice|세부등급|인포테인먼트|모빌리티|사업용|기본파퓰러패키지|럭셔리오토|luxury\s*오토|luxury\s*auto)$/i;

/**
 * 세부등급 낱말 — 트림 축.
 * 파워트레인 칸 단독 금지(단, EV 용량 라인은 예외).
 */
const TRIM_GRADE_ONLY = /^(모던|스마트|프레스티지|노블레스|시그니처|트렌디|익스클루시브|인스퍼레이션|캘리그래피|그래비티|럭셔리|프리미엄|비즈니스|라이트|플러스|아이코닉|기본형|런칭|베스트|에디션|르블랑|어스|에어|컨비니언스|얼티메이트|리미티드)$/i;

/** EV·퍼포먼스 라인 — 파워트레인 라벨로 쓰임(엔카 Badge·마스터 variant). 트림 단독은 아님. */
const POWERTRAIN_LINE_OK = /^(롱\s*레인지|롱레인지|스탠다드|퍼포먼스|long\s*range|standard|performance)$/i;

function isInchOrSeatOrYear(s: string): boolean {
  if (/^\d{1,2}\s*인치[a-z]?$/i.test(s)) return true;
  if (/^\d{1,2}\s*인승$/.test(s)) return true; // 「9인승」단독 — 「가솔린 3.5 9인승」은 통과
  if (/^\d{2,4}\s*my$/i.test(s) || /^\d{2,4}년식?$/.test(s)) return true;
  if (/^\d\.\d$/.test(s)) return true;
  if (/^내비\s*\d+$/i.test(s)) return true;
  if (/^\d세대$/.test(s)) return true;
  return false;
}

function isNameFragment(s: string): boolean {
  if (/^(올\s*뉴|더\s*뉴|디\s*올\s*뉴|뉴)/.test(s) && s.length <= 14) return true;
  if (/^(벤츠|bmw|아우디|현대|기아|제네시스|쉐보레|르노|쌍용)\s*[a-z0-9]*$/i.test(s)) return true;
  if (/클래스$|시리즈$/.test(s) && s.length <= 8) return true;
  return false;
}

function hasPowertrainSignal(s: string): boolean {
  return /(가솔린|디젤|하이브리드|전기|수소|lpg|lpi|hev|phev|터보|\d\.\d|kwh|2wd|4wd|awd|xdrive|4matic|콰트로|롱\s*레인지|퍼포먼스)/i.test(s);
}

/**
 * 세부트림 칸 금지.
 * · `(세부등급 없음)` → false(빈 트림 표기, `isNoTrimLabel`이 따로 봄)
 * · 「GDI X 에디션」→ false(허용)
 */
export function isForbiddenAsTrim(raw: unknown): boolean {
  const s = S(raw);
  if (!s) return true;
  if (isNoTrimLabelLocal(s)) return false;
  const low = s.toLowerCase();
  if (FUEL_ONLY.test(s) || FUEL_ONLY.test(low)) return true;
  if (DRIVE_ONLY.test(s) || DRIVE_ONLY.test(low)) return true;
  if (ENGINE_ONLY.test(s) || ENGINE_ONLY.test(low)) return true;
  if (USE_ONLY.test(s)) return true;
  if (OPTION_ONLY.test(s) || OPTION_ONLY.test(low)) return true;
  // 「스탠다드」는 트림(K5)과 EV 파워트레인 라인 둘 다 — 트림 축에서는 허용
  if (isInchOrSeatOrYear(s)) return true;
  if (isNameFragment(s)) return true;
  return false;
}

/** 엔카·원문에서 트림을 **새로** 제안할 때(마스터 기존 등급코드 LE16 등은 scrub 유지). */
export function isForbiddenAsTrimImport(raw: unknown): boolean {
  const s = S(raw);
  if (!s || isNoTrimLabelLocal(s)) return true;
  if (isForbiddenAsTrim(s)) return true;
  if (/구조변경|튜닝|캠핑|캠퍼|리프트|장애인|영업용/.test(s)) return true;
  if (/^기본(\s*형|\s*모델)?$|^없음$|^기타$|^미정$/.test(s)) return true;
  if (/인승/.test(s)) return true;
  if (/^(?:[A-Z]{1,3}\d{2,3}[a-z]?)$/i.test(s) && s.length <= 8) return true;
  if (/xdrive|4matic|콰트로|tfsi|tdi|tsi|crdi|cdi|tce\b|gde\b|mpi\b/i.test(s)
    && !/[가-힣]{2,}/.test(s)) return true;
  if (/\b(gdi|lpi|lpe)\b/i.test(s) && !/[가-힣]{2,}/.test(s)) return true;
  if (/\b\d{2,3}[id]\b/i.test(s)) return true;
  if (/^E\d{2,3}\b/i.test(s)) return true;
  if (/^HG\d{2,3}\b/i.test(s) || /^P\d{2,3}\b/i.test(s)) return true;
  if (/^(롱레인지|스탠다드|퍼포먼스|GT|RS|ACTIV|High|Mid|Low|레인지|롱)(\s|$)/i.test(s) && s.length <= 12) return true;
  if (/^[A-Z0-9]{2,4}$/.test(s)) return true;
  if (/Black\s*(Ink|Exterior)|언차티드|스포츠\s*패키지/i.test(s)) return true;
  if (/[A-Za-z]{10,}/.test(s) && !/라인|패키지|Edition|에디션|Pick|Line|Sports|Sport/i.test(s)) return true;
  if (s.length > 28) return true;
  if (/\d\.\d/.test(s)) return true;
  return false;
}

/** 파워트레인(variant) 칸 금지 — 세부등급·용도·옵션만 오면 안 됨. */
export function isForbiddenAsVariant(raw: unknown): boolean {
  const s = S(raw);
  if (!s) return true;
  if (POWERTRAIN_LINE_OK.test(s)) return false; // EV 라인 단독 허용
  if (FUEL_ONLY.test(s) || DRIVE_ONLY.test(s)) return false; // 연료·구동 단독은 파워트레인
  if (ENGINE_ONLY.test(s)) return true; // TFSI·GDI 단독은 엔진조각
  if (TRIM_GRADE_ONLY.test(s)) return true;
  if (USE_ONLY.test(s) || OPTION_ONLY.test(s)) return true;
  if (isInchOrSeatOrYear(s)) return true;
  if (isNameFragment(s)) return true;
  // 「노블레스 …」처럼 등급으로 시작·파워트레인 신호 없음
  if (/[가-힣]{2,}/.test(s)
    && !hasPowertrainSignal(s)
    && TRIM_GRADE_ONLY.test(s.split(/\s+/)[0] || '')) return true;
  return false;
}

/** 세부모델 칸 금지 — 연료·트림·제원·엔진조각만 오면 안 됨. */
export function isForbiddenAsSubModel(raw: unknown): boolean {
  const s = S(raw);
  if (!s) return true;
  if (FUEL_ONLY.test(s) || DRIVE_ONLY.test(s) || ENGINE_ONLY.test(s)) return true;
  if (TRIM_GRADE_ONLY.test(s) || POWERTRAIN_LINE_OK.test(s)) return true;
  if (USE_ONLY.test(s) || OPTION_ONLY.test(s)) return true;
  if (isInchOrSeatOrYear(s)) return true;
  // 등급으로만 이뤄진 짧은 문장(파워·차명 신호 없음)
  if (s.length <= 20 && !hasPowertrainSignal(s)
    && TRIM_GRADE_ONLY.test(s.replace(/\s+/g, ' ').split(' ')[0] || '')
    && !/[A-Z0-9]{2,}/.test(s)) return true;
  return false;
}

/** 모델 칸 — 세부모델과 같은 금지(연료·트림·구동만). */
export function isForbiddenAsModel(raw: unknown): boolean {
  return isForbiddenAsSubModel(raw);
}

export type VehicleFieldAxis = 'sub_model' | 'variant' | 'trim_name' | 'model';

/** 축 이름으로 금지 판정. */
export function isForbiddenOnAxis(axis: VehicleFieldAxis, raw: unknown): boolean {
  if (axis === 'trim_name') return isForbiddenAsTrim(raw);
  if (axis === 'variant') return isForbiddenAsVariant(raw);
  if (axis === 'sub_model') return isForbiddenAsSubModel(raw);
  return isForbiddenAsModel(raw);
}

/** 금지면 빈 문자열, 아니면 trim. */
export function sanitizeAxisValue(axis: VehicleFieldAxis, raw: unknown): string {
  const s = S(raw);
  if (!s) return '';
  if (axis === 'trim_name' && isNoTrimLabelLocal(s)) return '';
  return isForbiddenOnAxis(axis, s) ? '' : s;
}
