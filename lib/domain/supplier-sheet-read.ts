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
 * ⚠ 시트가 정본이 아닌 공급사가 있었다. 아이언(RP006)은 `ironrentcar.com` 수집이 정본이라 시트로 판단하지 않았다.
 *   2026-08-18부터 아이언도 **정제시트** 「아이언 프리패스 재고」를 둔다(홈페이지 → 미러 `sync-mirror-sheet --source=iron`) —
 *   사장님 「상품마스터로 올 때는 어찌됐든 정제시트 통해서」. 문패가 그 시트를 가리키므로 이제 시트로 읽는다. `NOT_SHEET_BACKED` 는 비었다.
 *
 * ⚠ 못 읽은 시트는 **「0대」가 아니라 「모름」**이다. 호출부는 `failures` 를 반드시 사람에게 보여라.
 *   조용히 넘기면 전부 실패해도 「어긋남 없음」으로 보인다.
 */
import { firstPlateBlockAfterHeader, orderSheetGids, resolveAdapter } from './sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from './sheet-visible-grid';
import type { EntityRecord } from '@/lib/intake/entities';
import { isExactRealPlate } from '@/lib/domain/product';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * 시트가 정본이 아닌 공급사 — 시트에 없다고 «없는 차»로 판단하면 안 된다.
 * ★2026-08-18 비움 — 아이언(RP006)도 정제시트(홈페이지 미러)를 두고 문패가 그것을 가리킨다.
 *   ⚠ ERP 쪽 홈페이지 직접 반영 UI(`/api/inventory/ironrentcar/*`)는 아직 살아 있다 — 같은 차를 두 길로 쓰지 않도록
 *     정제시트→상품마스터 길이 자리 잡으면 그 UI는 내리거나 «검증 전용»으로 둔다(ERP 연동 오더에서 판단).
 */
export const NOT_SHEET_BACKED = new Set<string>([]);

/** 격자를 한 번에 받을 때 쓰는 필드 마스크. `hidden` 이 빠지면 ②가 조용히 무력화된다. */
/**
 * ⚠ 맨 앞 `properties.title` 은 **문서 이름**이다(탭 이름이 아니다).
 *   그걸로 «우리가 만든 시트인가»를 가른다 — 대수를 셀 때 우리 시트/아닌 시트를 나눠야 하기 때문이다
 *   (사장님 2026-08-14 — 「대수를 말할 때는 우리 시트 몇 대, 아닌 시트 몇 대에 총 몇 대로」).
 */
export const SHEET_GRID_FIELDS =
  'properties.title,sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue,hyperlink,chipRuns(chip(richLinkProperties(uri)))))))';

/** 읽기 전용 Sheets 호출에서 재시도해도 안전한 일시 오류만 구분한다. */
export function isRetryableSheetsReadFailure(status: number, message: unknown): boolean {
  const text = S(message);
  return status === 429
    || status >= 500
    || /quota exceeded|rate limit|429|temporarily unavailable|backend error/i.test(text);
}

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
  /** 차량번호 셀/행에서 추출한 공급사 상세·사진 링크. */
  photoByPlate: Record<string, string>;
};

export type SupplierSheetRead = {
  tabs: SupplierTab[];
  /** 탭 단위 실패. 비어 있지 않으면 그 공급사 숫자는 «모름»이 섞인 것이다. */
  failures: { gid: string; title: string; reason: string; vehicleLike?: boolean }[];
};

export type SupplierSheetFetchOptions = {
  /** 관리자 전용 Sheets API 프록시에 전달할 Firebase ID token. */
  authorization?: string;
};

export type SupplierSheetFetcher = (
  url: string,
  partner: EntityRecord,
  options?: SupplierSheetFetchOptions,
) => Promise<SupplierSheetRead>;

