/**
 * **접수할 때 고를 차량 목록.** 읽기만 한다. 관리자만.
 *
 * ★사장님 2026-08-26
 *   「입력하는거를 아주 쉽게 입력하게끔 차량번호 선택해서」
 *   「만약에 차량번호가 없으면 직접입력하고 할수 있게끔 / 없는 상품일수도 있으니까」
 *
 * ★★**고르면 모델명·공급사가 따라온다.** 차번만 적으면 그 둘이 비고, 비면 수수료율을 못 찾는다.
 *   ⇒ 「청구액이 안 잡힌다」가 그렇게 생긴다(실측: 지금 원장에 그런 줄이 있다).
 * ★★**목록에 없어도 접수는 된다.** 재고에 없는 차로 계약이 들어오는 일이 실제로 있다 —
 *   그때 막으면 사람이 시트로 도망간다. 고르는 건 «쉽게 하려고» 있는 것이지 관문이 아니다.
 * ⚠ 여기는 «차를 고르는» 목록이라 팔 수 있는지(출고가능)를 따지지 않는다.
 *   이미 계약이 된 차를 접수하는 자리다 — 거르면 정작 접수할 차가 안 보인다.
 */
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/** 차명 — 재고가 부르는 대로. 여기서 새로 만들지 않는다(차종마스터가 정본이다). */
const nameOf = (p: Rec) => [S(p.maker), S(p.model), S(p.sub_model), S(p.trim_name)]
  .filter(Boolean).join(' ').trim();

export async function GET(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 볼 수 있습니다.' }, { status: 403 });

  const db = firebaseAdminDatabase();
  const [prodSnap, partSnap, partV4Snap] = await Promise.all([
    db.ref('v4/products').get().catch(() => null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);

  const partners = { ...((partV4Snap?.val() || {}) as Record<string, Rec>), ...((partSnap?.val() || {}) as Record<string, Rec>) };
  const supplierOf = (code: string) => {
    const p = partners[S(code)] || {};
    return S(p.name || p.partner_name || p.company_name) || S(code);
  };

  const products = (prodSnap?.val() || {}) as Record<string, Rec>;
  const seen = new Set<string>();
  const list: { plate: string; model: string; supplier: string; status: string; label: string }[] = [];
  for (const p of Object.values(products)) {
    if (dead(p)) continue;
    const plate = S(p.car_number);
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    const model = nameOf(p);
    const supplier = supplierOf(S(p.provider_company_code || p.provider_code));
    list.push({
      plate, model, supplier,
      status: S(p.vehicle_status),
      // 고를 때 사람이 읽는 말 — 차번이 앞이다. 사람은 차번으로 찾는다.
      label: [plate, model, supplier].filter(Boolean).join(' · '),
    });
  }
  list.sort((a, b) => a.plate.localeCompare(b.plate, 'ko'));

  return NextResponse.json({ ok: true, count: list.length, list });
}
