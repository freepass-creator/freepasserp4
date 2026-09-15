/**
 * **정제시트(우리 규격) ← 공급사 원본** 연결표. `scripts/sync-mirror-all.mts` 가 이 표대로 돈다.
 *
 * ★★★사장님 2026-09-15 확정 — **공급사별 수집 경로는 이게 «전부»다. 이거 아닌 건 다 버린다.**
 * ```
 *   손오공    →  erp(API 덤프)              lib/domain/sonokong-product-kind.ts · ingest-supplier-to-firestore --code=RP012
 *   오토플러스 →  홈페이지(reborncar.co.kr)  ★이미 있다(2026-09-08 착수) — scripts/ingest-reborncar-to-firestore.mts.
 *                                            문서 = docs/원자-원천지도.md §② 줄37. MIRROR_SOURCES 의 kind=sheet(구글시트
 *                                            원본)는 «폐기 대상» — 요금열이 깨져 있다(2026-09-15 dry-run 「요금이 한
 *                                            대도 없다」로 자동 중단). reborncar 인제스터를 정본 삼아 실행할 것.
 *   아이언    →  홈페이지(ironrentcar.com)  kind='iron' · lib/domain/mirror-iron-source.ts
 *   아이카    →  그들의 시트(원본 그대로)    kind='sheet'
 *   이안카    →  그들의 시트(원본 그대로)    kind='sheet'
 *   그 외 전부 →  프리패스표준시트(우리가 준 양식) — MIRROR_SOURCES 밖, 문패(HUB_CODE_SHEET_ID)가
 *               가리키는 원천을 `srcConfig()`(ingest-supplier-to-firestore.mts)가 그대로 읽는다.
 *               코드는 이미 있다 — erp3 hourly-sync 중지(2026-09-11) 이후 «실행이 멈췄을 뿐»이다.
 * ```
 * 이전 규칙(아래 2026-08-18 메모)은 이 표로 대체됐다 — 오토플러스는 그때 「시트」로 잘못 붙었었다.
 *
 * ★★사장님 2026-09-15 「양방향 없어 — 한방향으로만 수집되고 뿌려지는거야.」
 *   원천 → (이 표의 수집기) → Firestore products(원자) → (resolveAtom) → 판매시트·ERP·화이트라벨.
 *   **거꾸로는 없다.** 판매시트·정제시트·ERP 화면에서 원자나 원천으로 «다시 쓰는» 경로를 만들지 않는다
 *   (사람이 시트 칸을 고쳐도 다음 수집 회차가 원천값으로 덮는다 — 시트는 «투영»이지 입력창이 아니다).
 *   예외는 «원천이 못 가진 값»(우리 쪽 정책·상태 오버레이)뿐이고, 그것도 원자 안에서만 오버레이한다 —
 *   시트를 거쳐 원자로 되먹임하지 않는다.
 *
 * ★원본 주소가 바뀌면 여기를 고친다. ★`policies` = 원본 재고탭에 줄별 조건 칸이 있어 정책 탭으로 옮길 곳.
 *   오토플러스는 조건 칸이 없고(「(프리패스 기본)」), 아이언은 홈페이지 공개조건을 정책 탭 RP006_WEB 에 손으로 박아 뒀다.
 */
export type MirrorSource = {
  code: string; name: string;
  kind: 'sheet' | 'iron';
  /** 원본 시트 ID(kind=sheet). iron 은 ironrentcar.com. */
  from?: string;
  /** 정제시트 「○○ 프리패스 재고」 ID. */
  to: string;
  policies: boolean;
  /** 원본에 없어 늘 비는 칸의 기본값(once 칸, 비어 있을 때만) — 오토플러스는 구분 칸이 없고 전부 중고렌트다. */
  defaults?: Record<string, string>;
};

export const MIRROR_SOURCES: MirrorSource[] = [
  { code: 'RP004', name: '아이카', kind: 'sheet', from: '1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w', to: '1-2ptJgwzPBVgDWMkyedjtVxcSXrNtepEQM0YgAVpYtI', policies: true },
  { code: 'RP023', name: '오토플러스', kind: 'sheet', from: '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U', to: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0', policies: false, defaults: { 분류: '중고렌트', 정책코드: '(프리패스 기본)' } },
  { code: 'RP031', name: '이안카', kind: 'sheet', from: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs', to: '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA', policies: true },
  { code: 'RP006', name: '아이언', kind: 'iron', to: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U', policies: false },
];

/**
 * ★사장님 2026-08-18 — 「너는 우리 제공 시트만 맡아」. 정제시트 4곳은 사장님·제미나이가 연동한다.
 *   우리 유지보수 도구(서식·글꼴·열 정리·정제칸 채움·정책 표기…)는 **기본으로 정제시트를 건너뛴다** — `--include-mirror` 로만 포함.
 */
export const MIRROR_SHEET_IDS = new Set(MIRROR_SOURCES.map((m) => m.to));
export const isMirrorSheet = (id: unknown) => MIRROR_SHEET_IDS.has(String(id ?? '').trim());
export const INCLUDE_MIRROR = process.argv.includes('--include-mirror');
/** 대상 목록에서 정제시트를 뺀다(--include-mirror 면 그대로). 뺀 이름을 한 줄 찍는다. */
export function excludeMirrorSheets<T extends { id: string; name?: string }>(targets: T[], log: (msg: string) => void = console.log): T[] {
  if (INCLUDE_MIRROR) return targets;
  const skipped = targets.filter((t) => isMirrorSheet(t.id));
  if (skipped.length) log(`  (정제시트 ${skipped.length}곳 제외 — 사장님 「너는 우리 제공 시트만 맡아」 · 포함하려면 --include-mirror: ${skipped.map((t) => t.name || t.id).join(' · ')})`);
  return targets.filter((t) => !isMirrorSheet(t.id));
}