/** 브라우저에서도 서버·감사 스크립트와 같은 통합 Grid 규격으로 읽는다. */
export async function fetchSupplierSheet(
  url: string,
  partner: EntityRecord,
  options: SupplierSheetFetchOptions = {},
): Promise<SupplierSheetRead> {
  const pinned = S(partner.sheet_gid || partner.sheet_tab)
    .split(/[,\s|]+/).map(S).filter(Boolean);
  const query = new URLSearchParams({ url, visible: 'all' });
  if (pinned.length) query.set('gids', pinned.join(','));
  let response: Response;
  try {
    response = await fetch(`/api/sheet?${query.toString()}`, {
      cache: 'no-store',
      headers: options.authorization ? { Authorization: `Bearer ${options.authorization}` } : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError'
      ? '공급사 통합 시트 서버 무응답 90초 초과'
      : `공급사 통합 시트 요청 실패 — ${String((error as Error)?.message || error)}`);
  }
  const body = await response.json().catch(() => ({ ok: false, error: '응답 파싱 실패' })) as {
    ok?: boolean;
    error?: string;
    grid?: SheetsGridResponse;
  };
  if (!body.ok || !body.grid) throw new Error(body.error || `공급사 통합 시트 로드 실패 (${response.status})`);
  return readSupplierSheet(body.grid, partner);
}

/**
 * 파트너 하나의 시트를 규격대로 읽는다.
 *
 * `grid` 는 `SHEET_GRID_FIELDS` 로 받은 응답이어야 한다 — 필드가 빠지면 숨김 판정이 죽는다.
 * 탭 하나가 실패해도 나머지는 읽는다. 실패는 버리지 않고 `failures` 로 돌려준다.
 */
export function readSupplierSheet(grid: SheetsGridResponse, partner: EntityRecord): SupplierSheetRead {
  /**
   * ★**우리 규격시트(「○○ 프리패스 재고」)는 언제나 generic 으로 읽는다.**
   *   오토플러스 어댑터는 6·7열을 최초등록·주행거리로 «못 박는다»(원본이 무라벨이라). 그걸 우리 정제시트에
   *   대면 「옵션·외부색상」이 그 이름으로 바뀌어 통째로 어긋난다(2026-08-18 — 문패가 정제시트로 넘어가면서 생긴 길).
   *   문서 이름으로 가른다 — 정제시트는 이름 규칙이 하나다(`supplier-template-sheet.SHEET_NAME_MATCH`).
   */
  const bookTitle = S((grid as { properties?: { title?: unknown } }).properties?.title);
  const adapter = /프리패스\s*재고/.test(bookTitle) ? resolveAdapter('generic') : resolveAdapter(partner);
  const pinnedValues = S((partner as Record<string, unknown>).sheet_gid || (partner as Record<string, unknown>).sheet_tab)
    .split(/[,\s|]+/).map(S).filter(Boolean);
  const pinned = new Set(pinnedValues);
  const headerRow = Number(
    (partner as Record<string, unknown>).sheet_header_row
      ?? (partner as Record<string, unknown>).header_row,
  ) || undefined;
  const tabs: SupplierTab[] = [];
  const failures: SupplierSheetRead['failures'] = [];

  for (const sheet of (grid.sheets || []) as Record<string, any>[]) {
    const gid = String(sheet.properties?.sheetId ?? '');
    const title = S(sheet.properties?.title);
    // ③ 지정이 있으면 그 탭만 · 없으면 ② 보이는 탭만
    if (pinned.size ? !pinned.has(gid) : sheet.properties?.hidden === true) continue;

    const rowCount = (sheet.data?.[0]?.rowData || []).length;
    let visible: string[][];
    let photoByPlate: Record<string, string> = {};
    try {
      // ① 숨긴 행 제외
      const parsed = visibleRowsFromGridResponse(grid, gid) as { rows: string[][]; photoByPlate: Record<string, string> };
      visible = parsed.rows;
      photoByPlate = parsed.photoByPlate || {};
    } catch (e) {
      failures.push({ gid, title, reason: `숨김 판정 실패 — ${(e as Error).message}`, vehicleLike: pinned.has(gid) });
      continue;
    }
    let table: string[][];
    try {
      // ④ 헤더 행은 어댑터가 고른다
      table = adapter.prepareTable(visible, { headerRow });
      // 오토플러스는 헤더 아래 안내·여백이 자주 밀린다. 첫 현재재고 블록만 읽고
      // 빈 행 아래 과거 이력은 제외한다.
      if (adapter.id === 'autoplus') table = firstPlateBlockAfterHeader(table);
    } catch (e) {
      const vehicleLike = visible.some((row) => row.some((cell) =>
        isExactRealPlate(S(cell).replace(/\s/g, ''))));
      failures.push({ gid, title, reason: (e as Error).message, vehicleLike });
      continue;
    }
    tabs.push({ gid, title, table, hiddenRows: Math.max(0, rowCount - visible.length), photoByPlate });
  }
  for (const gid of pinnedValues) {
    if (!tabs.some((tab) => tab.gid === gid) && !failures.some((failure) => failure.gid === gid)) {
      failures.push({ gid, title: gid, reason: `지정 탭 없음(gid ${gid})`, vehicleLike: true });
    }
  }
  if (pinnedValues.length) {
    const priority = new Map(orderSheetGids(adapter, pinnedValues).map((gid, index) => [gid, index]));
    tabs.sort((a, b) => (priority.get(a.gid) ?? 999) - (priority.get(b.gid) ?? 999));
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
