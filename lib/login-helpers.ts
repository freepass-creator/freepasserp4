/** 로그인 화면 보조 — 세션 재노출 + 사업자번호 실시간 매칭(partners 읽기). */
export { setGuest, getSession } from '@/lib/auth-session';
import { firebaseReady, getRtdb } from '@/lib/firebase/client';

export function firebaseReadySafe(): boolean { return firebaseReady(); }

const PARTNER_TYPE_LABEL: Record<string, string> = { provider: '공급사', sales_channel: '영업채널', operator: '운영사' };

/** 사업자번호(숫자 10자리) → partners 매칭. v3 bindLoginForm matchBizNo 이식. */
export async function matchBizNo(digits: string): Promise<{ name: string; code: string; type: string } | null> {
  const db = getRtdb(); if (!db) return null;
  const { ref, get } = await import('firebase/database');
  const partners = (await get(ref(db, 'partners'))).val() || {};
  for (const [k, p] of Object.entries<Record<string, unknown>>(partners)) {
    if (!p || p._deleted) continue;
    const pn = String(p.business_number || '').replace(/\D/g, '');
    if (pn && pn === digits) {
      const code = String(p.partner_code || k);
      const name = String(p.partner_name || p.company_name || code);
      const type = PARTNER_TYPE_LABEL[String(p.partner_type)] || String(p.partner_type || '');
      return { name, code, type };
    }
  }
  return null;
}
