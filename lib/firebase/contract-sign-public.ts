/**
 * 공개 서명 슬롯 — RTDB contract_sign/{token}.
 * 규칙: $token .read true, 존재 후 .write 허용 → 손님 폰에서 열람·제출 가능.
 */
import { ref, get, update as dbUpdate } from 'firebase/database';
import { getRtdb, firebaseReady } from '@/lib/firebase/client';
import { type EntityRecord } from '@/lib/intake/entities';

export type ContractSignRec = EntityRecord & {
  sign_token?: string;
  status?: string;
  contract_code?: string;
};

export async function readContractSign(token: string): Promise<ContractSignRec | null> {
  if (!firebaseReady() || !token) return null;
  const db = getRtdb();
  if (!db) return null;
  try {
    const snap = await get(ref(db, `contract_sign/${token}`));
    if (!snap.exists()) return null;
    const v = snap.val() as ContractSignRec;
    return { ...v, sign_token: token, _key: String(v.contract_code || token) };
  } catch (e) {
    console.warn('[contract_sign] read 실패:', (e as Error).message);
    return null;
  }
}

export async function writeContractSign(token: string, patch: ContractSignRec): Promise<void> {
  if (!firebaseReady() || !token) return;
  const db = getRtdb();
  if (!db) return;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  clean.sign_token = token;
  clean.updated_at = Date.now();
  await dbUpdate(ref(db, `contract_sign/${token}`), clean);
}

/** store 계약 레코드 → 공개 슬롯용 요약(PII·금액 스냅샷). */
export function contractToSignPublic(c: EntityRecord, token: string, status = 'sent'): ContractSignRec {
  return {
    sign_token: token,
    status,
    contract_code: String(c.contract_code || ''),
    contract_status: c.contract_status,
    car_number: c.car_number_snapshot || c.car_number || '',
    vehicle_name: c.vehicle_name_snapshot || '',
    customer_name: c.customer_name || '',
    customer_phone: c.customer_phone || '',
    rent_amount_snapshot: c.rent_amount_snapshot,
    deposit_amount_snapshot: c.deposit_amount_snapshot,
    rent_month_snapshot: c.rent_month_snapshot,
    contract_date: c.contract_date,
    product_code: c.product_code,
    companyId: c.companyId,
    sign_status: status === 'sent' ? '발송' : status === 'pending_review' ? '검토대기' : status === 'signed' ? '서명완료' : c.sign_status,
    created_at: c.sign_sent_at || Date.now(),
  };
}

/** 공개 슬롯 → 페이지/패널이 쓰는 계약 shape. */
export function signPublicToContract(s: ContractSignRec): EntityRecord {
  const st = String(s.status || s.sign_status || '');
  const sign_status = st === 'sent' || st === '발송' ? '발송'
    : st === 'pending_review' || st === '검토대기' ? '검토대기'
    : st === 'signed' || st === '서명완료' ? '서명완료'
    : String(s.sign_status || '발송');
  return {
    ...s,
    _key: String(s.contract_code || s.sign_token || ''),
    contract_code: String(s.contract_code || ''),
    sign_token: String(s.sign_token || ''),
    sign_status,
    car_number_snapshot: s.car_number || s.car_number_snapshot,
    vehicle_name_snapshot: s.vehicle_name || s.vehicle_name_snapshot,
  };
}
