import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { sheetCellLink, type OpsInventoryRow } from '@/lib/ops-status';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 관제탑 리스트 — **매물 전량을 원천과 함께** 쭉 준다.
 * 사장님 2026-09-04 「투박하지만 눈으로 이렇게 볼 수 있게끔 리스트로 쭉」.
 *
 * ★**칸을 깎아서 준다.** 원본 레코드를 통째로 주면 1.2MB 인데, 관제탑이 쓰는 열 칸만
 *   추리면 십분의 일이다. 「눈으로 보는 화면」이 제일 무거운 화면이 되면 안 된다.
 *
 * ★30초 폴링과 **별개**다. 상태 한 줄(`/api/ops/pipeline`)은 30초마다 돌지만
 *   이건 화면을 열 때 한 번만 부른다 — 전량 조회라 비싸다.
 *
 * ⚠ 관리자만. 공급사 명단과 시트 주소가 통째로 나가는 창이다.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const db = firebaseAdminDatabase();
    const [pSnap, v3, v4] = await Promise.all([
      db.ref('v4/products').get(),
      db.ref('partners').get().catch(() => null),
      db.ref('v4/partners').get().catch(() => null),
    ]);

    // 공급사 코드 → {이름, 시트주소}. 한 번만 만들어 두고 매물마다 찾아 쓴다.
    const pool = { ...((v3?.val() || {}) as Record<string, Rec>), ...((v4?.val() || {}) as Record<string, Rec>) };
    const byCode = new Map<string, { name: string; sheetUrl: string }>();
    for (const [key, x] of Object.entries(pool)) {
      if (!x || typeof x !== 'object') continue;
      const name = S(x.partner_name) || S(x.company_name) || S(x.name);
      const sheetUrl = S(x.sheet_url);
      for (const code of [key, S(x.partner_code), S(x.company_code)]) {
        if (code) byCode.set(code, { name, sheetUrl });
      }
    }

    const rows: OpsInventoryRow[] = [];
    for (const [key, raw] of Object.entries((pSnap.val() || {}) as Record<string, Rec>)) {
      if (!raw || typeof raw !== 'object' || dead(raw)) continue;
      const p = raw as Rec;
      const code = S(p.provider_company_code) || S(p.partner_code) || S(p.source_schema);
      const sup = byCode.get(code);
      rows.push({
        plate: S(p.car_number) || S(p.product_code) || key,
        name: vehicleNameOf({ kind: 'product', product: p as EntityRecord }, { tier: 'full', fallback: 'none' }),
        supplierCode: code,
        supplierName: S(p.provider_name) || sup?.name || code || '(공급사 없음)',
        tab: S(p.sheet_source_tab),
        row: S(p.sheet_source_row),
        updatedAt: Number(p.updatedAt) || null,
        status: S(p.vehicle_status),
        blocked: S(p.sheet_block_reason),
        cellLink: sheetCellLink(sup?.sheetUrl, p.sheet_source_gid, p.sheet_source_row),
      });
    }

    // 공급사로 묶어 보이게 — 「어디서 몇 대 왔나」가 스크롤만으로 읽힌다.
    // 같은 공급사 안에서는 원본 시트의 «행 순서»를 따른다(시트를 옆에 놓고 대조하기 좋게).
    rows.sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName, 'ko')
      || (Number(a.row) || 1e9) - (Number(b.row) || 1e9)
      || a.plate.localeCompare(b.plate, 'ko'));

    return NextResponse.json({ count: rows.length, rows });
  } catch {
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 503 });
  }
}
