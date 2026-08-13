export type SelfServeActivationProfile = Record<string, unknown> | null | undefined;

export type SelfServeActivationDecision =
  | { eligible: true; reason: 'legacy_pending_self_signup' }
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
 * 예전 승인제 가입자를 즉시 이용 계정으로 전환해도 되는지 판단한다.
 *
 * 관리자에게 소속/채널을 이미 배정받았거나, 삭제·반려·비활성 처리된 계정은 절대
 * 자동 활성화하지 않는다. 자가가입 당시 남긴 uid·created_at·requested_type과 미배정
 * 신원을 모두 확인해 관리자가 의도적으로 보류한 계정이 우회 활성화되지 않게 한다.
 */
export function selfServeActivationDecision(
  profile: SelfServeActivationProfile,
  authenticatedUid: string,
): SelfServeActivationDecision {
  if (!profile || typeof profile !== 'object' || !authenticatedUid) {
    return { eligible: false, reason: 'missing_profile' };
  }

  const status = String(profile.status || '').trim();
  if (status === 'deleted' || status === 'rejected' || profile._deleted === true) {
    return { eligible: false, reason: 'deleted' };
  }
  if (status !== 'pending') return { eligible: false, reason: 'not_pending' };

  const isActive = profile.is_active;
  if (isActive === false || String(isActive || '').trim() === '아니오') {
    return { eligible: false, reason: 'inactive' };
  }

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
