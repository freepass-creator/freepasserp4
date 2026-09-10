/**
 * 제네시스 «라인업 펴기» — 모델 한 줄을 **엔진 × 구동**으로 편다.
 *
 * ★★사장님 2026-09-09 「**여기도 SSOT 에서 제대로 갖고와야 한다**」
 *
 * ⚠⚠ 첫 판(2026-09-09 오전)은 `data/new-car/genesis-config.json`(mtops)을 읽었다. **그 파일은 폐기다** —
 *   `docs/신차마스터-피드.md` 가 「옛 mtops(genesis-config.json)는 **구가·폐기**」라고 못 박아 두었고,
 *   `app/api/newcar/config/route.ts` 도 「제네시스 현재가 **정본 = genesis-config-fs.json**」이라 적어 두었다.
 *   내가 그 두 곳을 안 읽고 폐기 파일을 썼다.
 *   ⇒ **정본 하나만 읽는다: `data/new-car/genesis-config-fs.json`**
 *     (공식 PDF 해독 · 모델마다 코덱스 독립검증 확정 `VERDICT-codex-*`).
 *
 * ★왜 펴야 하나 — 신차마스터(`new_car_trim`)에 제네시스는 «모델당 한 줄»로 들어와 있다(트림 빈칸 ·
 *   연료 「가솔린」 한 덩어리). 그래서 G80 을 골라도 엔진이 하나로 뭉개졌다.
 *   현대·기아는 크롤이 처음부터 연료×트림으로 실어서 멀쩡했다 — 헤맨 곳은 제네시스 하나였다.
 *
 * ★무엇을 무엇에 대응시키나
 *     파워트레인 = 배타그룹 「엔진」   ·   트림 = 배타그룹 「구동(타입)」
 *   값 = `base` + 엔진 add + 구동 add. 라인업(표준·블랙)이 따로 있으면 그 안의 base·그룹을 쓴다(GV80).
 *
 * ⚠ **엔진처럼 안 생긴 선택지는 버린다.** 정본도 PDF 좌표 파싱이라 「엔진」 그룹에 옵션 문구가 섞인
 *   모델이 있다 — GV70 은 「브레이크 및 후륜 스타일링 커버 기본 적용 +550만」이 엔진 자리에 들어와 있고
 *   (2026-09-09 실측), G70 은 「스포츠」 그룹 안에 엔진이 섞여 있다.
 *   ⇒ 그런 모델은 **엔진을 안 편다**(구동만 편다). 지어내는 것보다 «못 편다»가 낫다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonFuel } from '@/lib/domain/estimate/newcar-normalize';

/**
 * ★★★**제네시스 `base` 의 «기준»은 모델마다 다르다.** 정본이 그렇게 적혀 있다.
 *   `genesis-config-fs.json` 실측(2026-09-09):
 *     G80-EV  minConfig 「**세제혜택 후** 최저(…개소세5%)」 · variants{「세제전」: 89,080,000}
 *     GV60    variants{「스탠2WD **세제후**」: 64,900,000, 「스탠AWD **세제전**」: 72,080,000}
 *     GV70-EV variants 없음 — **기준 미확인**
 *     내연(G70·G80·G90·GV70·GV80) — 「세제전」 표시 없음. 피드 정본의 「모든 가격 = 개소세 5%」를 따른다.
 *
 * ⚠⚠ 2026-09-09 개발센터 4-AI 관문에서 **Codex 가 잡았다.** 피드 폴백이 이 `base` 를
 *   무조건 `priceBefore` 에 넣고 **「세제혜택 전」이라고 이름 붙이고** 있었다 —
 *   G80-EV 는 84,790,000(후)을 「전」이라 말했다. **금액의 기준 자체를 잘못 설명한 것**이다.
 *   코드 주석까지 「제네시스 min 은 세제혜택 전이다」라고 반대로 적혀 있었다. 주석은 증거가 아니다.
 *
 * ⇒ 「전」이 있으면 그것을 쓰고, 없으면 **「후」라고 말한다.** 모르면 「미확인」이라고 말한다.
 *   지어내지 않는다.
 */
