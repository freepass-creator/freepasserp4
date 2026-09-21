/**
 * **운영 판매시트 F01 · 하허호 F86 쓰기 문지기** — 통합 워크플로만 운영에 쓴다.
 *
 * ★사장님 2026-09-16 「그 예약자를 우리가 하나로 통일하고, 이제 여기서 어느 AI든 통일을 좀 해놓자」 ·
 *   「통합 워크플로만 운영에 쓴다」.
 *   ⚠ 같은 밤 F01 을 두 엔진이 번갈아 덮었다 — 00:04 GitHub(gate 엔진) · 01:23 로컬 erp5 워크트리(다른 세션 손 발행).
 *     탭 이름 형식·빈 값 표기·손오공 탭이 회차마다 뒤집혔다. 규칙 문서만으로는 다른 AI 가 안 읽으면 또 덮는다 → 기계가 막는다.
 *
 * 열리는 길은 둘뿐:
 *   ① GitHub Actions 안에서, 예약 지도(`docs/예약작업-지도.md`)에 «운영 쓰기 허용»으로 적힌 워크플로
 *   ② 사장님 허락이 있는 긴급 수동 발행 — `FREEPASS_MANUAL_PUBLISH_APPROVED="YYYY-MM-DD 사유"`
 * 그 밖(로컬·다른 AI·다른 워크플로)은 미리보기 사본(`--시트=<사본>` · `SAMPLE_SHEET_ID`)만 쓴다.
 */
export type ProductionSheet = 'F01' | 'F86';

/** 운영 쓰기가 허용된 워크플로 «이름»(GITHUB_WORKFLOW). 바꾸면 예약 지도·check:schedules 도 같이 고친다. */
export const PRODUCTION_WRITE_WORKFLOWS: Record<ProductionSheet, readonly string[]> = {
  F01: ['ERP5 SSOT 원천 최신화(매시간)', '계약중 표기(30분)', 'Sheet Contract 표시 전용'],
  F86: ['ERP5 SSOT 원천 최신화(매시간)', 'Sheet Contract 표시 전용'],
};

const S = (v: unknown) => String(v ?? '').trim();

export function productionSheetWriteDecision(target: ProductionSheet, env: Record<string, string | undefined> = process.env): { ok: boolean; why: string } {
  const workflow = S(env.GITHUB_WORKFLOW);
  if (S(env.GITHUB_ACTIONS) === 'true' && PRODUCTION_WRITE_WORKFLOWS[target].includes(workflow)) {
    return { ok: true, why: `GitHub 워크플로 「${workflow}」` };
  }
  const approved = S(env.FREEPASS_MANUAL_PUBLISH_APPROVED);
  if (/^\d{4}-\d{2}-\d{2}\s+\S/.test(approved)) return { ok: true, why: `사장님 허락 수동 발행 — ${approved}` };
  return { ok: false, why: workflow ? `워크플로 「${workflow}」 은 ${target} 운영 쓰기 허용 목록에 없다` : '로컬·수동 실행' };
}

/** 운영 F01·F86 에 쓰기 «직전»에 부른다. 막히면 던진다(아무것도 안 쓴 채로). */
export function assertProductionSheetWrite(target: ProductionSheet, script: string): void {
  const d = productionSheetWriteDecision(target);
  if (d.ok) { console.log(`   ○ 운영 ${target} 쓰기 허용 — ${d.why} (${script})`); return; }
  throw new Error(
    `⛔ 운영 ${target} 쓰기 막음 — ${d.why} (${script}).\n`
    + '   운영 판매시트·하허호 시트는 GitHub 통합 워크플로만 쓴다(docs/예약작업-지도.md).\n'
    + '   미리보기는 사본으로(F86 --시트=<사본 id> · F01 SAMPLE_SHEET_ID). 긴급 수동 발행은 사장님 허락을 받아 '
    + 'FREEPASS_MANUAL_PUBLISH_APPROVED="YYYY-MM-DD 사유" 로 연다.',
  );
}
