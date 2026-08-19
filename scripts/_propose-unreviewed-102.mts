/**
 * 오더1 보조 — unreviewed 102대를 규칙으로 1차 분류(미리보기).
 * 결정 파일은 쓰지 않는다. 산출: tmp/unreviewed-102-propose.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');

const backlog = JSON.parse(readFileSync('tmp/product-master-vehicle-resolution-backlog.json', 'utf8'));
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8'));
const decisions = JSON.parse(readFileSync('data/product-vehicle-review-decisions.json', 'utf8'));
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8'));
const decided = new Set((decisions.decisions || []).map((d: Rec) => plate(d.car_number)));
const byKey = new Map((artifact.records || []).map((r: Rec) => [r.trim_row_key, r]));

const unreviewed = (backlog.rows || []).filter((r: Rec) => !String(r.resolution_class || '').startsWith('REVIEWED_'));
const covByRow = new Map((coverage.rows || []).map((r: Rec) => [Number(r.row), r]));

type Propose = {
  car_number: string;
  provider: string;
  supplier_text: string;
  maker: string;
  model: string;
  sub_model: string;
  trim: string;
  trim_row_key: string;
  candidate_key?: string;
  candidate_keys?: string[];
  decision: 'CODE' | 'TRIPLE' | 'PARTIAL' | 'HOLD';
  master_action: '' | 'UNBLOCK' | 'ADD_ROW' | 'PERIOD_FIX' | 'ALIAS';
  basis: string;
  rule: string;
  needs_human: boolean;
};

const proposes: Propose[] = [];

function axesOf(key: string) {
  const m = byKey.get(key) as Rec | undefined;
  if (!m) return null;
  return { maker: S(m.maker), model: S(m.model), sub: S(m.sub_model), trim: S(m.trim), tier: S(m.usage_tier) };
}

for (const row of unreviewed) {
  const cov = covByRow.get(Number(row.row));
  if (!cov) continue;
  const p = plate(cov.car_number);
  if (!p || decided.has(p)) continue;
  const keys: string[] = [...(cov.candidate_keys || [])].filter(Boolean);
  const profiles = keys.map((k) => ({ key: k, ax: axesOf(k) })).filter((x) => x.ax);
  const supplier = S(cov.supplier_vehicle_name) || '';
  const provider = S(cov.provider) || '';
  const current = S(cov.current_code);
  const currentAx = current ? axesOf(current) : null;
  const category = S(cov.category) || S(row.category);
  const clues = cov.source_clues || {};
  const conflicts = cov.signal_conflicts || [];

  const base = {
    car_number: p,
    provider,
    supplier_text: supplier,
    maker: S(cov.snap_maker) || S(row.maker) || '',
    model: '',
    sub_model: '',
    trim: '',
    trim_row_key: '',
    decision: 'HOLD' as const,
    master_action: '' as const,
    basis: '',
    rule: '',
    needs_human: true,
  };

  // 규칙0: 원천 충돌 → HOLD (사람)
  if ((conflicts && conflicts.length) || row.resolution_class === 'SOURCE_CONFLICT') {
    proposes.push({
      ...base,
      model: S(cov.snap_model),
      sub_model: S(cov.snap_sub_model),
      decision: 'HOLD',
      basis: `원천 충돌: ${JSON.stringify(conflicts).slice(0, 200)}`,
      rule: 'SOURCE_CONFLICT',
      needs_human: true,
    });
    continue;
  }

  // 규칙1: 후보가 있고 모두 같은 3축 → TRIPLE [자동합의] (automatic만 모아 candidate_keys)
  if (profiles.length >= 1) {
    const tripleKey = (a: Rec) => `${a.maker}|${a.model}|${a.sub}|${a.trim}`;
    const groups = new Map<string, typeof profiles>();
    for (const pr of profiles) {
      const k = tripleKey(pr.ax!);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(pr);
    }
    if (groups.size === 1) {
      const ax = profiles[0].ax!;
      const autoKeys = profiles.filter((pr) => pr.ax!.tier === 'automatic').map((pr) => pr.key);
      const uniqueAutos = [...new Set(autoKeys)];
      if (uniqueAutos.length === 1) {
        proposes.push({
          ...base,
          maker: ax.maker,
          model: ax.model,
          sub_model: ax.sub,
          trim: ax.trim,
          trim_row_key: uniqueAutos[0],
          decision: 'CODE',
          basis: `[자동합의] 후보 ${profiles.length}개가 동일 3축(${ax.model} › ${ax.sub} › ${ax.trim})이고 automatic 유일`,
          rule: 'SAME_TRIPLE_AUTO_UNIQUE',
          needs_human: false,
        });
        continue;
      }
      proposes.push({
        ...base,
        maker: ax.maker,
        model: ax.model,
        sub_model: ax.sub,
        trim: ax.trim,
        trim_row_key: '',
        candidate_keys: uniqueAutos.length ? uniqueAutos : profiles.map((pr) => pr.key),
        decision: 'TRIPLE',
        basis: `[자동합의] 후보 ${profiles.length}개가 동일 3축(${ax.model} › ${ax.sub} › ${ax.trim}). 인승·구동 등 비식별 축만 다름`,
        rule: 'SAME_TRIPLE',
        needs_human: false,
      });
      continue;
    }
  }

  // 규칙2: 현재 코드가 있고 automatic — 공급사 차명에 모델/세부가 들어가면 CODE 유지 후보
  if (current && currentAx && currentAx.tier === 'automatic') {
    const blob = `${supplier} ${S(clues.trim)} ${S(clues.sub_model)} ${S(clues.option)}`.toLowerCase();
    const modelHit = currentAx.model && blob.includes(currentAx.model.toLowerCase().replace(/\s/g, ''));
    const softModel = currentAx.model && supplier.includes(currentAx.model.split(/\s+/)[0]);
    // 「확정 코드 직접근거 재확인」류 — category에 코드가 있거나 current_code 있음
    if (category.includes('확정 코드') || current) {
      // 세부모델 코드(세대) 문자열이 원문에 있거나 모델명이 맞으면 유지
      const subHint = currentAx.sub.replace(/^(더\s*뉴|디\s*올\s*뉴|올\s*뉴|뉴)\s*/g, '');
      const subHit = subHint && (supplier.includes(subHint) || supplier.includes(currentAx.sub));
      if (modelHit || softModel || subHit) {
        proposes.push({
          ...base,
          maker: currentAx.maker,
          model: currentAx.model,
          sub_model: currentAx.sub,
          trim: currentAx.trim,
          trim_row_key: current,
          decision: 'CODE',
          basis: `현재 코드 유지 — 공급사 원문「${supplier.slice(0, 80)}」이 코드 3축(${currentAx.model} › ${currentAx.sub} › ${currentAx.trim})과 같은 차를 가리킴`,
          rule: 'KEEP_CURRENT_CODE',
          needs_human: !(modelHit || subHit), // soft만이면 사람 확인
        });
        continue;
      }
    }
  }

  // 규칙3: 트림 단서가 있고 후보 중 트림 일치가 유일 → CODE/TRIPLE
  const clueTrim = S(clues.trim);
  if (clueTrim && profiles.length) {
    const hit = profiles.filter((pr) => S(pr.ax!.trim).includes(clueTrim) || clueTrim.includes(S(pr.ax!.trim)));
    const autoHit = hit.filter((pr) => pr.ax!.tier === 'automatic');
    if (autoHit.length === 1) {
      const ax = autoHit[0].ax!;
      proposes.push({
        ...base,
        maker: ax.maker,
        model: ax.model,
        sub_model: ax.sub,
        trim: ax.trim,
        trim_row_key: autoHit[0].key,
        decision: 'CODE',
        basis: `공급사 트림 단서「${clueTrim}」로 automatic 후보 유일 (${ax.sub} › ${ax.trim})`,
        rule: 'CLUE_TRIM_UNIQUE',
        needs_human: false,
      });
      continue;
    }
  }

  // 규칙4: 후보 없음 → HOLD or ADD_ROW 힌트
  if (!profiles.length) {
    proposes.push({
      ...base,
      model: S(cov.snap_model),
      sub_model: S(cov.snap_sub_model),
      trim: S(clues.trim),
      decision: clueTrim ? 'PARTIAL' : 'HOLD',
      master_action: 'ADD_ROW',
      basis: `안전 후보 없음. 공급사「${supplier.slice(0, 100)}」 — 마스터 보강(ADD_ROW) 검토`,
      rule: 'NO_CANDIDATE',
      needs_human: true,
    });
    continue;
  }

  // 나머지: 사람
  const ax0 = profiles[0].ax!;
  proposes.push({
    ...base,
    maker: ax0.maker,
    model: ax0.model,
    sub_model: S(cov.snap_sub_model) || ax0.sub,
    trim: S(clues.trim),
    candidate_keys: profiles.map((pr) => pr.key),
    decision: S(clues.trim) ? 'HOLD' : 'PARTIAL',
    basis: `후보 ${profiles.length}개 3축 갈림 또는 단서 부족. category=${category}. diffs=${JSON.stringify(cov.candidate_differences || {}).slice(0, 180)}`,
    rule: 'NEEDS_HUMAN',
    needs_human: true,
  });
}

const summary = {
  total: proposes.length,
  auto: proposes.filter((p) => !p.needs_human).length,
  human: proposes.filter((p) => p.needs_human).length,
  by_rule: Object.fromEntries(
    [...proposes.reduce((m, p) => m.set(p.rule, (m.get(p.rule) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
  ),
  by_decision_auto: Object.fromEntries(
    [...proposes.filter((p) => !p.needs_human).reduce((m, p) => m.set(p.decision, (m.get(p.decision) || 0) + 1), new Map<string, number>())],
  ),
};
writeFileSync('tmp/unreviewed-102-propose.json', JSON.stringify({ summary, proposes }, null, 2));
console.log(JSON.stringify(summary, null, 2));
