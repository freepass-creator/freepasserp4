/** 로그인 화면 보조 — 세션 재노출 + 사업자번호 실시간 매칭(partners 읽기). */
export { setGuest, getSession } from '@/lib/auth-session';
import { firebaseReady, getRtdb } from '@/lib/firebase/client';
import { companyAlias } from '@/lib/domain/identity';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { businessRegistrationNumberOf, normalizeBusinessRegistrationNumber } from '@/lib/domain/business-identity';

export function firebaseReadySafe(): boolean { return firebaseReady(); }

/** 사업자번호(숫자 10자리) → partners 매칭. v3 bindLoginForm matchBizNo 이식. */
export async function matchBizNo(digits: string): Promise<{ name: string; code: string; type: string } | null> {
  const db = getRtdb(); if (!db) return null;
  const target = normalizeBusinessRegistrationNumber(digits);
  const { ref, get } = await import('firebase/database');
  const partners = (await get(ref(db, 'partners'))).val() || {};
  for (const [k, p] of Object.entries<Record<string, unknown>>(partners)) {
    if (!p || p._deleted) continue;
    const pn = businessRegistrationNumberOf(p, 'partner');
    if (pn && pn === target) {
      const code = String(p.partner_code || k);
      const full = String(p.partner_name || p.company_name || p.name || code);
      const name = companyAlias(full, p.alias || p.short_name);
      const type = partnerTypeLabel(p.partner_type, code);
      return { name, code, type };
    }
  }
  return null;
}
