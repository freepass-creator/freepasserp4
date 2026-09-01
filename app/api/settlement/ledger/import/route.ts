/**
 * **시트에서 가져오기** — 직원이 정산원장 시트에 적은 것을 파이어베이스로 올린다. 관리자만.
 *
 * ★사장님 2026-08-28 「지금 직원들이 시트에 입력하고 있잖아 · 파이어베이스에 올려서
 *   처리하는걸 만들어야해」 · 「ERP 화면에 단추를 달자」.
 *
 * ```
 * GET   무엇이 올라갈지 «세어만» 본다 (아무것도 안 쓴다)
 * POST  올린다.  body { confirm: 'SHEET_TO_ERP', overwrite?: boolean }
 * ```
 * ★가르는 규칙·안전장치는 전부 `lib/server/settlement-sheet-import.ts` 한 곳에 있다 —
 *   명령줄(`npm run settlement:import`)도 같은 코드를 부른다. 두 벌이 되면 어느 쪽으로
 *   올렸느냐에 따라 원장이 달라진다.
 */
import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import { applySheetImport, planSheetImport } from '@/lib/server/settlement-sheet-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin(req: Request): Promise<{ denied: Response } | { uid: string }> {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return { denied: NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 }) };
  if (who.role !== 'admin') return { denied: NextResponse.json({ ok: false, reason: '관리자만 쓸 수 있습니다.' }, { status: 403 }) };
  return { uid: who.uid };
}

export async function GET(req: Request) {
  const who = await admin(req);
  if ('denied' in who) return who.denied;
  try {
    const plan = await planSheetImport();
    return NextResponse.json({
      ok: true,
      sheetRows: plan.sheetRows,
      erpRows: plan.erpRows,
      fresh: plan.fresh.length,
      diffs: plan.diffs.length,
      lockedDiffs: plan.diffs.filter((d) => d.locked).length,
      onlyErp: plan.onlyErp,
      unread: plan.unread,
      // 사람이 «무엇이» 올라오는지 보고 누를 수 있게 앞부분만 실어 보낸다.
      sample: plan.fresh.slice(0, 20).map((r) => ({ plate: r.plate, receivedAt: r.receivedAt, supplier: r.supplier, channel: r.channel })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error)?.message || '시트를 못 읽었습니다.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const who = await admin(req);
  if ('denied' in who) return who.denied;
  const body = await req.json().catch(() => ({})) as { confirm?: string; overwrite?: boolean };
  // 미리보기 없이 API URL만 호출해 반영되는 일을 막는다. `overwrite`는 별도 운영 승인 뒤에만
  // UI에서 열 예정이며, 기본 반영은 시트 신규 행만 ERP에 더한다.
  if (body.confirm !== 'SHEET_TO_ERP') {
    return NextResponse.json({ ok: false, reason: '시트 내용을 ERP 반영본에 올리는 작업입니다. 미리보기를 확인한 뒤 다시 확인해 주세요.' }, { status: 400 });
  }
  try {
    const out = await applySheetImport({ overwrite: body.overwrite === true });
    if (!out.ok) return NextResponse.json(out, { status: 409 });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error)?.message || '올리지 못했습니다.' }, { status: 503 });
  }
}
