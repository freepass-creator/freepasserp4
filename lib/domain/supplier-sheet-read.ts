/**
 * **공급사 시트를 읽는 단 하나의 규격.** 재고를 세거나 유입하는 모든 코드가 여기를 통한다.
 *
 * ⚠⚠ **이 파일의 규칙을 바꾸지 마라.** 바꾸면 재고 대수가 조용히 틀어진다.
 *   2026-08-10 하루 동안 아래 네 가지를 안 지킨 감사 도구들이
 *   「유입 안 된 차 1,499대」·「오토플러스 못 읽음」·「아이카 5,170행」 같은 거짓 숫자를 냈고,
 *   그 숫자를 보고 고치려다 멀쩡한 데이터를 지울 뻔했다.
 *   규칙을 손대야 한다면 먼저 `sim-supplier-sheet-read` 를 고치고, 왜 바꾸는지 여기 적어라.
 *
 * ── 지켜야 할 네 가지 ──────────────────────────────────────────────
 *
 * ① **숨긴 행은 없는 행이다** (`hiddenByFilter` · `hiddenByUser`)
 *    공급사가 화면에서 내린 매물이다. CSV export 나 values API 는 이걸 그대로 준다 —
 *    그래서 raw values 로 읽으면 이미 뺀 차가 재고로 되살아난다.
 *    실측: 오플 39행 · 스타 12 · 웰릭스 6 · 손오공 4.
 *
 * ② **숨긴 탭도 없는 탭이다**
 *    「숨긴 거는 안 가져온다」는 행에만 걸리는 말이 아니다(사장님 2026-08-10).
 *    공급사는 안 쓰는 표를 지우지 않고 숨긴다 — 오플 10탭 중 7개, 아이카 8탭 중 7개가 그랬다.
 *    숨긴 탭까지 읽으면 옛 사본·프로모션 잔재가 재고로 잡힌다.
 *
 * ③ **`sheet_tab` 은 gid 를 여러 개 담을 수 있다** (쉼표 구분)
 *    빌린카 = `0,1718488412,1505082236` (빌린카·엘씨렌트·빌린카구독).
 *    하나로만 비교하면 그 공급사가 통째로 «못 읽음»이 된다.
 *    값이 있으면 사람이 일부러 좁힌 것이므로 그 탭만 본다. 비어 있으면 «보이는 탭 전부».
 *    단 지정한 탭이 **숨김이면 그래도 안 읽는다** — 숨겼다는 건 공급사가 안 쓴다는 뜻이고
 *    그게 우리 지정보다 세다(`visibleRowsFromGridResponse` 가 막는다). 대신 `failures` 로 드러난다.
 *
 * ④ **헤더 행은 어댑터가 찾는다** (`resolveAdapter(partner).prepareTable`)
 *    1행이 헤더라는 보장이 없다. 오토플러스는 진짜 헤더 위에 배너가 있고 요금 헤더가 두 줄이다.
 *    1행을 헤더로 박으면 그 시트는 통째로 안 읽힌다.
 *
 * ⚠ 시트가 정본이 아닌 공급사가 있다. 아이언(RP006)은 `ironrentcar.com` 수집이 정본이라
 *   시트로 판단하면 안 된다 — `NOT_SHEET_BACKED` 참고.
 *
 * ⚠ 못 읽은 시트는 **「0대」가 아니라 「모름」**이다. 호출부는 `failures` 를 반드시 사람에게 보여라.
 *   조용히 넘기면 전부 실패해도 「어긋남 없음」으로 보인다.
 */
import { resolveAdapter } from './sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from './sheet-visible-grid';
import type { EntityRecord } from '@/lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();

/** 시트가 정본이 아닌 공급사 — 시트에 없다고 «없는 차»로 판단하면 안 된다. */
export const NOT_SHEET_BACKED = new Set(['RP006']);   // 아이언 = ironrentcar.com 수집

/** 격자를 한 번에 받을 때 쓰는 필드 마스크. `hidden` 이 빠지면 ②가 조용히 무력화된다. */
export const SHEET_GRID_FIELDS =
  'sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue))))';

export function sheetIdFromUrl(url: unknown): string {
  return (S(url).match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1] || '';
}

export type SupplierTab = {
  gid: string;
  title: string;
  /** 어댑터가 헤더 행을 고른 뒤의 표. 0행이 헤더다. */
  table: string[][];
  /** 숨김으로 빠진 행 수 — 「왜 줄었나」를 사람이 볼 수 있어야 한다. */
  hiddenRows: number;
};

export type SupplierSheetRead = {
  tabs: SupplierTab[];
  /** 탭 단위 실패. 비어 있지 않으면 그 공급사 숫자는 «모름»이 섞인 것이다. */
  failures: { gid: string; title: string; reason: string }[];
};

/**
 * 파트너 하나의 시트를 규격대로 읽는다.
 *
 * `grid` 는 `SHEET_GRID_FIELDS` 로 받은 응답이어야 한다 — 필드가 빠지면 숨김 판정이 죽는다.
 * 탭 하나가 실패해도 나머지는 읽는다. 실패는 버리지 않고 `failures` 로 돌려준다.
 */
export function readSupplierSheet(grid: SheetsGridResponse, partner: EntityRecord): SupplierSheetRead {
  const adapter = resolveAdapter(partner);
  const pinned = new Set(S((partner as Record<string, unknown>).sheet_tab).split(',').map(S).filter(Boolean));
  const headerRow = Number((partner as Record<string, unknown>).sheet_header_row) || undefined;
  const tabs: SupplierTab[] = [];
  const failures: SupplierSheetRead['failures'] = [];

  for (const sheet of (grid.sheets || []) as Record<string, any>[]) {
    const gid = String(sheet.properties?.sheetId ?? '');
    const title = S(sheet.properties?.title);
    // ③ 지정이 있으면 그 탭만 · 없으면 ② 보이는 탭만
    if (pinned.size ? !pinned.has(gid) : sheet.properties?.hidden === true) continue;

    const rowCount = (sheet.data?.[0]?.rowData || []).length;
    let visible: string[][];
    try {
      // ① 숨긴 행 제외
      visible = (visibleRowsFromGridResponse(grid, gid) as { rows: string[][] }).rows;
    } catch (e) {
      failures.push({ gid, title, reason: `숨김 판정 실패 — ${(e as Error).message}` });
      continue;
    }
    let table: string[][];
    try {
      // ④ 헤더 행은 어댑터가 고른다
      table = adapter.prepareTable(visible, { headerRow });
    } catch (e) {
      failures.push({ gid, title, reason: (e as Error).message });
      continue;
    }
    tabs.push({ gid, title, table, hiddenRows: Math.max(0, rowCount - visible.length) });
  }
  return { tabs, failures };
}

/** 표에서 상태·차번 열을 찾는다. 둘 다 없으면 그 탭은 차량 표가 아니다. */
export function findPlateAndStatusColumns(header: string[]): { plate: number; status: number } {
  const h = header.map(S);
  return {
    plate: h.findIndex((c) => /차량번호|차번/.test(c)),
    status: h.findIndex((c) => /배차상태|^상태|판매상태|재고상태|출고상태|출고현황/.test(c)),
  };
}
