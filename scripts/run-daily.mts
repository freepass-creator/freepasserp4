/**
 * **일일 반영 한 방 — 공급사가 시트를 고친 것을 정제칸 → 중앙 판매시트·천이시트까지 순서대로 반영하고 검수한다.**
 * 기본 dry-run(각 단계 미리보기), 실제 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「어떻게 오더하면 공급사가 변경한 거에 대해서 일괄적으로 반영·적용될까?」 → 이 한 줄:
 *     npx tsx scripts/run-daily.mts --apply
 *   (AI 에게는 「일일 반영 돌려」 = 이 명령. 자동화는 main 의 sheet-sync.yml 이 매일 09:10 에 같은 차례로 돈다.)
 *
 * ★★사장님이 2026-08-21 에 로직을 바꿨다. 지금 흐름은 이 세 줄이다:
 *     ① 자체 원본시트를 쓰는 4곳(이안카·아이카·오토플러스·아이언)만 정제시트로 가져온다
 *        — 나머지 17곳은 공급사가 우리 제공시트에 바로 채워 넣으므로 그 시트가 곧 원본이자 정제시트다(가져올 게 없다)
 *     ② 차종마스터 → 정제시트 정제칸에 필요정보를 입력한다
 *     ③ 거기서 중앙 판매시트·천이시트(영업채널 카드)로 옮겨온다
 *   ERP는 상품마스터를 거치지 않고 중앙 판매시트를 직접 읽는다. 이 스크립트 뒤 시간별 동기에서 ERP를 맞춘다.
 *
 * 차례(AI 운영 매뉴얼 5장과 같다):
 *   ① 정제시트 갱신(--with-mirror — 원본시트 쓰는 4곳. 사장님이 수식으로 연동하면 생략)
 *   ①″ 정제칸 원문 재정렬
 *   ② 정제칸 채움(21곳, 차량번호 정본 대조) ← 차종마스터가 사전
 *   ③ 못 정한 차 결정(resolve) → 새 결정이 있으면 ② 한 번 더
 *   ④ 상품시트 발행(상품리스트 → 손오공구독(+인수형 블록) → 오플구독(+오플 요금 블록) — 탭 3개, 2026-08-19)
 *      ※ 공급사 시트 「상품시트」 탭은 2026-08-21 폐지(탭 규격 통일)
 *   ④″ 천이시트(영업채널 카드시트) 발행 — 2026-08-21
 *   ⑤ 상품마스터 — 사용하지 않음(ERP 직접 원본은 판매시트 3탭)
 *   ⑥ 검수(돈 대조 · 정제칸 대조 · 빈 칸 · 트림 근거)
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

// Google 시트를 하나라도 쓰기 전에 관리대장 링크를 검사한다. 폐기 문서를 가리키면 중앙 판매시트부터 쓰지 않는다.
/**
 * ★**공급사 시트 「상품시트」 탭은 더 안 만든다**(사장님 2026-08-21 — 「각 공급사들 탭 규격이 같아야 하는데
 *   재고탭이랑 운영정책 공지사항 회사정보 이거만 있을거야」).
 *   08-19에 «올라간 값을 공급사가 대조하게» 만든 탭인데, 탭이 늘어 규격이 흐트러졌다.
 *   ⓪ 사전검사와 ④ 발행을 **같이** 뺐다 — 발행만 두고 탭을 지우면 다음 날 되살아난다.
 *   되살리려면 이 두 단계를 되돌리고 `publish-supplier-preview-tabs.mts --apply`.
 */

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
if (!rs.ok) stop('못 정한 차 결정 실패');
if (rs.ok && APPLY && rs.picked.some((l) => /✓ 결정 [1-9]/.test(l))) {
  const f2 = run('②′ 정제칸 채움(새 결정 반영)', ['scripts/fill-supplier-ai-columns.mts', '--include-mirror', '--apply'], /모두 |정본으로/);
  report.push(`②′ 정제칸 ${f2.ok ? '✓' : '✗'}`);
  if (!f2.ok) stop('새 결정 반영 후 정제칸 채움 실패');
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
// ④ 공급사 시트 「상품시트」 탭 — 폐지(2026-08-21 탭 규격 통일). 위 ⓪ 자리 주석 참고.
// ★④″ 영업채널 카드시트(사장님 2026-08-21 — 「상품시트 업데이트될때 같이 하게끔 · 상품시트로 분류해서」).
//   같은 공급사 제공시트에서 나오는 「상품시트」 갈래 — 우리 영업자용 표가 아니라 남의 회사 영업자가 보는 카드다.
//   정본 lib/domain/channel-card-sheet.ts · 매뉴얼 docs/영업채널-카드시트-매뉴얼.md
const p5 = run('④″ 영업채널 카드시트', ['scripts/publish-channel-cards.mts', ...A], /대 \(출고불가|반영 완료|대여료가 한 칸도|Error|못 찾|⚠/);
report.push(`④″ 영업채널 ${p5.ok ? '✓' : '✗'} ${p5.picked.find((l) => /반영 완료/.test(l)) || ''}`);
if (!p5.ok) stop('영업채널 카드시트 발행 실패');
if (APPLY) {
  const destinationAudit = run('④‴ 상품시트·천이 되읽기', ['scripts/audit-pipeline-destinations.mts'], /공급사 상품시트 대조|천이컴퍼니 대조|거래처 관리대장|★|⛔/);
  report.push(`④‴ 출력 되읽기 ${destinationAudit.ok ? '✓' : '✗'}`);
  if (!destinationAudit.ok) stop('상품시트·천이시트가 원본과 다름');
}

console.log('\n■ ⑤ 상품마스터 — 사용하지 않음(ERP 직접 원본은 판매시트 3탭)');
report.push('⑤ 상품마스터 사용 안 함');

if (APPLY) {
  const a1 = run('⑥ 돈 대조(공급사 시트 ↔ 판매시트)', ['scripts/audit-sheet-vs-sales.mts'], /어긋난 칸|판매리스트에만|공급사시트에만/);
  report.push(`⑥ 돈 대조 ${a1.ok ? '✓' : '✗'} ${a1.picked.find((l) => /어긋난 칸/.test(l)) || ''}`);
  if (!a1.ok) stop('공급사 시트 ↔ 판매시트 돈 대조 실패');
  const a2 = run('⑥ 정제칸 대조', ['scripts/audit-vehicle-refine.mts'], /전수 대조|어긋난 줄/);
  report.push(`⑥ 정제칸 ${a2.ok ? '✓' : '✗'} ${a2.picked.find((l) => /어긋난 줄/.test(l)) || ''}`);
  if (!a2.ok) stop('정제칸 대조 실패');
  const a3 = run('⑥ 빈 칸', ['scripts/audit-stock-gaps.mts', '--include-mirror'], /칸별 빈 곳 합계/);
  // ★트림 근거 감사(2026-08-19 예방) — 근거 없는 트림이 새로 생기면 여기서 보인다(비우기는 --demote --apply 를 사람이 확인하고).
  const a5 = run('⑥ 트림 근거 대조', ['scripts/audit-trim-evidence.mts'], /^■|대  /);
  report.push(`⑥ 트림 근거 ${a5.ok ? '✓' : '✗'} ${a5.picked.filter((l) => /근거 없음|다른 트림/.test(l)).join(' · ') || '(근거 없음 0)'}`);
  if (!a5.ok) stop('트림 근거 대조 실패');
  report.push(`⑥ 빈 칸 ${a3.ok ? '✓' : '✗'} ${a3.picked[0] || ''}`);
  if (!a3.ok) stop('재고 필수값 빈 칸 감사 실패');
} else report.push('⑥ 검수는 --apply 뒤에 돈다');
report.push(`끝 — ${Math.round((Date.now() - started) / 1000)}초`);
writeFileSync('tmp/run-daily-report.txt', report.join('\n'));
console.log(`\n${report.join('\n')}\n  보고 tmp/run-daily-report.txt`);