export type GenesisBasis = { price: number; basis: '세제혜택 전' | '세제혜택 후' | '기준 미확인' };

export function basisOf(m: { model?: string; fuel?: string; base?: number; minMax?: { min?: number; minConfig?: string; variants?: Record<string, unknown> } }): GenesisBasis {
  const mm = m.minMax ?? {};
  const vs = (mm.variants ?? {}) as Record<string, unknown>;
  const before = Object.entries(vs).find(([k]) => /세제전/.test(k));
  if (before && Number(before[1]) > 0) return { price: Number(before[1]), basis: '세제혜택 전' };
  const price = Number(mm.min ?? m.base ?? 0) || 0;
  const said = `${S(mm.minConfig)} ${Object.keys(vs).join(' ')}`;
  if (/세제후|세제혜택\s*후/.test(said)) return { price, basis: '세제혜택 후' };
  /* ★표시가 없으면 피드 정본의 규칙을 따른다 — 「모든 가격 = 개별소비세 5% 기준」.
     ⚠ 다만 **전기 모델은 예외**다. 형제 EV(G80-EV·GV60)가 「세제후」로 적혀 있어,
       표시가 없는 EV(GV70-EV)를 「전」이라 단정하면 **또 지어내는 것**이다. 「미확인」으로 둔다. */
  const isEv = /-EV$|일렉트리파이드|electrified/i.test(S(m.model)) || /전기/.test(S(m.fuel));
  return { price, basis: isEv ? '기준 미확인' : '세제혜택 전' };
}

export type LineupRow = {
  fuel: string; trim: string; price: number;
  /** ★그 구성에 «이미 들어 있다»고 정본이 말한 이름 조각들(Codex #4). 부르는 쪽이 사전과 맞댄다. */
  included?: string[];
};

type Choice = { label?: string; name?: string; add?: number; addWon?: number; default?: boolean };
type Group = { group?: string; choices?: Choice[]; options?: Choice[] };
type Lineup = { base?: number; exclusiveGroups?: Group[] };
type GenModel = {
  model?: string;
  base?: number;
  exclusiveGroups?: Group[];
  lineups?: Record<string, Lineup>;
};

import { impliedOf } from './implied-options';
import { includedNames, matchIncluded, type GenLineupLike } from './genesis-included';

const S = (v: unknown) => String(v ?? '').trim();
/**
 * 모델 이름을 «통째로» 맞추기 위한 키.
 * ⚠⚠ 예전 판은 `[^a-z0-9]` 를 다 지워 **한글이 통째로 사라졌다**(2026-09-09 검수) —
 *   「GV80 쿠페」→`gv80`, 「일렉트리파이드 GV70」→`gv70` 이 되어 **다른 차가 같은 차**가 됐다.
 *   그러면 `masterFuel` 이 「일렉트리파이드 GV70」의 «전기»를 가솔린 GV70 에 물려 주고,
 *   **가솔린 차에 전기차 보조금·취득세 감면이 붙는다.**
 * ⇒ 한글도 남긴다. 지우는 것은 «띄어쓰기·붙임표» 같은 구분자뿐이다.
 */
export const modelKey = (s: unknown) => S(s).toLowerCase().replace(/[\s\-_()·.]/g, '');

/** 이 이름이 «엔진»인가 — 연료말 **과** 배기량이 둘 다 있어야 엔진으로 본다(오염 방어). */
const FUEL_WORD = /가솔린|디젤|전기|하이브리드|LPG|LPi|수소/i;
const DISPLACEMENT = /(?:^|[^0-9.])[1-6]\.[0-9]/;
export const looksLikeEngine = (s: string) => FUEL_WORD.test(s) && DISPLACEMENT.test(s);

