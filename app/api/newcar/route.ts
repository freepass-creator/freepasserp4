import { NextResponse } from 'next/server';
import { basisOf, genesisConfig, modelKey } from '@/lib/domain/estimate/genesis-lineup';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandGenesis, fillBlankFuel } from '@/lib/domain/estimate/genesis-lineup';

// ★폴백 — Firestore(new_car_trim)가 배포 키 문제로 빈값일 때, 로컬 조합지도 config 에서 트림을 복원한다.
//   (사장님 「막힘없게」 — 견적기가 raw 트림을 못 받는 일이 없게. config 는 배포에 무조건 실리는 로컬파일.)
function localTrimsFallback(): any[] {
  const out: any[] = [];
  try {
    const gen = JSON.parse(readFileSync(join(process.cwd(), 'data/new-car/genesis-config-fs.json'), 'utf8'));
    for (const m of gen.models || []) {
      /* ⚠⚠ 예전 주석은 「제네시스 min 은 세제혜택 «전»이다」였다. **틀렸다.**
         정본이 G80-EV 를 「세제혜택 «후» 최저」라 적어 두었는데 그걸 「전」이라 이름 붙여 내보냈다
         (2026-09-09 개발센터 4-AI 관문 · Codex). 주석은 증거가 아니다 — 데이터가 말하게 한다. */
      const b = basisOf(m as Parameters<typeof basisOf>[0]);
      out.push({ maker: '제네시스', sub_model: String(m.model || ''), carType: String(m.model || ''), fuel: String(m.fuel || ''),
        trim: '기본',
        /* 「후」로 확인된 것만 `priceAfter` 로 보낸다. 「기준 미확인」은 «전으로 단정하지 않고»
           값을 `priceBefore` 에 두되 `priceBasis` 로 **모른다고 말한다**. */
        priceBefore: b.basis === '세제혜택 후' ? 0 : b.price,
        priceAfter: b.basis === '세제혜택 후' ? b.price : 0,
        priceBasis: b.basis, options: [], _fallback: true });
    }
  } catch { /* skip */ }
  try {
    const hk = JSON.parse(readFileSync(join(process.cwd(), 'data/new-car/hk-config.json'), 'utf8'));
    for (const m of hk.models || []) {
      for (const t of m.trimLadder || []) {
        /* ⚠ `hk-config` 의 trimLadder 는 **세제혜택 «후»** 값만 있다(`_meta` 가 그렇게 적어 둔다).
           그것을 `priceBefore` 에도 적으면 「전」을 지어내는 것이다 — 「모른다」로 둔다(0). */
        out.push({ maker: String(m.maker || ''), sub_model: String(m.sub_model || ''), carType: String(m.sub_model || ''),
          fuel: String(t.fuel || ''), trim: String(t.trim || ''), priceBefore: 0, priceAfter: Number(t.priceAfter || 0),
          priceBasis: '세제혜택 후', options: [], _fallback: true });
      }
    }
  } catch { /* skip */ }
  return out;
}

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

// 공개 제조사 공표가 — 견적기(netlify) 외 누구나 읽어도 무방. 오리진·메서드만 공통.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const OK_CACHE = { ...CORS, 'Cache-Control': 'public, max-age=3600' }; // 정상만 1시간 캐시
const ERR_CACHE = { ...CORS, 'Cache-Control': 'no-store' };            // ★장애는 캐시 금지(Codex)

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const MAKERS = ['현대', '기아', '제네시스', '르노'];

/**
 * 제네시스 한 줄의 «가격 기준» — 조합지도(`genesis-config-fs.json`)가 말해 준다.
 * ⚠ 못 찾으면 «비운다». 「전」이라 단정하지 않는다 — 모르는 것을 안다고 하면 손님 문서가 거짓말한다.
 */
function genesisBasis(subModel: string): string {
  try {
    const cfg = genesisConfig(process.cwd());
    const m = cfg.get(modelKey(subModel));
    return m ? basisOf(m as Parameters<typeof basisOf>[0]).basis : '';
  } catch { return ''; }
}

