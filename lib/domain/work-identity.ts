/** 업무 화면에 그대로 노출해도 되는 식별자 경계 — 권한 판정에는 사용하지 않는다. */

/** Firebase UID·push key처럼 보이는 내부 식별자. */
export function isOpaqueIdentity(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return raw.length >= 20 && /^[A-Za-z0-9_-]+$/.test(raw);
}

/**
 * 사람에게 발급한 업무코드만 허용한다.
 * 세션 코드가 비어 UID로 대체된 레거시 레코드를 목록에 그대로 노출하지 않기 위한 allow-list다.
 */
export function isSafeBusinessCode(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 40 || isOpaqueIdentity(raw)) return false;
  return /^(?:usr|user|agt|agent|sup|chn|channel)[_-][A-Za-z0-9][A-Za-z0-9_-]{1,30}$/i.test(raw)
    // 실제 발급 코드는 U0045·S0006·R0001 처럼 「영문 1~3자 + 숫자」다. 예전 목록은 U…·SP… 계열만
    // 인정해 169명 중 57명이 코드 대신 역할명(「영업 담당자」)으로 불렸다 — 실측하고 넓혔다.
    // UID 는 20자 이상 뒤섞인 문자열이라 이 형식에 걸리지 않는다(isOpaqueIdentity 가 먼저 막는다).
    || /^[A-Za-z]{1,3}\d{2,6}$/.test(raw);
}

export function safeBusinessCode(value: unknown, identityValue?: unknown): string {
  const raw = String(value ?? '').trim();
  const identity = String(identityValue ?? '').trim();
  // 이관 레코드가 UID를 agent_code/provider_company_code에 그대로 복사한 경우는
  // 형식이 업무코드처럼 보여도 사용자용 코드로 노출하지 않는다.
  return isSafeBusinessCode(raw) && (!identity || raw !== identity) ? raw : '';
}
