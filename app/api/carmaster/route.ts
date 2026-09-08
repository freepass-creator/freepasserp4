import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 차종마스터 피드 — 신차/중고 견적기 «양쪽»이 «차량을 식별»하려고 땡겨가는 공통 소스.
 *   (사장님 2026-09-06 「신차·중고 견적기가 뻗어나가게 주는 쪽에서 잘 준비」)
 *
 * 신차 견적기 = market_class '신차' + newcar_priced 로 new_car_trim(실가) 연결.
 * 중고 견적기 = market_class '중고' 세대·연식으로 «중고 시세 산출»의 식별키. (시세 자체는 견적기가 계산)
 *   → 우리는 «식별(maker·model·sub_model·gen_code·연식·trims)»을 정확히 준다. market_class 로 갈래를 나눈다.
 *
 *   ?market=신차|중고     그 갈래만
 *   ?maker=현대           제조사
 *   ?model=그랜저          sub_model 부분일치
 *   ?priced=1             신차 중 실가있음(견적기 바로 씀)만
 * 응답: { count, entries:[{maker, model, sub_model, gen_code, year_start, year_end, trims, market_class, newcar_priced}] }
 */
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()·-]/g, '');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const OK = { ...CORS, 'Cache-Control': 'public, max-age=3600' };
const ERR = { ...CORS, 'Cache-Control': 'no-store' };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const market = S(url.searchParams.get('market'));   // 신차 | 중고
  const maker = S(url.searchParams.get('maker'));
  const model = S(url.searchParams.get('model'));
  const pricedOnly = S(url.searchParams.get('priced')) === '1';

  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'public/data/vehicle-master.json'), 'utf8'));
    const all: any[] = Array.isArray(raw) ? raw : raw.entries || [];
    let out = all.filter((e) => !e.retired);
    if (market) out = out.filter((e) => S(e.market_class) === market);
    if (maker) out = out.filter((e) => N(e.maker) === N(maker));
    if (model) out = out.filter((e) => N(e.sub_model).includes(N(model)) || N(e.model).includes(N(model)));
    if (pricedOnly) out = out.filter((e) => e.newcar_priced === true);
    const entries = out.map((e) => ({
      maker: S(e.maker), model: S(e.model), sub_model: S(e.sub_model), gen_code: S(e.gen_code),
      year_start: S(e.year_start), year_end: S(e.year_end),
      trims: Array.isArray(e.trims) ? e.trims : [],
      market_class: S(e.market_class), newcar_priced: e.newcar_priced === true,
    }));
    return NextResponse.json({ count: entries.length, market: market || 'all', entries }, { headers: OK });
  } catch {
    return NextResponse.json({ error: 'carmaster feed unavailable' }, { status: 503, headers: ERR });
  }
}
