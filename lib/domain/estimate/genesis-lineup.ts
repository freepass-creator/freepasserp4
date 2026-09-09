/**
 * 제네시스 «라인업 펴기» — 모델 한 줄을 **엔진 × 변형**으로 편다.
 *
 * ★★사장님 2026-09-09 「신차 «내 차 만들기»를 보고 그거에 따른 하위 «배타그룹»처럼,
 *   **그랜저를 고르면 그랜저 것만** 나와야 되고, 거기에 **2.5 터보를 누르면 그에 따른 세부 트림**이
 *   나와야 이런 식으로 하면 되잖아」 · 「우리 쪽 정보가 더 좋은데 **조합도 다 만들어 놨잖아**」
 *
 * 맞는 말씀이다. 현대는 «이미» 그렇게 돈다 —
 *   더 뉴 그랜저 → 가솔린 2.5 / LPi 3.5 / 가솔린 3.5 / 하이브리드 1.6T → 프리미엄 / 익스클루시브 / 캘리그래피.
 * ⚠⚠ **제네시스만** 신차마스터에 «모델당 한 줄»로 들어와 있다(트림 빈칸 · 연료 「가솔린」 한 덩어리).
 *   그래서 G80 을 골라도 엔진이 하나로 뭉개져 「가솔린」만 뜨고 트림 칸은 비어 있었다.
 *   2026-09-08 에 나는 그 빈칸을 「기본」이라 «적어» 덮었다 — 데이터를 찾지 않고 화면을 덮은 것이다.
 *
 * ⇒ 조합은 이미 우리에게 있다: `data/new-car/genesis-config.json`
 *     `currentPricing.engines` — carnoon 현재가 · 엔진 × 구동/에디션별 «실제 가격»
 *     `exclusiveGroups[group=엔진]` — BTO 배타그룹(엔진 추가금) · 코덱스 교차검증분
 *   이 파일을 읽어 **엔진 = 파워트레인 · 구동/에디션 = 트림**으로 편다.
 *
 * ⚠ **엔진 배타그룹 «말고»는 안 쓴다.** 같은 파일의 「휠 & 타이어」·「내장 디자인」 배타그룹은
 *   PDF 좌표 파싱이 이름을 잘라 먹어 「인」·「드 디자인」·「(기본)」 처럼 깨져 있고,
 *   G80 그룹에 G70 엔진(「가솔린 3.3 터보」)이 섞여 들어와 있다(2026-09-09 실측).
 *   깨진 이름을 옵션으로 내보내면 **견적 금액이 틀린다.** 엔진만 쓴다 — 엔진은 두 소스가 서로 맞는다
 *   (BTO 배타그룹 6,070+660=6,730만 ↔ carnoon 3.5T 6,730만).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LineupRow = { fuel: string; trim: string; price: number };

type GenModel = {
  model?: string;
  isEV?: boolean;
  basePrice?: number;
  exclusiveGroups?: { group?: string; choices?: { label?: string; addWon?: number }[] }[];
  currentPricing?: { engines?: Record<string, number | Record<string, number>> };
};

const S = (v: unknown) => String(v ?? '').trim();
/** 가격표 키가 그대로 트림 이름이 된다 — 꼬리에 붙은 콜론·따옴표를 떼어 낸다(「스탠다드 2WD 19":」). */
const label = (v: unknown) => S(v).replace(/[:\s"']+$/, '').trim();
/** 「G80-EV」·「GV80 Coupe」가 「G80」·「GV80」에 잘못 붙지 않게 — 글자·숫자만 남겨 «통째로» 맞춘다. */
export const modelKey = (s: unknown) => S(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** 이 이름이 «엔진»인가 — 연료말이 있거나 배기량(2.5·3.5)이 박혀 있으면 엔진이다. */
const ENGINE_WORD = /가솔린|디젤|전기|하이브리드|모터|LPG|LPi|수소/i;
const DISPLACEMENT = /(?:^|[^0-9.])[1-6]\.[0-9]/;
export const looksLikeEngine = (s: string) => ENGINE_WORD.test(s) || DISPLACEMENT.test(s);

/**
 * 「2.5T」처럼 «짧게» 적힌 엔진을 그 모델의 «온전한» 엔진 이름에 붙인다.
 * ⚠ 안 붙이면 파워트레인 칸에 「가솔린 2.5T」와 「2.5T」가 **두 줄로** 선다 — 같은 엔진인데.
 *   G80 의 「BLACK(AWD)」 아래 값이 `{2.5T, 3.5T}` 로 오기 때문에 실제로 그렇게 됐다.
 */
function canonEngine(label: string, engines: string[]): string {
  const disp = /([1-6]\.[0-9])/.exec(label)?.[1];
  if (disp) { const hit = engines.find((e) => e.includes(disp)); if (hit) return hit; }
  // 「LWB 48V(AWD)」·「48V LWB BLACK(AWD)」은 48V 엔진의 변형이다 — 배기량이 안 적혀 있어 토큰으로 잡는다.
  if (/48V/i.test(label)) { const hit = engines.find((e) => /48V/i.test(e)); if (hit) return hit; }
  return '';
}

/** 한 모델을 엔진 × 변형으로 편다. 못 펴면 `null`(원본 한 줄을 그대로 둔다). */
export function lineupOf(m: GenModel, rowFuel: string): LineupRow[] | null {
  const evFuel = m.isEV ? '전기' : '';
  const engines = m.currentPricing?.engines;
  if (engines && Object.keys(engines).length) {
    const engineKeys = Object.keys(engines).filter(looksLikeEngine);
    // 엔진 이름이 하나도 없으면(GV60 처럼 「스탠다드 2WD 19"」 뿐) 연료는 그 차의 연료를 그대로 쓴다.
    const base = evFuel || engineKeys[0] || rowFuel;
    const out: LineupRow[] = [];
    for (const [k, v] of Object.entries(engines)) {
      const kEngine = looksLikeEngine(k);
      if (typeof v === 'number') {
        // 값이 숫자 하나 = 변형이 없는 줄. 이름이 엔진이면 엔진, 아니면 «에디션»으로 본다.
        if (kEngine) out.push({ fuel: evFuel || k, trim: '기본', price: v });
        else out.push({ fuel: evFuel || canonEngine(k, engineKeys) || base, trim: label(k), price: v });
        continue;
      }
      for (const [sk, sv] of Object.entries(v as Record<string, number>)) {
        if (kEngine) out.push({ fuel: evFuel || k, trim: label(sk), price: sv });
        else if (looksLikeEngine(sk)) out.push({ fuel: evFuel || canonEngine(sk, engineKeys) || sk, trim: label(k), price: sv });
        else out.push({ fuel: evFuel || base, trim: label(`${k} ${sk}`), price: sv });
      }
    }
    return out.filter((r) => r.price > 0);
  }
  // carnoon 현재가가 없는 모델(GV80·GV80 쿠페)은 BTO 엔진 배타그룹 + 기본가로 편다.
  const eg = (m.exclusiveGroups ?? []).find((x) => /엔진/.test(S(x.group)));
  const base = Number(m.basePrice) || 0;
  if (eg?.choices?.length && base > 0) {
    return eg.choices
      .map((c) => ({ fuel: evFuel || S(c.label), trim: '기본', price: base + (Number(c.addWon) || 0) }))
      .filter((r) => r.fuel && r.price > 0);
  }
  return null;
}

let cache: Map<string, GenModel> | null = null;
export function genesisConfig(cwd = process.cwd()): Map<string, GenModel> {
  if (cache) return cache;
  const out = new Map<string, GenModel>();
  try {
    const j = JSON.parse(readFileSync(join(cwd, 'data/new-car/genesis-config.json'), 'utf8'));
    for (const m of j.models ?? []) out.set(modelKey(m.model), m);
  } catch { /* 파일이 없으면 안 편다 — 원본 그대로 나간다 */ }
  cache = out;
  return out;
}

/**
 * 신차마스터 줄들 중 «제네시스»를 엔진 × 변형으로 편다. 나머지 제조사는 손대지 않는다.
 * ⚠ 못 펴는 모델(G80-EV·GV70-EV — 전기 단일이라 조합이 없다)은 **원본 한 줄을 그대로** 둔다.
 */
export function expandGenesis<T extends { maker?: string; sub_model?: string; fuel?: string; priceBefore?: number; priceAfter?: number }>(
  trims: T[], cwd = process.cwd(),
): T[] {
  const cfg = genesisConfig(cwd);
  if (!cfg.size) return trims;
  const out: T[] = [];
  for (const t of trims) {
    if (S(t.maker) !== '제네시스') { out.push(t); continue; }
    const m = cfg.get(modelKey(t.sub_model));
    const rows = m ? lineupOf(m, S(t.fuel)) : null;
    if (!rows || rows.length < 2) { out.push(t); continue; }
    for (const r of rows) {
      out.push({ ...t, fuel: r.fuel, trim: r.trim, priceBefore: r.price, priceAfter: r.price, lineupSource: 'genesis-config' } as T);
    }
  }
  return out;
}

/**
 * 빈 연료를 «같은 모델의 형제 줄»에서 채운다.
 *
 * ⚠⚠ 이건 «보기»가 아니라 **돈** 문제다. 연료가 비면 `engineFuel('')` 이 «가솔린»으로 떨어져
 *   전기차 보조금(600만) · 취득세 감면(140만) · 공채 면제가 **하나도 안 걸리고**,
 *   자동차세도 배기량이 없어 0 이 된다. 기아 EV9 열 줄 중 «여섯 줄»이 연료가 비어 있다(2026-09-09 실측).
 *   그 여섯 줄은 여태 화면에서 안 보여 아무도 안 밟았는데, 이제 고를 수 있게 되어 밟힌다.
 *
 * ★지어내지 않는다 — **그 모델의 다른 줄이 이미 말하고 있을 때만** 채운다.
 *   EV9 는 나머지 네 줄이 전부 「EV」라 빈칸도 EV 다. 르노 필랑트는 세 줄이 다 비어 있어 **안 채운다**
 *   (그건 「모른다」가 맞다 — 화면이 「미상」이라 적는다).
 */
export function fillBlankFuel<T extends { maker?: string; sub_model?: string; fuel?: string }>(trims: T[]): T[] {
  const known = new Map<string, Set<string>>();
  for (const t of trims) {
    const f = S(t.fuel);
    if (!f) continue;
    const k = `${S(t.maker)}|${S(t.sub_model)}`;
    if (!known.has(k)) known.set(k, new Set());
    known.get(k)!.add(f);
  }
  return trims.map((t) => {
    if (S(t.fuel)) return t;
    const set = known.get(`${S(t.maker)}|${S(t.sub_model)}`);
    // 형제들이 «한 목소리»일 때만 따른다. 둘 이상으로 갈리면 어느 쪽인지 모른다 — 비워 둔다.
    if (!set || set.size !== 1) return t;
    return { ...t, fuel: [...set][0], fuelFilledFromSibling: true } as T;
  });
}
