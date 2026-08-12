/**
 * UI 권한 게이트 — 화면 진입 방어(실제 강제는 RTDB 규칙).
 * members·감사·월별정산·데이터점검·개발도구 공통.
 */
import { getRole } from '@/lib/domain/deal';

/** 관리자 전용 화면 — 비관리자면 false. 실권한 강제는 RTDB 규칙이 담당한다. */
export function isAdminUiAllowed(): boolean {
  return getRole() === 'admin';
}
