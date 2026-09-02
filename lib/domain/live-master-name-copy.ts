/**
 * 정제칸 모델·세부모델·세부트림 = 라이브 「차종마스터」 행만.
 * 없는 축은 아래부터 비운다. 비슷한 이름으로 바꾸지 않는다.
 *
 * ★원문에 없는 `디 올 뉴`를 라이브 행에서 갖다 붙이지 않는다(2026-09-02 렌트존 싼타페 MX5).
 *   라이브 탭 글자가 `디 올 뉴 싼타페 MX5`여도 원문이 `싼타페 MX5`면 정제칸은 `싼타페 MX5`.
 *   원문에 디올뉴가 있으면 라이브 접두를 유지한다(아이카 109호5391).
 */
import { canonMakerDisplay } from './maker-display';
import type { MasterRow } from './vehicle-master-sheet';

const S = (v: unknown) => String(v ?? '').trim();
const DI_ALL_NEW = /디\s*올\s*뉴|디올뉴/;

/** 원문(왼쪽 차명)에 디올뉴가 있나. The all-new 는 여기 안 넣는다(셀토스에 한국어 접두를 추정하지 않음). */
export function rawHasDiAllNew(raw: string): boolean {
  return DI_ALL_NEW.test(S(raw));
}

/** 비교용. `디 올 뉴 싼타페 MX5`와 `싼타페 MX5`를 같은 세대로 본다. `더 뉴`는 세대 표기라 안 벗긴다. */
export function foldDiAllNew(s: string): string {
  return S(s).replace(/디\s*올\s*뉴/g, '').replace(/디올뉴/g, '').replace(/\s+/g, ' ').trim();
}

/** hourly·코덱스 게이트. 이 차가 디올뉴로 돌아가면 fill/폐쇄/손오공이 규칙을 깬 것이다. */
export const RAW_AD_PREFIX_SENTINEL = {
  who: '렌트존',
  plate: '181허5305',
  sheetId: '1_yf_MLj4AcmiAziWFFknk1w_yQBDJOe3HeiIWUuQBTM',
  wantSub: '싼타페 MX5',
} as const;

export function liveSubMatches(a: string, b: string): boolean {
  const x = S(a), y = S(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const fx = foldDiAllNew(x), fy = foldDiAllNew(y);
  return !!fx && fx === fy;
}

/** 시트값이 스냅/원문에 없는 디올뉴를 붙인 것. 이 칸만 덮는다. */
export function isDiAllNewUpgrade(canonical: string, current: string): boolean {
  const a = S(canonical), b = S(current);
  if (!a || !b || a === b) return false;
  if (!DI_ALL_NEW.test(b) || DI_ALL_NEW.test(a)) return false;
  return liveSubMatches(a, b);
}

function foldedKey(model: string, sub: string, trim: string): string {
  return `${S(model)}\t${foldDiAllNew(sub)}\t${S(trim)}`;
}

export function closeNamesToLiveMaster(
  want: Record<string, string>,
  rows: MasterRow[],
): { changed: boolean; reason: string } {
  if (!rows.length) return { changed: false, reason: '' };
  const maker = canonMakerDisplay(S(want['제조사(정제)'] || want['제조사']));
  const model = S(want['모델']);
  const sub = S(want['세부모델']);
  const trim = S(want['세부트림']);
  if (!model) return { changed: false, reason: '' };
  const active = rows.filter((row) => row.usageTier !== 'blocked');
  const byMaker = maker ? active.filter((row) => canonMakerDisplay(row.maker) === maker) : active;
  const pool = byMaker.some((row) => row.model === model) ? byMaker : active;
  const sameModel = pool.filter((row) => row.model === model);
  if (!sameModel.length) {
    want['모델'] = ''; want['세부모델'] = ''; want['세부트림'] = '';
    return { changed: true, reason: `모델 「${model}」이 라이브 차종마스터에 없음` };
  }
  if (!sub) return { changed: false, reason: '' };
  const sameSub = sameModel.filter((row) => liveSubMatches(row.subModel, sub));
  if (!sameSub.length) {
    want['세부모델'] = ''; want['세부트림'] = '';
    return { changed: true, reason: `세부모델 「${sub}」이 라이브 차종마스터에 없음` };
  }
  // 라이브 접두 글자로 바꾸지 않는다 — 원문 스냅 철자를 유지.
  if (!trim || sameSub.some((row) => row.trim === trim)) return { changed: false, reason: '' };
  want['세부트림'] = '';
  return { changed: true, reason: `세부트림 「${trim}」이 라이브 차종마스터에 없음` };
}

/** 원문에 디올뉴가 있으면 라이브 탭 철자(`디 올 뉴 싼타페 MX5`)를 쓴다. 없으면 스냅 철자 유지. */
export function preferLiveDiAllNewSpelling(
  want: Record<string, string>,
  rows: MasterRow[],
  raw: string,
): void {
  if (!rawHasDiAllNew(raw)) return;
  const model = S(want['모델']);
  const sub = S(want['세부모델']);
  if (!model || !sub) return;
  const hit = rows.find((row) => row.usageTier !== 'blocked' && row.model === model && liveSubMatches(row.subModel, sub));
  if (hit?.subModel) want['세부모델'] = hit.subModel;
}

export function liveNameMembership(
  model: string, sub: string, trim: string,
  tuples: Set<string>, modelSub: Set<string>, models: Set<string>,
): 'empty' | 'ok' | 'ok-no-trim' | 'ok-model-only' | 'bad-tuple' | 'bad-sub' | 'bad-model' {
  const m = S(model), s = S(sub), t = S(trim);
  if (!(m || s || t)) return 'empty';
  if (t) {
    if (tuples.has(`${m}\t${s}\t${t}`)) return 'ok';
    const folded = foldedKey(m, s, t);
    for (const x of tuples) {
      const [lm, ls, lt] = x.split('\t');
      if (foldedKey(lm || '', ls || '', lt || '') === folded) return 'ok';
    }
    return 'bad-tuple';
  }
  if (s) {
    if (modelSub.has(`${m}\t${s}`)) return 'ok-no-trim';
    const folded = `${m}\t${foldDiAllNew(s)}`;
    for (const x of modelSub) {
      const [lm, ls] = x.split('\t');
      if (`${lm}\t${foldDiAllNew(ls || '')}` === folded) return 'ok-no-trim';
    }
    return 'bad-sub';
  }
  return models.has(m) ? 'ok-model-only' : 'bad-model';
}
