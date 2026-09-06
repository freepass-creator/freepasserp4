/**
 * 차종델타를 **이름으로** 찾는다 — 「현대 · 그랜저」 → `hyundai/004`.
 *
 * ★왜 필요한가. 잔가 엔진(`residual-lookup.js`)은 `(makerId, modelCode)` 로 델타를 찾는데,
 *   차 고르기가 주는 것은 «이름»(제조사·모델)이다. 델타표(`data/residual-delta.json` 235건)에는
 *   `{maker, model, seg, delta}` 가 같이 들어 있으니 이름으로 되짚을 수 있다.
 *
 * ★2026-09-06 이전까지 견적은 델타를 **한 번도 안 걸었다**(`usedResidPct(null, null, …)`).
 *   그래서 모든 차가 국산 표준 곡선 하나로 계산됐다 — 그랜저(델타 +2)도 쏘나타(0)와 같은 잔가였다.
 *   차를 «특정»하게 됐으니 이제 그 차의 곡선을 쓴다.
 *
 * ⚠ 엔진 파일은 손대지 않는다(무손실 이관 · 회귀 39개). 이름→키 되짚기만 여기서 한다.
 */
import DELTA from './data/residual-delta.json';

type Row = { maker: string; model: string; seg: string; delta: number };
const TABLE = DELTA as Record<string, Row>;

const norm = (v: string) => String(v ?? '').toLowerCase().replace(/[\s()·\-_.]/g, '');

/** 「현대 그랜저」 → `hyundai/004`. 이름은 정확히 맞을 때만 — 대충 맞히면 남의 잔가를 쓴다. */
let byName: Map<string, string> | null = null;
function index(): Map<string, string> {
  if (byName) return byName;
  const m = new Map<string, string>();
  for (const [key, r] of Object.entries(TABLE)) {
    if (!r?.maker || !r?.model) continue;
    m.set(`${norm(r.maker)}|${norm(r.model)}`, key);
  }
  byName = m;
  return m;
}

/**
 * 제조사·모델 이름으로 델타 키를 찾는다. 없으면 `null` — 그때는 표준 곡선(델타 0)이다.
 * ★`model` 은 «모델»(그랜저)이지 «세부모델»(그랜저 IG)이 아니다. 델타는 모델 단위로 매겨져 있다.
 */
export function deltaKeyFor(maker: string, model: string): { makerId: string; modelCode: string } | null {
  const key = index().get(`${norm(maker)}|${norm(model)}`);
  if (!key) return null;
  const [makerId, modelCode] = key.split('/');
  return { makerId, modelCode };
}

/** 화면 표기용 — 그 차의 델타(±%p). 못 찾으면 0(표준). */
export function deltaOf(maker: string, model: string): number {
  const k = index().get(`${norm(maker)}|${norm(model)}`);
  return k ? Number(TABLE[k]?.delta) || 0 : 0;
}
