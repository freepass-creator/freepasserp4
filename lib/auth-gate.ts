/**
 * UI 권한 게이트 — 화면 진입 방어(실제 강제는 RTDB 규칙).
 * members·감사·월별정산·데이터점검·개발도구 공통.
 */
import { isGuest } from '@/lib/auth-session';
import { getRole } from '@/lib/domain/deal';

/** 관리자 전용 화면 — 둘러보기(guest) 또는 비관리자면 false. */
export function isAdminUiAllowed(): boolean {
  return !isGuest() && getRole() === 'admin';
}
