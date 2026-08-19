/**
 * 식별코드 SSOT — 실무 표준(Stripe식 접두사 + 불변 랜덤 토큰). 예: usr_k7m2p9x4qz.
 *   · 접두사 = 엔티티 종류(사람이 타입을 알아봄).  토큰 = 뜻 없는 안정 ID.
 *   · 뜻이 없으니 "재정비" 이유가 없어 재발급 불필요 → 참조 깨질 일 없음(v3 함정 제거).
 *   · 비순차·비추측(열거 공격 방지). URL-safe. 화면엔 사람 이름을 보이고, 코드는 연결·링크용.
 * 관계 필드명(user_code·product_code…)은 유지하고 "값의 형식"만 이걸로 통일한다.
 */
export const ID_PREFIX = {
  organization: 'org', // ERP 테넌트·본사
  user: 'usr',       // 계정(영업자·공급사담당·관리자)
  partner: 'sup',    // 공급사(렌트사)
  product: 'veh',    // 매물(차량)
  policy: 'pol',     // 정책
  channel: 'chn',    // 영업채널
  customer: 'cus',   // 고객
  template: 'tpl',   // 계약서 템플릿
  inquiry: 'inq',    // 문의·상담 업무건
  room: 'rom',       // 채팅방
  message: 'msg',    // 메시지
  quote: 'quo',      // 견적
  contract: 'con',   // 계약
  esign: 'esg',      // 전자계약 발행 회차
  settlement: 'stl', // 건별 정산
  payment: 'pay',    // 수납·환불
  document: 'doc',   // 완성 문서
  attachment: 'att', // 첨부자료
  report: 'rpt',     // 오류·데이터 제보
  audit: 'aud',      // 감사이력
  run: 'run',        // 동기화·배치 실행
} as const;
export type IdKind = keyof typeof ID_PREFIX;

// base32 — 혼동문자(0/O/1/I/L) 제외. 10자 ≈ 32^10(10^15) 공간 → 이 규모에서 충돌 사실상 0.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
function token(len = 10): string {
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  let out = '';
  if (hasCrypto) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    for (let i = 0; i < len; i++) out += ALPHABET[a[i] % ALPHABET.length];
  } else {
    for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** 새 식별코드 발급 — `${접두사}_${토큰}`. 마스터 신규생성 시 이걸로. */
export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${token()}`;
}

/** 이미 이 체계의 코드인지(접두사_토큰). 마이그레이션·검증용. */
export function isId(kind: IdKind, v: unknown): boolean {
  return typeof v === 'string'
    && new RegExp(`^${ID_PREFIX[kind]}_[${ALPHABET}]{10}$`).test(v);
}

/**
 * 동일한 업무 식별값에서 항상 같은 ERP5 코드를 만든다.
 * 채팅방처럼 중복 생성되면 안 되는 레코드에 사용하며 원문 식별값은 코드에 노출하지 않는다.
 */
export async function stableId(kind: IdKind, identity: unknown): Promise<string> {
  const source = `${kind}:${String(identity ?? '').trim()}`;
  if (!source.endsWith(':')) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(source)));
      let token = '';
      for (let i = 0; i < 10; i += 1) token += ALPHABET[digest[i] % ALPHABET.length];
      return `${ID_PREFIX[kind]}_${token}`;
    }
    // 오래된 런타임용 결정적 폴백. 보안 토큰이 아니라 업무코드 중복 방지가 목적이다.
    let seed = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      seed ^= source.charCodeAt(i);
      seed = Math.imul(seed, 16777619) >>> 0;
    }
    let token = '';
    for (let i = 0; i < 10; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      token += ALPHABET[seed % ALPHABET.length];
    }
    return `${ID_PREFIX[kind]}_${token}`;
  }
  throw new Error(`${kind} 결정 ID 생성: 식별값 없음`);
}

/**
 * 1:1 파생 레코드의 결정적 ERP5 코드.
 * 현재 정산은 계약당 한 건이므로 con_ 토큰을 stl_ 로 바꿔 멱등성을 유지한다.
 * 원본이 구코드면 빈 문자열을 반환해 호출부가 레거시 규칙을 그대로 쓰게 한다.
 */
export function relatedId(from: IdKind, to: IdKind, value: unknown): string {
  const source = String(value ?? '').trim();
  if (!isId(from, source)) return '';
  return `${ID_PREFIX[to]}_${source.slice(ID_PREFIX[from].length + 1)}`;
}

const DISPLAY_PREFIX: Partial<Record<IdKind, string>> = {
  inquiry: 'I', quote: 'Q', contract: 'C', esign: 'E', settlement: 'S', payment: 'P', document: 'D', report: 'R',
};

/** 사람이 읽는 번호는 영구 ID와 분리한다. 예: FP-C-20260815-K7M2P9. */
export function displayNumber(kind: IdKind, id: string, at: Date | string | number = new Date()): string {
  const prefix = DISPLAY_PREFIX[kind] || ID_PREFIX[kind].toUpperCase();
  const date = at instanceof Date ? at : new Date(at);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const ymd = `${safeDate.getFullYear()}${String(safeDate.getMonth() + 1).padStart(2, '0')}${String(safeDate.getDate()).padStart(2, '0')}`;
  const tokenPart = String(id || '').split('_').at(-1)?.slice(-6).toUpperCase() || '------';
  return `FP-${prefix}-${ymd}-${tokenPart}`;
}

/** 신규 계약이면 stl_ 결정키, 기존 계약이면 기존 ST_ 규칙을 유지한다. */
export function settlementIdForContract(contractCode: unknown): string {
  const source = String(contractCode ?? '').trim();
  return relatedId('contract', 'settlement', source) || (source ? `ST_${source}` : '');
}

/**
 * 운영 Rules가 아직 정산 저장키를 ST_{contract_code}로 강제하므로 저장경로만 기존 규칙을 유지한다.
 * 신규 레코드의 canonical_code에는 settlementIdForContract()의 stl_ 값을 함께 기록한다.
 */
export function settlementStorageKeyForContract(contractCode: unknown): string {
  const source = String(contractCode ?? '').trim();
  return source ? `ST_${source}` : '';
}