const label = (c: Choice) => S(c.label ?? c.name);
const addWon = (c: Choice) => Number(c.add ?? c.addWon ?? 0) || 0;
const choicesOf = (g?: Group) => (g?.choices ?? g?.options ?? []).filter((c) => label(c));
const findGroup = (gs: Group[] | undefined, re: RegExp) => (gs ?? []).find((g) => re.test(S(g.group)));

/** 한 라인업(또는 모델 본체)을 엔진 × 구동으로 편다. */
function rowsOf(base: number, groups: Group[] | undefined, trimPrefix: string, rowFuel: string,
  lineup?: GenLineupLike, conditionals?: string): LineupRow[] {
  if (!(base > 0)) return [];
  const engines = choicesOf(findGroup(groups, /엔진|모터/)).filter((c) => looksLikeEngine(label(c)));
  const drives = choicesOf(findGroup(groups, /구동/));
  const eList: Choice[] = engines.length ? engines : [{ label: rowFuel, add: 0 }];
  const dList: Choice[] = drives.length ? drives : [{ label: '', add: 0 }];
  const out: LineupRow[] = [];
  for (const e of eList) {
    for (const d of dList) {
      const trim = [trimPrefix, label(d)].filter(Boolean).join(' · ');
      /* 라벨은 «한 규격»으로 — 정본이 「가솔린 2.5T」라 적어도 마스터 전체는 「가솔린 2.5 터보」다.
         갈리면 파워트레인 칸에 같은 엔진이 두 이름으로 선다. */
      /* ★★그 줄에 «이미 들어 있는» 것을 같이 싣는다 — 안 실으면 기본 포함을 또 판다
         (G80 3.5T 의 ECS 110만 · GV80 블랙의 AWD 300만 · Codex #4). */
      const included = lineup ? includedNames(lineup, label(e) || rowFuel, conditionals) : [];
      out.push({ fuel: canonFuel(label(e) || rowFuel), trim: trim || '기본',
        price: base + addWon(e) + addWon(d), ...(included.length ? { included } : {}) });
    }
  }
  return out;
}

/** 한 모델을 편다. 못 펴면 `null`(원본 한 줄을 그대로 둔다). */
export function lineupOf(m: GenModel, rowFuel: string): LineupRow[] | null {
  const out: LineupRow[] = [];
  // 라인업(표준·블랙 …)이 따로 있으면 그 이름이 트림 앞자리가 된다 — GV80 이 그렇다.
  const cond = S((m as { options?: { conditionals?: string } }).options?.conditionals);
  for (const [name, l] of Object.entries(m.lineups ?? {})) {
    out.push(...rowsOf(Number(l.base) || 0, l.exclusiveGroups, name === '표준' ? '' : name, rowFuel,
      l as GenLineupLike, cond));
  }
  if (!out.length) out.push(...rowsOf(Number(m.base) || 0, m.exclusiveGroups, '', rowFuel,
    m as GenLineupLike, cond));
  return out.length >= 2 ? out : null;
}

/**
 * 연료는 «차종마스터»가 정본이다 — `docs/신차마스터-피드.md` 「차종마스터 = 두 견적기 공통 «차량 식별» 소스」.
 * ⚠ 신차마스터가 **GV60 을 「가솔린」이라 싣고 있다**(2026-09-09 실측). 그대로 두면 전기차 보조금 600만 ·
 *   취득세 감면 140만 · 공채 면제가 **하나도 안 걸린다.** 차종마스터는 「전기 / 전기 AWD」로 맞게 안다.
 * ★지어내지 않는다 — 그 모델의 «모든» variant 가 한 연료로 일치할 때만 따른다.
 */
let fuelCache: Map<string, string> | null = null;
export function masterFuel(maker: string, subModel: string, cwd = process.cwd()): string {
  if (!fuelCache) {
    fuelCache = new Map();
    try {
      const j = JSON.parse(readFileSync(join(cwd, 'public/data/vehicle-master.json'), 'utf8'));
      for (const e of j.entries ?? []) {
        const fs2 = new Set((e.variants ?? []).map((v: { fuel?: string }) => S(v.fuel)).filter(Boolean));
        if (fs2.size === 1) fuelCache.set(`${S(e.maker)}|${modelKey(e.sub_model)}`, [...fs2][0] as string);
      }
    } catch { /* 없으면 안 바로잡는다 */ }
  }
  return fuelCache.get(`${S(maker)}|${modelKey(subModel)}`) ?? '';
}

