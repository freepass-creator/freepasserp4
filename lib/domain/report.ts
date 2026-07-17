/**
 * report — 영업자가 이상매물 제보 → 공급사·관리자 확인. v4 네이티브(overlay).
 *   제보 = 사람이 눈으로 발견한 이상(자동감지 data-check 를 보완). 관리자 확인처 = /data-check 상단.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { currentActor } from '@/lib/session';
import { type EntityRecord } from '@/lib/intake/entities';

export const REPORT_REASONS = ['사진 이상', '차종/정보 오류', '가격 이상', '중복 매물', '기타'] as const;

/** 이상매물 제보 접수(v4 저장). 규칙 배포 후 동작. */
export async function submitReport(product: EntityRecord, reason: string, memo = ''): Promise<void> {
  const co = getCompanyId();
  const a = currentActor();
  const rec: EntityRecord = {
    report_code: `RPT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    product_code: String(product.product_code ?? product._key ?? ''),
    car_number: String(product.car_number ?? ''),
    provider_company_code: String(product.provider_company_code ?? ''),
    reason, memo,
    reporter_uid: a.uid, reporter_name: a.name,
    status: '접수', at: Date.now(),
  };
  await getStore().save('report', co, [rec]);
}

/** 제보 상태 갱신(관리자: 접수→확인→처리완료). */
export async function setReportStatus(co: string, reportCode: string, status: string): Promise<void> {
  await getStore().update('report', co, reportCode, { status } as EntityRecord);
}

/** 신규(미처리) 제보 수 — 관리자 배지용. */
export async function newReportCount(co: string): Promise<number> {
  try { return (await getStore().list('report', co)).filter((r) => String(r.status) !== '처리완료').length; } catch { return 0; }
}
