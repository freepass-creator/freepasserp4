/**
 * 식별코드 SSOT — 실무 표준(Stripe식 접두사 + 불변 랜덤 토큰). 예: usr_k7m2p9x4qz.
 *   · 접두사 = 엔티티 종류(사람이 타입을 알아봄).  토큰 = 뜻 없는 안정 ID.
 *   · 뜻이 없으니 "재정비" 이유가 없어 재발급 불필요 → 참조 깨질 일 없음(v3 함정 제거).
 *   · 비순차·비추측(열거 공격 방지). URL-safe. 화면엔 사람 이름을 보이고, 코드는 연결·링크용.
 * 관계 필드명(user_code·product_code…)은 유지하고 "값의 형식"만 이걸로 통일한다.
 */
export const ID_PREFIX = {
  user: 'usr',       // 계정(영업자·공급사담당·관리자)
  partner: 'sup',    // 공급사(렌트사)
  product: 'veh',    // 매물(차량)
  policy: 'pol',     // 정책
  channel: 'chn',    // 영업채널
  contract: 'con',   // 계약(옵션)
  settlement: 'stl', // 정산(옵션)
  customer: 'cus',   // 고객(옵션)
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
  return typeof v === 'string' && v.startsWith(`${ID_PREFIX[kind]}_`);
}
