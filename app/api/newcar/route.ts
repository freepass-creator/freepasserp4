import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 신차마스터 피드 — 신차 견적기(welrix, 외부 임베드)가 «차량 가격을 확정»하려고 땡겨 가는 원천.
 *   (사장님 2026-09-05 「신차 견적기에서 요 데이터를 땡겨 가서 차량 가격을 확정」)
 *
 * 제조사 「내 차 만들기」에서 크롤한 new_car_trim(현대·기아·제네시스·르노)을 «인증 없이» 낸다.
 *   가격·옵션은 공개정보(제조사 공표가)라 화이트리스트가 필요 없다. 견적기는 netlify 별도 오리진이라
 *   CORS 를 열어 준다(GET·읽기 전용).
 *
 *   ?maker=현대           그 제조사만(현대·기아·제네시스·르노)
 *   ?model=그랜저          sub_model 부분일치(현대 「디 올 뉴 아반떼」 · 기아 「sorento」 슬러그)
 *   ?group=model          모델별로 묶어서(견적기 「모델 고르고 → 트림·옵션」 흐름용)
 * ※ new_car_trim 컬렉션 자체가 «제조사 크롤 실가»만 담으므로 별도 priced 필터 불필요.
 * 응답: { count, makers, updatedAt, trims:[{maker, sub_model, carType, fuel, trim, priceBefore, priceAfter, options[], basePrices?, rules?}] }
 *   group=model 이면 { modelCount, models:[{maker, sub_model, fuels[], trimCount, trims[]}] }
 */
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()·-]/g, '');

const CORS = {
  'Access-Control-Allow-Origin': '*', // 공개 제조사 공표가 — 견적기(netlify) 외 누구나 읽어도 무방
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=3600', // 하루 1회 갱신되는 데이터 — 1시간 캐시
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const MAKERS = ['현대', '기아', '제네시스', '르노'];

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const maker = S(url.searchParams.get('maker'));
  const model = S(url.searchParams.get('model'));
  const group = S(url.searchParams.get('group')) === 'model'; // 모델별로 묶어서

  try {
    const fs = getFirestore(firebaseAdminApp());
    let q: FirebaseFirestore.Query = fs.collection('new_car_trim');
    if (maker) q = q.where('maker', '==', maker);
    const snap = await q.get();
    let trims = snap.docs.map((d) => {
      const v = d.data();
      return {
        maker: S(v.maker), sub_model: S(v.sub_model), carType: S(v.carType), fuel: S(v.fuel),
        trim: S(v.trim), priceBefore: Number(v.priceBefore || 0), priceAfter: Number(v.priceAfter || 0),
        options: Array.isArray(v.options) ? v.options : [],
        ...(Array.isArray(v.basePrices) ? { basePrices: v.basePrices } : {}),
        ...(Array.isArray(v.rules) && v.rules.length ? { rules: v.rules } : {}),
      };
    });
    if (model) trims = trims.filter((t) => N(t.sub_model).includes(N(model)) || N(t.carType).includes(N(model)));
    trims.sort((a, b) => a.maker.localeCompare(b.maker) || a.sub_model.localeCompare(b.sub_model) || a.priceBefore - b.priceBefore);
    const meta = { count: trims.length, makers: MAKERS, updatedAt: new Date().toISOString().slice(0, 10) };
    if (group) {
      // 모델별 묶음 — 견적기가 «모델 고르고 → 트림·옵션» 흐름으로 쓰기 좋게
      const byModel = new Map<string, any>();
      for (const t of trims) {
        const k = `${t.maker}|${t.sub_model}`;
        if (!byModel.has(k)) byModel.set(k, { maker: t.maker, sub_model: t.sub_model, fuels: new Set<string>(), trims: [] as any[] });
        const g = byModel.get(k); g.fuels.add(t.fuel); g.trims.push(t);
      }
      const models = [...byModel.values()].map((g) => ({ maker: g.maker, sub_model: g.sub_model, fuels: [...g.fuels], trimCount: g.trims.length, trims: g.trims }));
      return NextResponse.json({ ...meta, modelCount: models.length, models }, { headers: CORS });
    }
    return NextResponse.json({ ...meta, trims }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: 'newcar feed unavailable', detail: S((e as Error)?.message) }, { status: 503, headers: CORS });
  }
}