let cache: Map<string, GenModel> | null = null;
export function genesisConfig(cwd = process.cwd()): Map<string, GenModel> {
  if (cache) return cache;
  const out = new Map<string, GenModel>();
  try {
    // ★정본 하나만 읽는다. `genesis-config.json`(mtops)은 구가라 폐기다 — 되살리지 말 것.
    const j = JSON.parse(readFileSync(join(cwd, 'data/new-car/genesis-config-fs.json'), 'utf8'));
    for (const m of j.models ?? []) out.set(modelKey(m.model), m);
  } catch { /* 파일이 없으면 안 편다 — 원본 그대로 나간다 */ }
  cache = out;
  return out;
}

/**
 * 신차마스터 줄들 중 «제네시스»를 엔진 × 구동으로 편다. 나머지 제조사는 손대지 않는다.
 * ⚠ 못 펴는 모델(G70·전기 단일 등)은 **원본 한 줄을 그대로** 둔다.
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
    // 연료는 차종마스터가 이긴다 — 신차마스터가 GV60 을 「가솔린」이라 싣는다(위 주석).
    const baseFuel = masterFuel(S(t.maker), S(t.sub_model), cwd) || S(t.fuel);
    const rows = m ? lineupOf(m, baseFuel) : null;
    if (!rows || rows.length < 2) { out.push(baseFuel !== S(t.fuel) ? ({ ...t, fuel: baseFuel } as T) : t); continue; }
    for (const r of rows) {
      /* ⚠⚠ **펴 놓은 줄마다 「이미 산 것」을 다시 센다.** `{...t}` 는 원본 한 줄의
         `impliedOptions` 를 그대로 복사한다 — 그건 «펴기 전» 연료·트림으로 잰 값이라,
         G80 「3.5 터보 · AWD · 7,003만」 줄이 엔진 660만 + AWD 280만을 **또 받는다**
         (2026-09-09 검수). 값이 엔진×구동으로 이미 오른 줄이므로 여기서 다시 잰다. */
      const om = (t as { optionsMaster?: Record<string, { name?: string; sub?: string }> }).optionsMaster;
      /* ★★★**펴 놓은 줄마다 「이미 산 것」을 «다시» 센다.**
         ㉠ 이름으로 재는 것(엔진·구동) + ㉡ **정본이 「기본포함」이라 적어 둔 것**.
         ㉡ 이 없으면 GV80 블랙에서 AWD 300만, G80 3.5T 에서 ECS 110만을 또 판다(Codex #4).
         ⚠ 못 맞대면 «지우지 않는다» — 넘겨 짚으면 유료 옵션이 사라진다(Codex #7 의 교훈). */
      let implied: string[] | undefined;
      if (om) {
        const names = Object.fromEntries(Object.entries(om).map(([id, o]) => [id, S(o.name)]));
        /* ★그 줄의 «구동»을 같이 넘긴다 — 「드라이빙어시Ⅱ(2WD)/(AWD)」처럼 구동이 갈리는 항목을
           구동 모르고 고르면 AWD 줄에 2WD 항목이 붙어 진짜 필요한 270만을 다시 판다. */
        const rowDrive = `${r.trim} ${(r.included ?? []).join(' ')}`;
        const byName = (r.included ?? []).map((p) => matchIncluded(p, names, rowDrive)).filter(Boolean) as string[];
        implied = [...new Set([...impliedOf(om, r.fuel, `${r.trim} ${r.fuel}`), ...byName])];
      }
      out.push({
        ...t, fuel: r.fuel, trim: r.trim, priceBefore: r.price, priceAfter: r.price,
        ...(implied ? { impliedOptions: implied } : {}),
        lineupSource: 'genesis-config-fs',
      } as T);
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
