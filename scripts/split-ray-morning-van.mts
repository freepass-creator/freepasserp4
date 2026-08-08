/**
 * 레이·모닝: 승용과 밴은 **다른 모델**(인승 선택지 아님).
 * 같은 세부모델에 seat=2(밴)·seat=5(승용)가 섞여 있으면
 * 밴 variant 를 `{sub} 밴` 세부모델로 분리한다.
 *
 *   npx tsx scripts/split-ray-morning-van.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { MasterEntry, MasterVariant } from '../lib/domain/vehicle-master-types';

const PATH = 'public/data/vehicle-master.json';
const S = (v: unknown) => String(v ?? '').trim();

function isVanVariant(v: MasterVariant): boolean {
  const seat = v.seat ?? 0;
  if (seat > 0 && seat <= 2) return true;
  const trims = (v.trims || []).join(' ');
  return /밴|van/i.test(trims) && seat > 0 && seat <= 2;
}

function main() {
  const raw = JSON.parse(readFileSync(PATH, 'utf8'));
  const entries = (raw.entries || raw) as MasterEntry[];
  const next: MasterEntry[] = [];
  let split = 0;

  for (const e of entries) {
    if (e.model !== '레이' && e.model !== '모닝') {
      next.push(e);
      continue;
    }
    if (/밴\s*$/.test(e.sub_model) || e.sub_model.includes(' 밴')) {
      next.push(e);
      continue;
    }

    const variants = e.variants || [];
    const van = variants.filter(isVanVariant);
    const passenger = variants.filter((v) => !isVanVariant(v));

    if (!van.length || !passenger.length) {
      // 한쪽만 있으면 축이 아닌 단일 라인 — seat 축처럼 보이게 두지 않음
      next.push({ ...e, variants });
      continue;
    }

    // 승용: 인승을 «선택 축»으로 안 씀 — 승용은 그 모델의 고정 성격
    const passengerVars = passenger.map((v) => {
      const copy = { ...v };
      delete copy.default;
      return copy;
    });
    next.push({ ...e, variants: passengerVars });

    const vanSub = `${e.sub_model} 밴`;
    const vanId = `${e.id}__van`;
    const vanVars = van.map((v) => {
      const copy = { ...v };
      delete copy.default;
      return copy;
    });
    next.push({
      ...e,
      id: vanId,
      sub_model: vanSub,
      title: e.title ? `${e.title} 밴` : undefined,
      variants: vanVars,
    });
    split++;
    console.log(`  split ${e.sub_model} → 승용 ${passengerVars.length} · 밴 ${vanVars.length}`);
  }

  raw.entries = next;
  writeFileSync(PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  console.log(`\n분리 ${split}세대 → ${PATH} (entries ${next.length})\n`);
}

main();
