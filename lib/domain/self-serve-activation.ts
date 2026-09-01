export type SelfServeActivationProfile = Record<string, unknown> | null | undefined;

export type SelfServeActivationDecision =
  | { eligible: true; reason: 'legacy_pending_self_signup' | 'workspace_member' }
  | {
    eligible: false;
    reason:
      | 'missing_profile'
      | 'not_pending'
      | 'inactive'
      | 'deleted'
      | 'identity_already_assigned'
      | 'not_self_signup';
  };

const SELF_SIGNUP_ROLES = new Set(['agent', 'provider']);

/**
 * **우리 워크스페이스 도메인 — 여기 사람은 기다리지 않는다.**
 *
 * ★사장님 2026-08-26 「프리패스 erp 우리 워크스페이스 직원들은 자동으로 통과되게 해줘」.
 *   바깥 사람은 관리자가 봐야 하지만, 우리 직원까지 승인 대기에 세울 이유가 없다.
 *
 * ★★**판정은 「검증된 이메일」로만 한다.** 프로필에 적힌 이메일은 사람이 고칠 수 있다 —
 *   그걸 믿으면 아무나 `@teamjpk.com` 이라 적고 들어온다. 서버는 **ID 토큰에서 꺼낸**
 *   이메일과 `email_verified` 를 같이 본다. 둘 중 하나라도 없으면 통과가 아니다.
 * ⚠ **자동 통과는 «승인»까지지 «권한»까지가 아니다.** 관리자는 여전히 사람이 준다 —
 *   도메인만으로 admin 을 주면 메일 하나로 전 회사 금액이 열린다.
 * ⚠ 삭제·반려·비활성은 그대로 막힌다. 내보낸 사람이 도메인 때문에 다시 들어오면 안 된다.
 */
export const WORKSPACE_DOMAINS = ['teamjpk.com'];

export const isWorkspaceEmail = (email: unknown): boolean => {
  const at = String(email || '').trim().toLowerCase().split('@');
  return at.length === 2 && WORKSPACE_DOMAINS.includes(at[1]);
};

/**
 * 예전 승인제 가입자를 즉시 이용 계정으로 전환해도 되는지 판단한다.
 *
 * 관리자에게 소속/채널을 이미 배정받았거나, 삭제·반려·비활성 처리된 계정은 절대
 * 자동 활성화하지 않는다. 자가가입 당시 남긴 uid·created_at·requested_type과 미배정
 * 신원을 모두 확인해 관리자가 의도적으로 보류한 계정이 우회 활성화되지 않게 한다.
 */
export function selfServeActivationDecision(
  profile: SelfServeActivationProfile,
  authenticatedUid: string,
  /**
   * **검증된 이메일**만 넘긴다 — 서버는 ID 토큰에서, 화면은 Firebase 사용자에서.
   * 프로필에 적힌 이메일을 여기 넣으면 안 된다(사람이 고칠 수 있다).
   */
  verified?: { email?: string; emailVerified?: boolean },
): SelfServeActivationDecision {
  if (!profile || typeof profile !== 'object' || !authenticatedUid) {
    return { eligible: false, reason: 'missing_profile' };
  }

  const status = String(profile.status || '').trim();
  if (status === 'deleted' || status === 'rejected' || profile._deleted === true) {
    return { eligible: false, reason: 'deleted' };
  }

  const isActive = profile.is_active;
  if (isActive === false || String(isActive || '').trim() === '아니오') {
    return { eligible: false, reason: 'inactive' };
  }

  // ★우리 워크스페이스 사람은 여기서 통과한다. 소속이 이미 배정돼 있어도 상관없다 —
  //   막을 이유가 «승인 대기» 하나뿐이었기 때문이다. 삭제·반려·비활성은 위에서 이미 막혔다.
  if (status === 'pending'
    && verified?.emailVerified === true
    && isWorkspaceEmail(verified.email)) {
    return { eligible: true, reason: 'workspace_member' };
  }

  if (status !== 'pending') return { eligible: false, reason: 'not_pending' };

  if (String(profile.company_code || '').trim() || String(profile.agent_channel_code || '').trim()) {
    return { eligible: false, reason: 'identity_already_assigned' };
  }

  const rawRole = String(profile.role || '').trim();
  const profileUid = String(profile.uid || '').trim();
  const requestedType = String(profile.requested_type || '').trim();
  const createdAt = Number(profile.created_at || 0);
  if (!SELF_SIGNUP_ROLES.has(rawRole)
    || profileUid !== authenticatedUid
    || !requestedType
    || !Number.isFinite(createdAt)
    || createdAt <= 0) {
    return { eligible: false, reason: 'not_self_signup' };
  }

  return { eligible: true, reason: 'legacy_pending_self_signup' };
}
