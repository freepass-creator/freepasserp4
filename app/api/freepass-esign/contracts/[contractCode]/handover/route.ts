import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  appendFreepassEsignEvent,
  canManageFreepassEsign,
  loadFreepassEsignBundle,
  validContractCode,
} from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addMonthsEnd(start: string, months: number) {
  const [year, month, day] = start.split('-').map(Number);
  const targetIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor || !canManageFreepassEsign(actor)) return json({ error: '관리자만 인도일을 확정할 수 있습니다.' }, 403);
  const contractCode = validContractCode((await params).contractCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  let date = '';
  try { date = S((await request.json() as { handover_datetime?: unknown }).handover_datetime); }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!validDate(date)) return json({ error: '인도일(YYYY-MM-DD)이 필요합니다.' }, 400);

  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (S(bundle.contract.esign_provider) !== 'freepass' || S(bundle.contract.sign_status) !== '서명완료') {
    return json({ error: '프리패스 전자계약 서명이 끝난 뒤 인도일을 확정할 수 있습니다.' }, 409);
  }
  const months = Number(bundle.contract.rent_month_snapshot || 0);
  if (!Number.isInteger(months) || months <= 0 || months > 120) {
    return json({ error: '계약 대여기간을 확인해 주세요.' }, 409);
  }
  const now = Date.now();
  const handover = {
    handover_datetime: date,
    contract_start: date,
    contract_end: addMonthsEnd(date, months),
    confirmedAt: now,
    confirmedBy: actor.uid,
  };
  await bundle.db.ref(`v4/contracts/${contractCode}`).update({ esign_handover: handover });
  await appendFreepassEsignEvent(contractCode, 'handover_confirmed', {
    actorUid: actor.uid,
    handoverDate: date,
  });
  return json({ ok: true, handover });
}
