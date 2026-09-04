import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';

/**
 * 정밀타격 — 차 한 대가 **어디서 왔는지** 짚고, **그 줄로 바로 가는 링크**까지 준다.
 *
 * ★왜 이게 관제탑의 핵심인가 (사장님 2026-09-04 「관제탑에서 불러올 곳을 정밀타격하는 거야」)
 *   「⑥ 상품리스트 실패」만 보여 주면 아무도 못 고친다. 고치려면 **어느 시트 어느 탭 몇 번째 줄**
 *   인지 알아야 하고, 거기까지 가는 데 클릭이 열 번 필요하면 안 본다.
 *   출처 필드는 이미 레코드에 다 있었다 — 보여 주는 곳이 없었을 뿐이다(2026-09-04 실측).
 *
 *     source            유입 경로 종류 ('sheet' · 'ironrentcar_web' …)
 *     source_schema     공급사 코드
 *     sheet_source_tab  원본 탭 이름
 *     sheet_source_gid  원본 탭 gid      ┐ 공급사 sheet_url 과 합치면
 *     sheet_source_row  원본 행 번호      ┘ **그 셀로 바로 가는 주소**가 된다
 *     sheet_sync_run_id 그 값을 넣은 동기 회차
 *     updatedAt         마지막으로 닿은 시각
 *
 * ⚠ 관리자만. 공급사 시트 주소가 나가는 창이다.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
/** 차번 대조는 공백·하이픈을 걷고 본다 — 시트마다 「135허5711」·「135 허 5711」이 섞여 있다. */
const plateKey = (v: unknown) => S(v).replace(/[\s-]/g, '');

/** 공급사 시트 URL + 탭 gid + 행 번호 → **그 셀**로 가는 주소. 하나라도 없으면 만들지 않는다. */
function cellLink(sheetUrl: string, gid: string, row: string): string {
  const base = S(sheetUrl);
  if (!base || !/docs\.google\.com/.test(base)) return '';
  const clean = base.split('#')[0].split('?')[0];
  const g = S(gid);
  const r = S(row);
  if (!g) return clean;
  return r ? `${clean}#gid=${g}&range=A${r}` : `${clean}#gid=${g}`;
}

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = plateKey(new URL(request.url).searchParams.get('q'));
  if (!q) return NextResponse.json({ error: '차번을 넣어 주세요.' }, { status: 400 });

  try {
    const db = firebaseAdminDatabase();
    const snap = await db.ref('v4/products').get();
    const all = (snap.val() || {}) as Record<string, Rec>;

    // 차번 완전일치 우선, 없으면 «끝자리 포함»으로 넓힌다(사람은 뒤 네 자리로 부른다).
    let hit: { key: string; p: Rec } | null = null;
    const loose: { key: string; p: Rec }[] = [];
    for (const [key, p] of Object.entries(all)) {
      if (!p || typeof p !== 'object') continue;
      const plate = plateKey((p as Rec).car_number);
      if (!plate) continue;
      if (plate === q) { hit = { key, p }; break; }
      if (plate.includes(q)) loose.push({ key, p });
    }
    if (!hit && loose.length === 1) hit = loose[0];

    if (!hit) {
      return NextResponse.json({
        found: false,
        candidates: loose.slice(0, 8).map(({ p }) => S(p.car_number)),
      });
    }

    const p = hit.p;
    const supplierCode = S(p.provider_company_code) || S(p.partner_code) || S(p.source_schema);

    // 공급사 시트 주소 — 파트너에서 가져온다. 없으면 링크 없이 사실만 준다.
    let sheetUrl = '';
    let supplierName = S(p.provider_name);
    if (supplierCode) {
      const [v3, v4] = await Promise.all([
        db.ref('partners').get().catch(() => null),
        db.ref('v4/partners').get().catch(() => null),
      ]);
      const pool = { ...((v3?.val() || {}) as Record<string, Rec>), ...((v4?.val() || {}) as Record<string, Rec>) };
      const found = Object.entries(pool).find(([k, x]) => x && (
        k === supplierCode || S((x as Rec).partner_code) === supplierCode || S((x as Rec).company_code) === supplierCode
      ))?.[1] as Rec | undefined;
      sheetUrl = S(found?.sheet_url);
      supplierName = supplierName || S(found?.partner_name) || S(found?.company_name) || S(found?.name);
    }

    const gid = S(p.sheet_source_gid);
    const row = S(p.sheet_source_row);

    return NextResponse.json({
      found: true,
      plate: S(p.car_number),
      productCode: S(p.product_code) || hit.key,
      supplier: { code: supplierCode, name: supplierName },
      origin: {
        source: S(p.source) || (gid || row ? 'sheet' : ''),
        tab: S(p.sheet_source_tab),
        gid,
        row,
        url: S(p.source_url),
      },
      /** ★여기가 정밀타격 — 누르면 그 시트 그 줄로 바로 간다. */
      cellLink: cellLink(sheetUrl, gid, row),
      lastSync: {
        runId: S(p.sheet_sync_run_id),
        updatedAt: Number(p.updatedAt) || null,
        updatedBy: S(p.updatedBy),
      },
      /** 시트가 이 차를 막고 있나 — 「왜 목록에 안 뜨나」의 답이 대개 여기다. */
      block: {
        reason: S(p.sheet_block_reason),
        at: S(p.sheet_blocked_at),
        statusOwner: S(p.sheet_status_owner),
      },
      status: S(p.vehicle_status),
    });
  } catch {
    return NextResponse.json({ error: '추적하지 못했습니다.' }, { status: 503 });
  }
}
