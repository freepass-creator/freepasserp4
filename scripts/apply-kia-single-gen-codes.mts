/**
 * 기아 «단세대» 세부모델의 개발코드 제거 — 엔카 규칙(매뉴얼 §1): 세대명 없는(단세대) 기아는 코드 안 붙인다.
 *   예: K8 GL3 → K8 · EV6 CV1 → EV6 · 레이 TAM → 레이 · 모하비 HM → 모하비 · 스팅어 CK → 스팅어.
 *   ★다세대(K5 DL3·K7 YG·쏘렌토 UM…)는 «유지»(엔카가 세대명을 쓰므로 코드로 구분). 기준 = 모델당 distinct gen_code 개수 1.
 *
 * 마스터 생태계 3파일을 한 번에 맞춘다(안 그러면 시트→JSON 재빌드 때 코드가 되살아난다):
 *   vehicle-master.json(entries) · vehicle-trim-master.json(records) · master-aliases.json.
 * ★소스 F03/라이브 「차종마스터」 시트에도 같은 손질이 필요(이 JSON 은 코드가 읽는 정본, 시트는 엔카 검토면).
 * 기본 dry-run · --apply. 다세대 오변경 감지 시 중단.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const MP = 'public/data/vehicle-master.json';
const TP = 'public/data/vehicle-trim-master.json';
const AP = 'public/data/master-aliases.json';
const master = JSON.parse(readFileSync(MP, 'utf8')) as any;
const entries = master.entries as any[];

// 기아 모델별 distinct gen_code → 1개면 단세대.
const genByModel: Record<string, Set<string>> = {};
for (const e of entries) { if (S(e.maker) !== '기아') continue; const mo = S(e.model); if (!mo) continue; (genByModel[mo] = genByModel[mo] || new Set()).add(S(e.gen_code)); }
const singleGen = new Set(Object.entries(genByModel).filter(([, s]) => [...s].filter(Boolean).length === 1).map(([m]) => m));
const codeOf: Record<string, string> = {};
for (const m of singleGen) { const c = [...genByModel[m]].filter(Boolean)[0]; if (c) codeOf[m] = c; }
const MUST_KEEP = ['K5', 'K7', '쏘렌토', 'K3', 'K9', '니로', '스포티지', '셀토스', '모닝', '카니발'];
const strip = (sm: string, code: string) => sm.split(code).join('').replace(/\s+/g, ' ').replace(/\s+\)/g, ')').trim();

let mChanged = 0, tChanged = 0, aChanged = 0, wrong = 0;
// 1) vehicle-master.json entries
for (const e of entries) {
  if (S(e.maker) !== '기아') continue;
  const mo = S(e.model), code = codeOf[mo], sm = S(e.sub_model);
  if (!code || !sm.includes(code)) continue;
  const next = strip(sm, code);
  if (next && next !== sm) { if (MUST_KEEP.includes(mo)) wrong++; if (APPLY) e.sub_model = next; mChanged++; }
}
// title 표시라벨도 같은 코드 제거(메타지만 일관성) — sub_model 상태와 무관하게 별도 처리.
for (const e of entries) {
  if (S(e.maker) !== '기아') continue;
  const code = codeOf[S(e.model)], tt = S(e.title);
  if (!code || !tt.includes(code)) continue;
  const tn = strip(tt, code);
  if (tn && tn !== tt) { if (APPLY) e.title = tn; mChanged++; }
}
// 2) vehicle-trim-master.json records (sub_model 필드만 — 코드는 development_code 에 남음)
const tm = JSON.parse(readFileSync(TP, 'utf8')) as any;
const trows = (Array.isArray(tm) ? tm : tm.records) || [];
for (const r of trows) {
  if (S(r.maker) !== '기아') continue;
  const mo = S(r.model), code = codeOf[mo], sm = S(r.sub_model);
  if (!code || !sm.includes(code)) continue;
  const next = strip(sm, code);
  if (next && next !== sm) { if (MUST_KEEP.includes(mo)) wrong++; if (APPLY) r.sub_model = next; tChanged++; }
}
// 3) master-aliases.json — 값에 코드 든 것 치환(코드형은 단어+공백뿐 → split/join).
let aliasRaw = readFileSync(AP, 'utf8');
for (const [mo, code] of Object.entries(codeOf)) {
  const form = mo + ' ' + code;
  if (aliasRaw.includes(form)) { aChanged += aliasRaw.split(form).length - 1; if (APPLY) aliasRaw = aliasRaw.split(form).join(mo); }
}

console.log('단세대(코드제거): ' + [...singleGen].filter((m) => codeOf[m]).join(', '));
console.log(`master ${mChanged} · trim-master ${tChanged} · aliases ${aChanged} 건 변경`);
console.log(`★안전검사 — 다세대 오변경: ${wrong}건 ${wrong ? '⚠ 중단' : '✓'}`);
if (!APPLY) { console.log('\n미리보기 — 실제: --apply'); process.exit(0); }
if (wrong) { console.error('다세대 오변경 — 중단'); process.exit(1); }
copyFileSync(MP, MP + '.bak-kiacode'); writeFileSync(MP, JSON.stringify(master, null, 1));
copyFileSync(TP, TP + '.bak-kiacode'); writeFileSync(TP, JSON.stringify(tm, null, 1));
if (existsSync(AP)) { copyFileSync(AP, AP + '.bak-kiacode'); writeFileSync(AP, aliasRaw); }
console.log('반영 완료 — 3파일 + 백업(.bak-kiacode)');
