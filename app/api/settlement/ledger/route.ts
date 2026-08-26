/**
 * **정산원장 — 관리자용.** GET 읽고 · POST 접수 · PATCH 고친다.
 *
 * ★사장님 2026-08-26 「시트를 연동하는게 아니라 우리가 erp에서 직접 관리하는거로」.
 *   그래서 이 라우트에는 **시트 코드가 한 줄도 없다.** 저장소는 `lib/server/settlement-store.ts`
 *   하나이고, 시트→ERP 이관은 그 파일만 갈아 끼우면 된다.
 *
 * 이 라우트가 하는 일은 셋뿐이다 —
 * ```
 * ① 관리자인지 확인한다      서버가 판정한다. 화면 분기는 자물쇠가 아니다
 * ② 저장소에 시킨다          읽기 · 접수 · 수정
 * ③ 규칙을 얹어 내보낸다      자리·청구월·수수료·청구상태 (전부 lib/domain 순수 함수)
 * ```
 * ★관리자만 본다. **고객연락처와 금액이 다 들어 있다** — 역할용은 `/api/settlement/mine` 이다.
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { billingMonth, bucketOf, moneyOf, nextInstalment, stageOf } from '@/lib/domain/settlement-stage';
import { billStateOf, issuedKey } from '@/lib/domain/settlement-billstate';
import { iso, ledgerUrl } from '@/lib/server/settlement-ledger-read';
import { appendIntake, listRows, patchRow, storeError, type IntakeInput } from '@/lib/server/settlement-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * **관리자인지 서버가 확인한다.**
 * ⚠ 이게 없던 동안 이 라우트는 로그인조차 없이 열려 있었다 — 금액과 고객연락처가 통째로 나갔다.
 *   화면을 관리자에게만 보여 주는 것과 API 를 관리자에게만 여는 것은 다르다. URL 은 누구나 친다.
 */
async function admin(req: Request): Promise<Response | null> {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 볼 수 있습니다.' }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;

  const read = await listRows();
  if (!read) return NextResponse.json({ ok: false, reason: storeError() || '원장을 못 읽었습니다.' }, { status: 503 });

  /**
   * ★**「청구완료」는 «청구서가 나갔나»로 판정한다.** 날짜가 지났다고 나간 게 아니다 —
   *   날짜로 치면 「청구한 줄 알았는데 아무도 안 보낸」 건이 조용히 완료로 넘어간다.
   */
  const snap = await getDatabase(firebaseAdminApp()).ref('v4/settlement_invoices').get().catch(() => null);
  const invoices = (snap?.val() || {}) as Record<string, { month?: string; axis?: string; party?: string }>;
  const issued = new Set(
    Object.values(invoices)
      .filter((v) => S(v?.axis) === '공급사')
      .map((v) => issuedKey(S(v?.month), S(v?.party))),
  );

  const rows = read.map(({ row, extra }) => ({
    ...row,
    ...extra,
    receivedAt: iso(row.receivedAt), deliveredAt: iso(row.deliveredAt), clawbackAt: iso(row.clawbackAt),
    stage: stageOf(row), bucket: bucketOf(row), billingMonth: billingMonth(row), money: moneyOf(row),
    nextRound: iso(nextInstalment(row)),
    billState: billStateOf(row, issued),
  }));

  return NextResponse.json({
    ok: true, readAt: new Date().toISOString(), ledgerUrl: ledgerUrl(), count: rows.length, rows,
  });
}

/** **계약 접수** — 저장소에 한 줄을 더한다. 접수일은 오늘로 박힌다. */
export async function POST(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const form = await req.json().catch(() => ({})) as IntakeInput;
  const out = await appendIntake(form);
  if (!out.ok) return NextResponse.json({ ok: false, reason: out.reason }, { status: out.status });
  return NextResponse.json({ ok: true, plate: out.plate, receivedAt: out.receivedAt });
}

/**
 * **한 줄을 고친다.** 고칠 수 있는 칸은 저장소의 흰 목록(`EDITABLE_FIELDS`)뿐이다.
 * ⚠ 금액·요율은 그 목록에 없다 — 화면에서 손대면 그날로 정본이 둘이 된다.
 */
export async function PATCH(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({})) as { plate?: string; receivedAt?: string; patch?: Record<string, string> };
  const out = await patchRow({ plate: S(body.plate), receivedAt: S(body.receivedAt) }, body.patch || {});
  if (!out.ok) return NextResponse.json({ ok: false, reason: out.reason }, { status: out.status });
  return NextResponse.json({ ok: true });
}
