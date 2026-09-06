/**
 * 신차 min~max 계산 — 각 모델의 «최소 금액(기본구성) ~ 최대 금액(풀옵션)».
 *   (사장님 2026-09-06: 원자 담당이 그 차의 최소~최대를 알아야 한다. 견적기(BTO) 정본으로.)
 *
 * min = basePrice(기본구성).
 * max = basePrice + Σ(각 배타그룹 최고 addWon) + Σ(선택옵션 전부).
 *   status=pending 인 그룹/선택은 «아직 미독»으로 표시하고, max 에 «+미독» 꼬리표를 붙인다(가짜 확정 금지).
 *
 * 사용: node scripts/newcar-min-max.mjs [config.json]   (기본 data/new-car/genesis-config.json)
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

  const maxConfirmed = base + battaMax + freeSum;
  console.log(`\n■ ${m.label} (${m.model})`);
  console.log(`  최소(기본구성) = ${w(base)}  [${m.basePriceEngine || ''}]`);
  console.log(`  배타 최고 합   = +${w(battaMax)}  (${battaBreak.join(' · ') || '추가 0'})`);
  console.log(`  선택옵션 합    = ${freePending ? '미독(pending)' : '+' + w(freeSum)}`);
  console.log(`  최대(풀옵션)   = ${w(maxConfirmed)}${(pendingGroups.length || freePending) ? '  + 미독분(' + [...pendingGroups, ...(freePending ? ['선택옵션'] : [])].join('·') + ')' : ''}`);
  console.log(`  ⇒ 범위: ${w(base)} ~ ${w(maxConfirmed)}${(pendingGroups.length || freePending) ? '↑(미독 남음)' : ' (확정)'}`);
}
