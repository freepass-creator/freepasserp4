import { NextResponse } from 'next/server';
import { projectChakhandealStatus } from '@/lib/domain/chakhandeal-esign-sync';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  getChakhandealConfig,
  getChakhandealContractStatus,
  openChakhandealSupplement,
} from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * POST /api/chakhandeal/contracts/{contractCode}/supplement
 * body: { items: string[], message?: string }
 * 관리자만. 저장된 esign_id 로 보완 링크를 만들고 상태 오버레이를 갱신한다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ contractCode: string }> }) {
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (actor.role !== 'admin' || actor.rawRole !== 'admin') {
    return json({ error: '관리자만 보완 링크를 만들 수 있습니다.' }, 403);
  }

  const contractCode = S((await params).contractCode);
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }

  let items: string[] = [];
  let message = '';
  try {
    const body = await request.json() as { items?: unknown; message?: unknown };
    items = Array.isArray(body.items)
      ? [...new Set(body.items.map(S).filter(Boolean))].slice(0, 20)
      : [];
    message = S(body.message).slice(0, 1000);
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }
  if (!items.length) return json({ error: '다시 받을 단계를 골라 주세요.' }, 400);

  const db = firebaseAdminDatabase();
  const [overlaySnap, legacySnap] = await Promise.all([
    db.ref(`v4/contracts/${contractCode}`).get(),
    db.ref(`contracts/${contractCode}`).get(),
  ]);
  const contract = {
    ...((legacySnap.val() as Record<string, unknown> | null) || {}),
    ...((overlaySnap.val() as Record<string, unknown> | null) || {}),
  };
  const contractId = S(contract.esign_id);
  if (!contractId) return json({ error: '착한거래 계약 식별자가 없습니다.' }, 409);

  try {
    const opened = await openChakhandealSupplement(config, contractId, { items, message });
    // 상태 재조회로 보완 이력·활성 항목을 같은 투영기로 맞춘다.
    const status = await getChakhandealContractStatus(config, contractId);
    const projection = projectChakhandealStatus(status, contractCode);
    await db.ref(`v4/contracts/${contractCode}`).update(projection.patch);
    return json({
      ok: true,
      supplementUrl: opened.supplementUrl,
      items: opened.items,
      message: opened.message,
      supplements: opened.supplements,
      patch: projection.patch,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '보완 링크를 만들지 못했습니다.';
    const status = typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status)
      : 0;
    console.error('[chakhandeal-esign] supplement failed', contractCode, msg);
    if (status === 400 || /단계를 골라|본인확인·서류|보완할/.test(msg)) {
      return json({ error: status === 400 ? '선택한 단계로는 보완 링크를 만들 수 없습니다.' : msg }, 400);
    }
    return json({ error: '보완 링크를 만들지 못했습니다.' }, 502);
  }
}
