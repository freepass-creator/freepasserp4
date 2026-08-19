/**
 * **일일 반영 한 방 — 공급사가 시트를 고친 것을 정제칸 → 판매시트 → 상품마스터까지 순서대로 반영하고 검수 결과를 보여 준다.**
 * 기본 dry-run(각 단계 미리보기), 실제 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「어떻게 오더하면 공급사가 변경한 거에 대해서 일괄적으로 반영·적용될까?」 → 이 한 줄:
 *     npx tsx scripts/run-daily.mts --apply
 *   (AI 에게는 「일일 반영 돌려」 = 이 명령. 자동화는 main 의 sheet-sync.yml 이 매일 09:10 에 같은 차례로 돈다.)
 *
 * 차례(AI 운영 매뉴얼 5장과 같다):
 *   ① 정제시트 갱신(--with-mirror 일 때만 — 사장님이 수식으로 연동하면 생략)
 *   ② 정제칸 채움(21곳, 차량번호 정본 대조)
 *   ③ 못 정한 차 결정(resolve) → 새 결정이 있으면 ② 한 번 더
 *   ④ 판매시트 발행(상품리스트 → 손오공구독(+인수형 블록) → 오플구독(+오플 요금 블록) — 탭 3개, 2026-08-19)
 *   ⑤ 상품마스터 갱신(→ 02:00 ERP 동기)
 *   ⑤′ 상품마스터 ← 상품리스트 맞춤(발행값이 정본 — ERP 와 영업자 표가 정확히 같아진다)
 *   ⑥ 검수(돈 대조 · 정제칸 대조 · 빈 칸 · 상품리스트↔상품마스터 일치 게이트)
 * ★한 단계가 실패하면 거기서 멈추고 무엇이 실패했는지 남긴다(다음 단계로 안 넘어간다 — 낡은 값을 발행하지 않기 위해).
 *   발행 가드(공급사 하나가 0대로 줄면 멈춤)에 걸리면 사람이 확인 후 `--force-shrink` 로 다시.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const WITH_MIRROR = process.argv.includes('--with-mirror');
const FORCE = process.argv.includes('--force-shrink');
const started = Date.now();
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const run = (label: string, args: string[], pick: RegExp): { ok: boolean; lines: string[]; picked: string[] } => {
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/Assertion|\[fp4\]|DEP0190|trace-deprecation/.test(l));
  const picked = lines.filter((l) => pick.test(l)).map((l) => l.trim());
  console.log(`\n■ ${label} ${r.status === 0 ? '✓' : '✗'}`);
  for (const l of picked.slice(0, 12)) console.log(`   ${l.slice(0, 220)}`);
  if (r.status !== 0) for (const l of lines.slice(-4)) console.log(`   ! ${l.slice(0, 220)}`);
  return { ok: r.status === 0, lines, picked };
};
const A = APPLY ? ['--apply'] : [];
const report: string[] = [`일일 반영 ${APPLY ? '반영' : '미리보기'} ${kst()} KST`];
const stop = (why: string) => { report.push(`✗ 중단: ${why}`); console.log(`\n⛔ 중단 — ${why}`); writeFileSync('tmp/run-daily-report.txt', report.join('\n')); process.exit(1); };

if (WITH_MIRROR) {
  const s = run('① 정제시트 갱신', ['scripts/sync-mirror-all.mts', ...A], /^\s*[✓✗·]|끝|실패/);
  report.push(`① 미러 ${s.ok ? '✓' : '✗'}`); if (!s.ok) stop('정제시트 갱신 실패');
} else { console.log('\n■ ① 정제시트 갱신 — 건너뜀(--with-mirror 없음 · 사장님 수식 연동)'); report.push('① 미러 건너뜀'); }

// ★①″ 정제칸 원문 재정렬(2026-08-19) — 선택옵션·외장색상·내장색상은 그 줄 원문에서만 나오는 칸: 밀림·옛 값이 있어도 매일 스스로 맞춘다(강지수 팀장 제보 재발 방지).
const f0 = run('①″ 정제칸 원문 재정렬', ['scripts/realign-derived-cells.mts', ...A], /바로잡을 칸|✓|Error/);
report.push(`①″ 재정렬 ${f0.ok ? '✓' : '✗'} ${f0.picked.find((l) => /바로잡을 칸/.test(l)) || ''}`); if (!f0.ok) stop('정제칸 원문 재정렬 실패');
const f1 = run('② 정제칸 채움', ['scripts/fill-supplier-ai-columns.mts', '--include-mirror', ...A], /차량번호 정본|모두 |정본으로|바로잡|비운 칸|안 믿은/);
report.push(`② 정제칸 ${f1.ok ? '✓' : '✗'} ${f1.picked.find((l) => /모두 /.test(l)) || ''}`); if (!f1.ok) stop('정제칸 채움 실패');

const rs = run('③ 못 정한 차 결정', ['scripts/resolve-unmatched-vehicles.mts', ...A], /코드 없는|판정|✓ 결정/);
report.push(`③ 결정 ${rs.ok ? '✓' : '✗'} ${rs.picked.find((l) => /판정/.test(l)) || ''}`);
if (rs.ok && APPLY && rs.picked.some((l) => /✓ 결정 [1-9]/.test(l))) {
  const f2 = run('②′ 정제칸 채움(새 결정 반영)', ['scripts/fill-supplier-ai-columns.mts', '--include-mirror', '--apply'], /모두 |정본으로/);
  report.push(`②′ 정제칸 ${f2.ok ? '✓' : '✗'}`);
}

const p1 = run('④ 상품리스트 발행', ['scripts/publish-origin-tab.mts', ...A, ...(FORCE ? ['--force-shrink'] : [])], /우리 시트 |출고불가 .*안 싣는다|금액 빠진|「-」|정본\(|반영 완료|못 읽은|Error|중단|force-shrink/);
report.push(`④ 상품리스트 ${p1.ok ? '✓' : '✗'} ${p1.picked.find((l) => /반영 완료|우리 시트 /.test(l)) || ''}`);
if (!p1.ok) stop('상품리스트 발행 실패(가드에 걸렸으면 확인 후 --force-shrink)');
// ★탭 3개(사장님 2026-08-19 「상품리스트 · 손오공구독(반납/인수) · 오플구독 탭 3개로 회귀」): 같은 발행기로 갈래 탭을 찍고 원본 요금 블록을 덧붙인다.
const p2 = run('④ 손오공구독 발행', ['scripts/publish-origin-tab.mts', '--only=RP012:구독', '--tab=손오공구독', '--at=1', ...A, ...(FORCE ? ['--force-shrink'] : [])], /우리 시트 |반영 완료|Error|중단/);
report.push(`④ 손오공구독 ${p2.ok ? '✓' : '✗'} ${p2.picked.find((l) => /반영 완료|우리 시트 /.test(l)) || ''}`); if (!p2.ok) stop('손오공구독 탭 발행 실패');
const p2b = run('④ 손오공구독 + 인수형 블록', ['scripts/publish-sonogong-tab.mts', ...A], /실을 차|사진링크|반영 완료|Error/);
report.push(`④ 인수형 블록 ${p2b.ok ? '✓' : '✗'} ${p2b.picked.find((l) => /반영 완료|실을 차/.test(l)) || ''}`); if (!p2b.ok) stop('손오공구독 인수형 블록 실패');
const p3 = run('④ 오플구독 발행', ['scripts/publish-origin-tab.mts', '--only=RP023', '--tab=오플구독', '--at=2', ...A, ...(FORCE ? ['--force-shrink'] : [])], /우리 시트 |반영 완료|Error|중단/);
report.push(`④ 오플구독 ${p3.ok ? '✓' : '✗'} ${p3.picked.find((l) => /반영 완료|우리 시트 /.test(l)) || ''}`); if (!p3.ok) stop('오플구독 탭 발행 실패');
const p3b = run('④ 오플구독 + 오플 요금 블록', ['scripts/publish-sonogong-tab.mts', '--tab=오플구독', ...A], /실을 차|사진링크|반영 완료|Error/);
report.push(`④ 오플 블록 ${p3b.ok ? '✓' : '✗'} ${p3b.picked.find((l) => /반영 완료|실을 차/.test(l)) || ''}`); if (!p3b.ok) stop('오플구독 요금 블록 실패');
// ★공급사 시트마다 「상품시트」 탭 — 발행된 판매시트에서 그 공급사 줄을 그대로(사장님 2026-08-19 「공급사가 입력하는 거랑 상품시트에 올라갈 거를 미리 똑같이」).
const p4 = run('④ 공급사 시트 「상품시트」 탭', ['scripts/publish-supplier-preview-tabs.mts', ...A], /반영 |못 찾은|Error/);
report.push(`④ 공급사 상품시트 탭 ${p4.ok ? '✓' : '✗'} ${p4.picked.find((l) => /반영 /.test(l)) || ''}`);

const pm = run('⑤ 상품마스터 갱신', ['scripts/sync-product-master-live.mts', ...A, ...(FORCE ? ['--force-shrink'] : []), '--dump=tmp/run-daily-pm.json'], /^문패|중단|Error/);
report.push(`⑤ 상품마스터 ${pm.ok ? '✓' : '✗'}`); if (!pm.ok) stop('상품마스터 갱신 실패');
// ★상품리스트 ↔ 상품마스터(→ERP) 정확 일치 — 발행된 판매시트 값을 정본으로 상품마스터 상태·기간별 대여료·보증금을 덮는다(사장님 2026-08-18).
const ps = run('⑤′ 상품마스터 ← 상품리스트 맞춤', ['scripts/sync-product-master-from-sales.mts', ...A], /어긋난 칸|되읽기|번호미정|보증금이 없는|✗|Error/);
report.push(`⑤′ 일치 ${ps.ok ? '✓' : '✗'} ${ps.picked.find((l) => /어긋난 칸/.test(l)) || ''}`); if (!ps.ok) stop('상품마스터 ← 상품리스트 맞춤 실패');

if (APPLY) {
  const a1 = run('⑥ 돈 대조(공급사 시트 ↔ 판매시트)', ['scripts/audit-sheet-vs-sales.mts'], /어긋난 칸|판매리스트에만|공급사시트에만/);
  report.push(`⑥ 돈 대조 ${a1.ok ? '✓' : '✗'} ${a1.picked.find((l) => /어긋난 칸/.test(l)) || ''}`);
  const a2 = run('⑥ 정제칸 대조', ['scripts/audit-vehicle-refine.mts'], /전수 대조|어긋난 줄/);
  report.push(`⑥ 정제칸 ${a2.picked.find((l) => /어긋난 줄/.test(l)) || ''}`);
  const a3 = run('⑥ 빈 칸', ['scripts/audit-stock-gaps.mts', '--include-mirror'], /칸별 빈 곳 합계/);
  // ★트림 근거 감사(2026-08-19 예방) — 근거 없는 트림이 새로 생기면 여기서 보인다(비우기는 --demote --apply 를 사람이 확인하고).
  const a5 = run('⑥ 트림 근거 대조', ['scripts/audit-trim-evidence.mts', '--apply'], /^■|대  /);
  report.push(`⑥ 트림 근거 ${a5.picked.filter((l) => /근거 없음|다른 트림/.test(l)).join(' · ') || '(근거 없음 0)'}`);
  report.push(`⑥ 빈 칸 ${a3.picked[0] || ''}`);
  const a4 = run('⑥ 상품리스트 ↔ 상품마스터(→ERP) 일치 게이트', ['scripts/sync-product-master-from-sales.mts', '--audit-only'], /어긋난 칸|✓ 일치|✗|번호미정/);
  report.push(`⑥ ERP 일치 ${a4.ok ? '✓' : '✗'} ${a4.picked.find((l) => /어긋난 칸/.test(l)) || ''}`);
  if (!a4.ok) stop('상품리스트 ↔ 상품마스터 어긋남 — ERP 가 영업자 표와 다르게 읽는다');
} else report.push('⑥ 검수는 --apply 뒤에 돈다');
report.push(`끝 — ${Math.round((Date.now() - started) / 1000)}초`);
writeFileSync('tmp/run-daily-report.txt', report.join('\n'));
console.log(`\n${report.join('\n')}\n  보고 tmp/run-daily-report.txt`);
