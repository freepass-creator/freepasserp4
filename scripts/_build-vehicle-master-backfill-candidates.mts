/**
 * 오더2 — 결정 파일 master_action 후보표 (원장 수정 없음).
 * 산출: tmp/vehicle-master-backfill-candidates.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadProductVehicleReviewDecisions } from '../lib/domain/product-vehicle-review-decisions';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

const decisions = loadProductVehicleReviewDecisions();
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8'));
const byKey = new Map((artifact.records || []).map((r: Rec) => [r.trim_row_key, r]));

type Cand = {
  master_action: string;
  car_number: string;
  provider: string;
  decision: string;
  maker: string;
  model: string;
  sub_model: string;
  trim: string;
  candidate_key: string;
  candidate_blocked: boolean | null;
  candidate_evidence_note: string;
  candidate_period: string;
  meaning_conflict_in_note: boolean;
  draft: Rec;
  evidence_url: string;
  evidence_status: '찾음' | '근거 없음' | '후보만';
  notes: string;
};

const cands: Cand[] = [];

for (const d of decisions.decisions) {
  if (!d.master_action) continue;
  const key = S(d.candidate_key);
  const master = key ? byKey.get(key) : null;
  const note = S(master?.evidence_note);
  const meaningConflict = /의미충돌|충돌|다른 차|불일치/.test(note);
  const draft: Rec = {
    maker: d.maker,
    model: d.model,
    sub_model: d.sub_model,
    trim: d.trim,
    fuel: '',
    engine_cc: '',
    drivetrain: '',
    seats: '',
    production_start: '',
    production_end: '',
    evidence_url: '',
  };
  if (master) {
    draft.fuel = S(master.fuel);
    draft.engine_cc = master.engine_cc ?? '';
    draft.drivetrain = S(master.drivetrain);
    draft.seats = master.seats ?? '';
    draft.production_start = S(master.production_start);
    draft.production_end = S(master.production_end);
    draft.evidence_url = S(master.evidence_url);
  }

  let evidence_status: Cand['evidence_status'] = '후보만';
  let evidence_url = S(draft.evidence_url);
  if (d.master_action === 'ALIAS') {
    evidence_status = '후보만';
    evidence_url = '';
  } else if (evidence_url) {
    evidence_status = '찾음';
  } else if (d.master_action === 'UNBLOCK' || d.master_action === 'ADD_ROW' || d.master_action === 'PERIOD_FIX') {
    evidence_status = '근거 없음';
  }

  cands.push({
    master_action: d.master_action,
    car_number: d.car_number,
    provider: d.provider,
    decision: d.decision,
    maker: d.maker,
    model: d.model,
    sub_model: d.sub_model,
    trim: d.trim,
    candidate_key: key,
    candidate_blocked: master ? S(master.usage_tier) === 'blocked' : null,
    candidate_evidence_note: note.slice(0, 240),
    candidate_period: master ? `${S(master.production_start)}~${S(master.production_end)}` : '',
    meaning_conflict_in_note: meaningConflict,
    draft,
    evidence_url,
    evidence_status,
    notes: d.basis.slice(0, 280),
  });
}

/** PLAN 명시 규격검토 오기 2건 */
const reviewFixes = [
  {
    kind: 'SPEC_REVIEW_FIX',
    subject: '디 올 뉴 코나 SX2 가솔린 그룹 생산시작',
    current: '2026-04',
    expected: '2023-01',
    notes: '규격검토 오기 — 실차·공식 출시는 2023-01',
    evidence_url: '',
    evidence_status: '근거 없음' as const,
  },
  {
    kind: 'SPEC_REVIEW_FIX',
    subject: '더 뉴 QM6 HZG LPe 그룹',
    current: '누락',
    expected: '2019-06~',
    notes: '규격검토에 LPe 그룹 누락',
    evidence_url: '',
    evidence_status: '근거 없음' as const,
  },
];

const byAction: Rec = {};
for (const c of cands) {
  byAction[c.master_action] = (byAction[c.master_action] || 0) + 1;
}

const out = {
  generated_at: new Date().toISOString(),
  scope: '결정 파일 master_action 후보만(원장·registry 수정 금지). Claude/사람 게이트용.',
  counts: byAction,
  review_spec_fixes: reviewFixes,
  candidates: cands,
};
writeFileSync('tmp/vehicle-master-backfill-candidates.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ out: 'tmp/vehicle-master-backfill-candidates.json', counts: byAction, review_fixes: reviewFixes.length, total: cands.length }, null, 2));
