import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 신차 조합지도 피드 — 신차 견적기가 「어떤 옵션·어디까지 조합·최소~최대」를 확정하는 원천.
 *   (사장님 2026-09-06 「옵션이 있고 어디까지 조합되는지 + 최소~최대 두 끝」 · 「주는 쪽에서 잘 준비」)
 *
 * data/new-car/*-config.json 은 «주는 쪽 정본»이지만 리포지토리 경로라 외부 견적기가 못 땡긴다.
 * 이 API 가 그걸 «인증 없이·CORS 열어» 낸다 — /api/newcar(트림·가격), /api/carmaster(식별)와 같은 규격.
 *   - 제네시스 = «기본모델+필수/선택 옵션» → exclusiveGroups(엔진·구동·인승·외장·휠·내장 등)
 *   - 현대·기아 = «트림계층» → trimLadder(연료×트림, 각 완성가) + optionSuperset
 *   둘 다 minMax(min=기본/최저트림 · maxCandidate=상한후보, 상호배제·패키지포함 미검증은 각 항목 note 참조).
 *
 *   ?maker=제네시스|현대|기아     그 제조사만
 *   ?model=gv80|그랜저            model/sub_model 부분일치
 * 응답: { updatedAt, genesis:{models[]}, hyundaiKia:{models[]} } (필터 적용 시 해당만)
 */
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s()·-]/g, '');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const OK = { ...CORS, 'Cache-Control': 'public, max-age=3600' };
const ERR = { ...CORS, 'Cache-Control': 'no-store' };

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

function load(name: string): any {
  return JSON.parse(readFileSync(join(process.cwd(), 'data/new-car', name), 'utf8'));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const maker = S(url.searchParams.get('maker'));
  const model = S(url.searchParams.get('model'));

  try {
    // 제네시스 현재가 정본 = genesis-config-fs.json (공식 PDF·new_car_trim·audit통과).
    // genesis-config.json 은 배타그룹 상세 «구조»(단 mtops 구가) — detailStructure 로만 참고.
    let genesis: any;
    try { genesis = load('genesis-config-fs.json'); genesis._current = true; }
    catch { genesis = load('genesis-config.json'); }
    const hk = load('hk-config.json');
    let minor: any = null;
    try { minor = load('domestic-minor.json'); } catch { /* optional */ }

    // 제조사 필터: 제네시스는 genesis-config, 현대·기아는 hk-config, 그 밖 국산은 domestic-minor(간이)
    const wantGenesis = !maker || N(maker) === N('제네시스') || N(maker) === 'genesis';
    const wantHK = !maker || ['현대', '기아', 'hyundai', 'kia'].some((x) => N(maker) === N(x));
    const wantMinor = !maker || ['르노', '르노코리아', 'renault', 'kg모빌리티', 'kgm', '쌍용', '쉐보레', 'chevrolet'].some((x) => N(maker) === N(x));

    let gModels = wantGenesis ? (genesis.models || []) : [];
    let hModels = wantHK ? (hk.models || []) : [];
    let mModels = wantMinor ? (minor?.models || []) : [];
    if (maker && wantHK && (N(maker) === N('현대') || N(maker) === 'hyundai')) hModels = hModels.filter((m: any) => S(m.maker) === '현대');
    if (maker && wantHK && (N(maker) === N('기아') || N(maker) === 'kia')) hModels = hModels.filter((m: any) => S(m.maker) === '기아');
    if (maker && wantMinor) mModels = mModels.filter((m: any) => N(m.maker) === N(maker) || N(m.maker).includes(N(maker)));
    if (model) {
      gModels = gModels.filter((m: any) => N(m.model).includes(N(model)) || N(m.label).includes(N(model)));
      hModels = hModels.filter((m: any) => N(m.sub_model).includes(N(model)));
      mModels = mModels.filter((m: any) => N(m.model).includes(N(model)));
    }

    const updatedAt = genesis?._meta?.updatedAt || hk?._meta?.updatedAt || null;
    const body: any = { updatedAt, structureNote: '제네시스=기본모델+옵션(exclusiveGroups·정밀) · 현대기아=트림계층(trimLadder·min확정,옵션카탈로그) · 르노/KGM/쉐보레=간이(범위·트림상세 후속).' };
    if (wantGenesis) body.genesis = { source: genesis?._meta?.source, modelCount: gModels.length, models: gModels };
    if (wantHK) body.hyundaiKia = { source: hk?._meta?.source, modelCount: hModels.length, models: hModels };
    if (wantMinor && mModels.length) body.domesticMinor = { source: minor?._meta?.source, note: minor?._meta?.note, modelCount: mModels.length, models: mModels };
    return NextResponse.json(body, { headers: OK });
  } catch {
    return NextResponse.json({ error: 'newcar config feed unavailable' }, { status: 503, headers: ERR });
  }
}
