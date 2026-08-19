/**
 * **정제시트(우리 규격) ← 공급사 원본** 연결표. `scripts/sync-mirror-all.mts` 가 이 표대로 돈다.
 *
 * ★사장님 2026-08-18 — 「아이카·오토플러스·아이언·이안카 정제시트 만들어서 실시간 연동시켜놓을게」 ·
 *   「상품마스터로 올 때는 어찌됐든 정제시트 통해서 상품마스터로 연동되는 거로」.
 *   문패(공급사시트정리)는 이 네 곳 모두 **정제시트**를 가리킨다(2026-08-18 15:30 전환). 원본은 여기에만 적는다.
 * ★원본 주소가 바뀌면 여기를 고친다(문패는 정제시트라 안 바뀐다). 원천대장 「시트 지도」에도 같은 내용이 실린다.
 * ★`policies` = 원본 재고탭에 줄별 조건 칸(대인·대물·자차…)이 있어 정책 탭으로 옮길 곳(`sync-mirror-policies`).
 *   오토플러스는 조건 칸이 없고(「(프리패스 기본)」), 아이언은 홈페이지 공개조건을 정책 탭 RP006_WEB 에 손으로 박아 뒀다.
 * ★다른 자체시트 공급사(손오공·리더스·스타·렌트존·우리캐피탈·SA·오플)는 아직 문패가 자기 시트다 — 여기 넣으면 미러만 돈다(문패 전환은 따로).
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