/**
 * ★★★제네시스 한 줄의 «전 / 후»를 조합지도와 맞대 바로잡는다.
 *
 * ⚠⚠ 2026-09-10 개발센터 4-AI 관문 · Codex 5회차 — **제조사 공식 구성기와 대조해 잡았다.**
 *   GV70 전동화: 제네시스 공식이 **세제전 79,740,000 · 세제후 75,800,000** 인데,
 *   우리 Firestore 는 `priceBefore = 75,800,000`(= «후» 값)을 싣고 있었다.
 *   그 위에 «전» 기준 옵션값을 그대로 더해 **추천 구성이 15만원 높게** 나갔다
 *   (78,750,000 vs 공식 78,600,000).
 *
 * ★조합지도는 «전» 값을 갖고 있다(`min = 79,740,000` · 코덱스 PDF 독립검증 확정).
 *   ⇒ **조합지도 값이 더 크면 그것이 「전」이고, 실린 값이 「후」다.** 두 값을 짝지어 낸다.
 * ⚠ 같거나 작으면 손대지 않는다 — 지어내지 않는다.
 */
function genesisPrices(subModel: string, before: number, after: number):
Record<string, unknown> {
  const basis = genesisBasis(subModel);
  try {
    const m = genesisConfig(process.cwd()).get(modelKey(subModel));
    const cfgPrice = m ? basisOf(m as Parameters<typeof basisOf>[0]).price : 0;
    if (cfgPrice > 0 && before > 0 && cfgPrice > before) {
      return { priceBefore: cfgPrice, priceAfter: before, priceBasis: '세제혜택 전' };
    }
  } catch { /* 못 읽으면 손대지 않는다 */ }
  return { ...(after > 0 && after < before ? {} : {}), ...(basis ? { priceBasis: basis } : {}) };
}

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
        /* ★★**기준 이름은 정상 경로에도 붙여야 한다.** 폴백에만 붙였더니 Firestore 가 살아 있을 때
           제네시스 EV(전 = 후 = 84,790,000)가 손님 문서에 **「세제혜택 전」이라 찍혔다** —
           정본은 「후」다(2026-09-10 개발센터 4-AI 관문 · Codex 발견 2).
           ⚠ 제네시스는 `priceAfter` 가 «복사»라 전=후다. 그 값의 «뜻»은 조합지도가 안다. */
        ...(S(v.maker) === '제네시스' ? genesisPrices(S(v.sub_model), Number(v.priceBefore || 0), Number(v.priceAfter || 0)) : {}),
        options: Array.isArray(v.options) ? v.options : [],
        /* ★★제조사 «실제» 색상 — 사장님 2026-09-08 「신차마스터에는 **제조사 색상 그대로** 해야지」
             「**중고마스터 색상과 신차마스터 색상은 각각 존재**해야 함」.
           ⚠ 크롤러는 처음부터 받아 넣고 있었다(`crawl-newcar-hyundai.mts` extColors·intColors) —
             **여기서 버리고 있었다.** 화면이 우리 규격색 12색(「블랙」)을 대신 보여 준 까닭이다.
             제조사 색은 「어비스 블랙 펄」처럼 이름이 따로 있고 **값이 붙는 색**도 있다. */
        ...(Array.isArray(v.extColors) && v.extColors.length ? { extColors: v.extColors } : {}),
        ...(Array.isArray(v.intColors) && v.intColors.length ? { intColors: v.intColors } : {}),
        ...(Array.isArray(v.basePrices) ? { basePrices: v.basePrices } : {}),
        ...(Array.isArray(v.rules) && v.rules.length ? { rules: v.rules } : {}),
        /* ★옵션 조합 규칙 — 배타·선행·배제. 없는 트림도 많아 «있을 때만» 싣는다. */
        ...(v.optionsMaster && Object.keys(v.optionsMaster).length ? { optionsMaster: v.optionsMaster } : {}),
        ...(Array.isArray(v.exclusiveGroups) && v.exclusiveGroups.length ? { exclusiveGroups: v.exclusiveGroups } : {}),
        ...(v.optionExcludes && Object.keys(v.optionExcludes).length ? { optionExcludes: v.optionExcludes } : {}),
        /* ★★★**빈 배열을 «버리지» 않는다.** 「빈 배열 = 고를 것이 없다」와 「칸이 없다 = 못 받았다」는
           다른 말인데, `&& .length` 가 빈 배열을 통째로 떨궈 소비자가 「못 받았다」로 읽었다.
           그러면 `optionList` 가 폴백으로 **옵션 «전부»를 연다** — 그 트림에 없는 것을 판다.
           ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다**(EMPTY_AVAIL 재현).
             나는 «만드는 쪽»(크롤러)과 «쓰는 쪽»(option-rules)을 다 막아 놓고
             **그 사이 파이프**를 안 막아, 방어가 통째로 무력화돼 있었다. */
        ...(Array.isArray(v.availableOptions) ? { availableOptions: v.availableOptions } : {}),
        ...(Array.isArray(v.impliedOptions) ? { impliedOptions: v.impliedOptions } : {}),
        /* ★트림 열쇠 — `requiresInTrim` 을 고르는 데 쓴다. 안 보내면 트림별 선행이 안 선다. */
        ...(S(v.trimKey) ? { trimKey: S(v.trimKey) } : {}),
      };
    });
    // ★Firestore 가 비면(배포 키 문제 등) 로컬 config 로 폴백 — 견적기가 빈값 안 받게
    let fallback = false;
    if (trims.length === 0) {
      let fb = localTrimsFallback();
      if (maker) fb = fb.filter((t) => N(t.maker) === N(maker));
      if (fb.length) { trims = fb; fallback = true; }
    }
    /**
     * ★★제네시스를 «엔진 × 변형»으로 편다 — 사장님 2026-09-09 「그랜저를 고르면 그랜저 것만 나오고,
     *   2.5 터보를 누르면 그에 따른 세부 트림이 나와야」.
     *   현대·기아는 크롤이 처음부터 그렇게 실어 왔다(그랜저 = 연료 4 × 트림 3 = 12줄).
     *   ⚠ **제네시스만** 모델당 한 줄로 들어와 엔진이 「가솔린」 한 덩어리였다 — 조합은 우리가
     *     `data/new-car/genesis-config.json` 에 이미 갖고 있었는데 피드가 안 쓰고 있었다.
     *   ⇒ 8줄 → 23줄. 값은 carnoon 현재가를 쓴다([[mtops-price-staleness]] — 현재가 정본).
     */
    trims = expandGenesis(trims);
    // ⚠ 빈 연료는 «돈»이 틀어진다 — 형제 줄이 한 목소리일 때만 채운다(기아 EV9 여섯 줄).
    trims = fillBlankFuel(trims);
    if (model) trims = trims.filter((t) => N(t.sub_model).includes(N(model)) || N(t.carType).includes(N(model)));
    trims.sort((a, b) => a.maker.localeCompare(b.maker) || a.sub_model.localeCompare(b.sub_model) || a.priceBefore - b.priceBefore);
    // ★updatedAt = 실제 수집일(문서 crawledAt 최대), 요청일 아님(Codex — 오래된 자료가 최신처럼 보이던 것)
    const crawledMax = snap.docs.reduce((m, d) => { const c = S(d.data().crawledAt); return c > m ? c : m; }, '');
    const meta: any = { count: trims.length, makers: MAKERS, updatedAt: crawledMax || null };
    if (fallback) meta.source = 'local-config-fallback (Firestore 빈값 — 트림사다리·base 복원. 정밀 옵션은 /api/newcar/config)';
    if (group) {
      // 모델별 묶음 — 견적기가 «모델 고르고 → 트림·옵션» 흐름으로 쓰기 좋게
      const byModel = new Map<string, any>();
      for (const t of trims) {
        const k = `${t.maker}|${t.sub_model}`;
        if (!byModel.has(k)) byModel.set(k, { maker: t.maker, sub_model: t.sub_model, fuels: new Set<string>(), trims: [] as any[] });
        const g = byModel.get(k); g.fuels.add(t.fuel); g.trims.push(t);
      }
      const models = [...byModel.values()].map((g) => ({ maker: g.maker, sub_model: g.sub_model, fuels: [...g.fuels], trimCount: g.trims.length, trims: g.trims }));
      return NextResponse.json({ ...meta, modelCount: models.length, models }, { headers: OK_CACHE });
    }
    return NextResponse.json({ ...meta, trims }, { headers: OK_CACHE });
  } catch {
    // ★오류 상세는 공개하지 않는다(Codex — detail 로 내부 메시지 누출). 캐시도 안 한다.
    return NextResponse.json({ error: 'newcar feed unavailable' }, { status: 503, headers: ERR_CACHE });
  }
}
