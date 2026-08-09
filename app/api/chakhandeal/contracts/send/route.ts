import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { canSendChakhandealContract } from '@/lib/domain/chakhandeal-esign';
import { findTemplate, templatesForContract } from '@/lib/domain/esign-templates';
import {
  getChakhandealConfig,
  issueChakhandealContract,
  sendChakhandealContract,
} from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const codeText = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  // 연동 미설정 환경은 Admin SDK 인증 시도조차 하지 않고 명시적인 준비 중 상태로 닫는다.
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  let contractCode = '';
  let templateId = '';
  try {
    const body = await request.json() as { contractCode?: unknown; templateId?: unknown };
    contractCode = codeText(body.contractCode);
    templateId = codeText(body.templateId);
  } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }
  // 양식은 **등록된 것만** 통과시킨다 — 임의 문자열을 그대로 착한거래에 넘기면
  // 남의 회사 양식이나 없는 양식으로 계약이 발행된다.
  const template = templateId ? findTemplate(templateId) : null;
  if (templateId && !template) return json({ error: '알 수 없는 계약서 양식입니다.' }, 400);

  const db = firebaseAdminDatabase();
  const [legacySnap, overlaySnap] = await Promise.all([
    db.ref(`contracts/${contractCode}`).get(),
    db.ref(`v4/contracts/${contractCode}`).get(),
  ]);
  const legacy = legacySnap.val() as Record<string, unknown> | null;
  const overlay = overlaySnap.val() as Record<string, unknown> | null;
  const contract = { ...(legacy || {}), ...(overlay || {}) };
  if (!legacy && !overlay) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (!canSendChakhandealContract(actor, contract)) return json({ error: '이 계약을 발송할 권한이 없습니다.' }, 403);
  if (codeText(contract.contract_status) === '계약취소') return json({ error: '취소된 계약은 발송할 수 없습니다.' }, 409);
  if (codeText(contract.provider_agreement_done) !== 'yes') return json({ error: '약정 작성완료 후 발송할 수 있습니다.' }, 409);
  if (!codeText(contract.customer_name) || !codeText(contract.customer_phone)) return json({ error: '고객명과 연락처를 먼저 확인하세요.' }, 409);

  // 그 공급사가 쓸 수 있는 양식인지 서버에서 다시 본다 — 화면이 좁혀 놨어도 요청은 위조된다.
  if (template && !templatesForContract(contract).some((t) => t.id === template.id)) {
    return json({ error: '이 계약의 공급사가 쓸 수 있는 양식이 아닙니다.' }, 403);
  }

  try {
    const existingId = codeText(contract.esign_id);
    const issue = existingId
      ? { contractId: existingId, verifyUrl: codeText(contract.esign_verify_url), sealHash: codeText(contract.esign_seal_hash) }
      : await issueChakhandealContract(config, contract, template?.id);

    // 어느 양식으로 나갔는지는 계약에 박는다 — 나중에 «이 손님이 어느 판에 서명했나»를
    // 되짚을 수 있는 유일한 근거다. 발행 식별자와 함께 먼저 저장한다(발송 실패 대비).
    const templateStamp = template
      ? { esign_template_id: template.id, esign_template_version: template.version }
      : {};
    if (!existingId) {
      await db.ref(`v4/contracts/${contractCode}`).update({
        esign_provider: 'chakhandeal',
        esign_id: issue.contractId,
        esign_verify_url: issue.verifyUrl || '',
        esign_seal_hash: issue.sealHash || '',
        ...templateStamp,
      });
    }
    await sendChakhandealContract(config, issue.contractId, contractCode);
    await db.ref(`v4/contracts/${contractCode}`).update({
      esign_provider: 'chakhandeal',
      esign_id: issue.contractId,
      esign_verify_url: issue.verifyUrl || codeText(contract.esign_verify_url),
      esign_seal_hash: issue.sealHash || codeText(contract.esign_seal_hash),
      sign_status: '발송',
      sign_sent_at: Date.now(),
      ...templateStamp,
    });
    return json({ ok: true, status: 'sent' });
  } catch (error) {
    console.error('[chakhandeal-esign] send failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '착한거래 전자계약 발송에 실패했습니다. 잠시 후 다시 시도하세요.' }, 502);
  }
}
