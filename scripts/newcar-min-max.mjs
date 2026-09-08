/**
 * 신차 min~max — 각 모델의 «최소 금액 ~ 최대 금액». (사장님 2026-09-06 · 코덱스 설계검토 반영)
 *
 * ★코덱스 정정: min·max 는 «유효한 완성 구성»에서만 구한다. «그룹별 최고를 그냥 합산»하면 틀린다
 *   (엔진 최고 ↔ 휠 최고가 «같이 선택 가능한지»를 안 보므로). 조합 규칙(종속·배타·패키지 포함)이
 *   다 확인되기 전에는 «모델 min~max»가 아니라 «검증된 구성 중 관측 최저·최고»만 낼 수 있다.
 *
 * 그래서 지금 출력은 둘로 나눈다:
 *   ① 확정 최소 = basePrice (기본구성이 유효한 완성구성일 때).
 *   ② «배타 상한(참고)» = 기본 + Σ배타최고 — 조합 «유효성 미검증»이라 «상한 후보」일 뿐, 실제 최대 아님.
 * 조합규칙·선택옵션이 다 채워지면 유효구성 전수/가지치기로 «모델 max»를 낸다(별도 계산기).
 *
 * 사용: node scripts/newcar-min-max.mjs [config.json]
 */
import { readFileSync } from 'node:fs';
const path = process.argv[2] || 'data/new-car/genesis-config.json';
const cfg = JSON.parse(readFileSync(path, 'utf8'));
const w = (n) => Number(n).toLocaleString();

for (const m of cfg.models) {
  const base = Number(m.basePrice || 0);
  let battaMax = 0; const pendingGroups = []; const battaBreak = [];
  for (const g of (m.exclusiveGroups || [])) {
    if (g.status === 'pending' || !(g.choices || []).length) { pendingGroups.push(g.group); continue; }
    const top = Math.max(0, ...g.choices.map((c) => Number(c.addWon || 0)));
    battaMax += top;
    if (top > 0) battaBreak.push(`${g.group} 최고 +${w(top)}`);
  }
  const free = m.freeOptions || {};
  const freeSum = (free.items || []).reduce((s, o) => s + Number(o.price || 0), 0);
  const freePending = free.status === 'pending';

  const battaCeil = base + battaMax + freeSum; // 조합 유효성 «미검증» — 상한 후보일 뿐
  const rulesVerified = !pendingGroups.length && !freePending && (m.constraintsVerified === true);
  console.log(`\n■ ${m.label} (${m.model})`);
  console.log(`  ✅ 확정 최소 = ${w(base)}  [${m.basePriceEngine || ''}]  (기본구성)`);
  console.log(`  배타 최고 합 = +${w(battaMax)}  (${battaBreak.join(' · ') || '추가 0'})`);
  console.log(`  선택옵션 합  = ${freePending ? '미독(pending)' : '+' + w(freeSum)}`);
  if (rulesVerified) {
    console.log(`  ✅ 모델 최대(유효구성) = ${w(battaCeil)}  (조합규칙 검증됨)`);
    console.log(`  ⇒ 범위: ${w(base)} ~ ${w(battaCeil)}`);
  } else {
    console.log(`  ⚠ 배타 상한 후보 = ${w(battaCeil)}  — «조합 유효성 미검증»(엔진max↔휠max 동시선택 가능 여부 등 안 봄) + 미독분(${[...pendingGroups, ...(freePending ? ['선택옵션'] : [])].join('·') || '없음'})`);
    console.log(`  ⇒ 지금 답할 수 있는 것: «최소 ${w(base)} 확정» · «최대는 조합규칙·선택옵션 채운 뒤 유효구성으로 확정»`);
  }
}
