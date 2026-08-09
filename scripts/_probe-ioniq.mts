/** 「아이오닉 6」이 왜 「아이오닉」으로 붙나 — 모델 선택 단계를 갈라 본다. */
import { readFileSync } from 'node:fs';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';

type Rec = Record<string, any>;
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const cases: Rec[] = [
  { 이름: '띄움 · 실데이터 그대로', model: '아이오닉', trim_name: '아이오닉 6 Long Range 2WD 익스클루시브 플러스', year: '2023', fuel_type: '전기' },
  { 이름: '붙임', model: '아이오닉', trim_name: '아이오닉6 Long Range 2WD 익스클루시브 플러스', year: '2023', fuel_type: '전기' },
  { 이름: '모델칸에 6', model: '아이오닉 6', trim_name: 'Long Range 2WD 익스클루시브 플러스', year: '2023', fuel_type: '전기' },
  { 이름: '아이오닉 5 띄움', model: '아이오닉', trim_name: '아이오닉 5 2025 스탠다드 19인치', year: '2025', fuel_type: '전기' },
];

for (const c of cases) {
  const { 이름, ...p } = c;
  const r = snapToMaster({ ...(p as never) }, entries) as unknown as Rec | null;
  console.log(`${String(이름).padEnd(20)} → 모델「${r?.model ?? ''}」 세대「${r?.sub_model ?? ''}」 파워트레인「${r?.variant ?? ''}」 트림「${r?.trim_name ?? ''}」`);
}
