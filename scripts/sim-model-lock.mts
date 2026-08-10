/**
 * **모델 경계 sim** — 세부모델이 «다른 모델»의 것으로 붙는 일이 없어야 한다.
 *
 * 5단계(제조사 → 모델 → 세부모델 → 파워트레인 → 세부트림)는 계단이다.
 * 윗 칸을 어기는 아랫 칸이 붙으면 그 아래가 전부 남의 것이 된다 —
 * 「기아 K8」에 「셀토스 SP3」가 붙으면 파워트레인·트림까지 셀토스 것이 되어
 * 영업자가 다른 차를 판다(실측 2026-08-10 · 이안카 4대).
 *
 *   npx tsx scripts/sim-model-lock.mts
 */
import { readFileSync } from 'node:fs';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const S = (v: unknown) => String(v ?? '').trim();
const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = (Array.isArray(raw) ? raw : raw.entries) || [];
/** 세부모델 → 그것이 속한 모델. 계단이 지켜졌는지 보는 잣대. */
const owner = new Map<string, string>();
for (const e of entries) if (S(e.sub_model)) owner.set(S(e.sub_model), S(e.model));

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const snap = (rec: Record<string, unknown>) => snapToMaster(rec as never, entries) as Record<string, string> | null;

console.log('■ 모델 경계\n');

// ── 계단이 지켜지는가 ────────────────────────────────────────────────
const CASES: [string, Record<string, unknown>, string][] = [
  ['K8 · 마스터에 그 연식 세대가 있을 때', { maker: '기아', model: 'K8', trim_name: '2.5 26MY 베스트 셀렉션 2WD', year: '2026' }, 'K8'],
  ['K9 · 마스터에 없는 연식(2030)', { maker: '기아', model: 'K9', trim_name: '3.8 GDI 마스터즈', year: '2030' }, 'K9'],
  ['셀토스 · 정상', { maker: '기아', model: '셀토스', trim_name: '1.6T 가솔린 2WD 트렌디', year: '2026' }, '셀토스'],
  ['쏘나타 · 세대코드 있음', { maker: '현대', model: '쏘나타', trim_name: '디 엣지 DN8 2.0 인스퍼레이션', year: '2024' }, '쏘나타'],
];
for (const [name, rec, wantModel] of CASES) {
  const r = snap(rec);
  const sub = S(r?.sub_model);
  const own = sub ? owner.get(sub) : '';
  ok(`${name} → 「${wantModel}」 안에 머문다`, !!sub && own === wantModel,
    `세부「${sub || '없음'}」 (이건 ${own || '?'} 것)`);
}

// ── 모델을 못 알아들으면 «아무거나» 붙이지 않는다 ──────────────────────
{
  // 마스터에 아예 없는 새 모델 — 신차가 나오면 이 모양으로 들어온다. 붙이지 말고 검수로 보낸다.
  const r = snap({ maker: '제네시스', model: 'GV90', trim_name: '전기 롱레인지 AWD', year: '2027' });
  ok('마스터에 없는 새 모델은 안 붙인다', !S(r?.sub_model),
    `세부「${S(r?.sub_model) || '없음'}」 — 붙으면 남의 모델이다`);
}
{
  /**
   * ⚠ **알려진 한계 — 「모델명 + 접미어」는 흡수된다.**
   *   「캐스퍼 일렉트릭」·「스타리아 EV」가 마스터에 따로 없으면 내연 모델로 붙는다.
   *   계단은 안 무너지지만(붙은 세대는 그 모델 것) **다른 차**가 된다.
   *   막는 방법은 마스터에 그 모델을 넣는 것이다 — 신차는 그렇게 다루기로 했다(2026-08-10).
   *   여기서는 «지금 그렇다»를 못 박아 둔다. 마스터에 넣으면 이 검사가 깨지고,
   *   그때 기대값을 「안 붙음」 또는 「제 모델」로 고치면 된다.
   */
  const r = snap({ maker: '현대', model: '캐스퍼 일렉트릭', trim_name: '전기 인스퍼레이션', year: '2026' });
  const sub = S(r?.sub_model);
  ok('「캐스퍼 일렉트릭」은 아직 마스터에 없어 캐스퍼로 흡수된다(알려진 한계)',
    !sub || owner.get(sub) === '캐스퍼', `세부「${sub || '없음'}」`);
}
{
  // 모델 칸에 제조사명이 잘못 들어온 경우(실측 「캐딜락 캐딜락」).
  const r = snap({ maker: '캐딜락', model: '캐딜락', trim_name: '스포츠', year: '2023' });
  ok('모델 칸이 제조사명이면 안 붙인다', !S(r?.sub_model), `세부「${S(r?.sub_model) || '없음'}」`);
}
{
  // 모델이 아예 없는 시트도 있다 — 그건 세대코드·문구로 잡는 정상 경로라 막지 않는다.
  const r = snap({ maker: '현대', trim_name: '쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션', year: '2024' });
  ok('모델 칸이 비면 문구로 잡는다(막지 않는다)', S(r?.model) === '쏘나타', `모델「${S(r?.model) || '없음'}」`);
}

// ── 계단 전수 검사 — 어떤 입력이든 세부모델은 그 모델의 것이어야 한다 ─────
{
  const probes: Record<string, unknown>[] = [];
  for (const e of entries.slice(0, 400)) {
    if (!S(e.model) || !S(e.maker)) continue;
    probes.push({ maker: e.maker, model: e.model, trim_name: S((e.variants || [])[0]?.label), year: String(e.year_start || '') });
  }
  const bad = probes.filter((rec) => {
    const r = snap(rec);
    const sub = S(r?.sub_model);
    return !!sub && owner.get(sub) !== S(rec.model);
  });
  ok(`마스터 ${probes.length}종을 되먹여도 모델을 안 넘는다`, bad.length === 0,
    `넘은 것 ${bad.length}건 — ${bad.slice(0, 3).map((b) => `${b.maker} ${b.model}`).join(' · ')}`);
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) { console.log('\n★계단이 무너졌다. vehicle-master-score 의 모델 잠금을 확인하라.\n'); process.exit(1); }
