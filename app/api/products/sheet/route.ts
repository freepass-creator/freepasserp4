/**
 * **판매시트 보기 — ERP 가 문지기**(사장님 2026-08-20 「앞으로 상품시트 공유 안 하고 로그인해야만 보이게」).
 *
 * 지금까지는 브라우저가 구글시트로 직접 갔다. 그래서 «누가 보느냐»를 시트 공유설정이 정했고,
 * 실측해 보니 익명 CSV 로 358행 전량 + 소비자가격·차고지까지 열렸다.
 * 이 경로가 생기면 시트를 완전 비공개로 잠가도 ERP 안에서는 그대로 보인다 —
 * 문지기가 «구글 공유설정»에서 «ERP 로그인·역할»로 옮겨 온다.
 *
 * 역할별로 열을 가린다(MASKED). 원가·차고지는 관리자만 본다 — 이건 화면이 아니라 **여기서** 지운다.
 * 화면에서만 감추면 응답에는 값이 그대로 실려 개발자도구로 다 보인다.
 */
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { readSheetGrid, listSheetTabs } from '@/lib/server/google-sheets';
import { SALES_PUBLISHED_TAB_PREFIXES } from '@/lib/domain/sales-published-tabs';
import { PRODUCT_SHEET_ID } from '@/lib/product-sheet';
import { resolveSalesSheetProvider, salesSheetProviderIndex } from '@/lib/domain/sales-inventory-sheet';
import type { EntityRecord } from '@/lib/intake/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

/** 관리자만 보는 열. 시트 머리글 그대로 적는다(시트가 정본이라 여기서 이름을 바꾸지 않는다). */
const ADMIN_ONLY = new Set(['소비자가격', '차고지', '공급사', '매입가', '원가', '전용계좌', '계좌번호']);

const S = (value: unknown) => String(value ?? '').trim();
const plateKey = (value: unknown) => S(value).replace(/\s+/g, '');
const isDeleted = (value: Record<string, unknown>) => value._deleted === true
  || !!value.deletedAt
  || S(value.status) === 'deleted'
  || S(value.vehicle_status).replace(/\s+/g, '') === '출고불가';

/**
 * 판매시트의 값만으로 `/m/[code]` 를 만들면 안 된다.
 *
 * 상품 상세는 ERP product_code 를 열쇠로 삼지만 판매시트에는 그 값이 없다. 특히 일반
 * 사용자 응답에서는 공급사 열도 가리므로, 브라우저에서 차번을 추측 조합하면 중복·동기화
 * 지연 때 다른 차량 상세로 갈 수 있다. 여기서만 원본의 공급사+차량번호를 현재 ERP와
 * 정확히 맞춰, 한 건으로 확정된 행에만 불투명한 상세 주소를 붙인다.
 */
async function rowDetailHrefs(grid: { header: string[]; rows: string[][] }): Promise<Array<string | null>> {
  const empty = () => grid.rows.map(() => null);
  const plateAt = grid.header.findIndex((header) => /^(차량번호|차번|차량 번호)$/.test(S(header)));
  const providerAt = grid.header.findIndex((header) => /^(공급사|렌트사|제공사|업체명)$/.test(S(header)));
  if (plateAt < 0 || providerAt < 0) return empty();

  const db = firebaseAdminDatabase();
  const [productsSnap, partnersSnap, partnersV4Snap] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('partners').get(),
    db.ref('v4/partners').get(),
  ]);

  const partnerRows = new Map<string, EntityRecord>();
  for (const snapshot of [partnersSnap, partnersV4Snap]) {
    for (const [key, raw] of Object.entries((snapshot.val() || {}) as Record<string, Record<string, unknown>>)) {
      if (!raw || typeof raw !== 'object') continue;
      partnerRows.set(key, { ...(partnerRows.get(key) || {}), ...raw, _key: key } as EntityRecord);
    }
  }
  const providerIndex = salesSheetProviderIndex([...partnerRows.values()]);

  // 같은 product_code가 우연히 중복된 서로 다른 record도 "한 건"으로 오인하지 않는다.
  // Set으로 dedupe하면 그 경우 잘못된 상세 링크가 생기므로 record 수를 그대로 보존한다.
  const productKeysByVehicle = new Map<string, string[]>();
  for (const [key, raw] of Object.entries((productsSnap.val() || {}) as Record<string, Record<string, unknown>>)) {
    if (!raw || typeof raw !== 'object' || isDeleted(raw)) continue;
    const provider = S(raw.provider_company_code || raw.partner_code);
    const plate = plateKey(raw.car_number);
    // `v4/products`의 child key가 상품 화면·Finder adapter의 논리키다. 이관 잔재의
    // raw.product_code를 쓰면 같은 행의 상세 href와 현재 Finder record가 어긋날 수 있다.
    const productKey = S(key);
    if (!provider || !plate || !productKey) continue;
    const identity = `${provider}\u0000${plate}`;
    const keys = productKeysByVehicle.get(identity) || [];
    keys.push(productKey);
    productKeysByVehicle.set(identity, keys);
  }

  return grid.rows.map((row) => {
    const provider = resolveSalesSheetProvider(row[providerAt], providerIndex);
    const plate = plateKey(row[plateAt]);
    const keys = provider && plate ? productKeysByVehicle.get(`${provider}\u0000${plate}`) : undefined;
    // 동기화 중복·미반영은 첫 항목을 추측해 열지 않는다.
    return keys?.length === 1 ? `/m/${encodeURIComponent(keys[0])}` : null;
  });
}

/** 현재 발행된 판매 탭만 허용한다. 「상품리스트(구버전)」·AI 인계 같은 보이는 보조 탭은 ERP 응답에 절대 싣지 않는다. */
function publishedSalesTabs(tabs: string[]): string[] {
  return tabs.filter((title) => SALES_PUBLISHED_TAB_PREFIXES.some((prefix) =>
    title === prefix || title.startsWith(prefix + ' '),
  ));
}

export async function GET(request: Request): Promise<Response> {
  let actor;
  try {
    actor = await verifyActiveBearer(request);
  } catch {
    return NextResponse.json({ error: 'auth unavailable' }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!actor) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: PRIVATE_HEADERS });
  const isAdmin = actor.role === 'admin';

  try {
    const tabs = publishedSalesTabs(await listSheetTabs(PRODUCT_SHEET_ID));
    const want = String(new URL(request.url).searchParams.get('tab') || '').trim();
    // 클라이언트가 서버가 준 정확한 탭 이름만 다시 요청할 수 있다. prefix/임의 탭 보정은
    // 「AI 인계」 같은 보조 탭을 우회 조회할 수 있어 하지 않는다.
    const tab = want ? tabs.find((title) => title === want) : tabs[0];
    if (!tab) return NextResponse.json({ error: want ? 'tab unavailable' : 'no published tab' }, { status: 404, headers: PRIVATE_HEADERS });

    const grid = await readSheetGrid(PRODUCT_SHEET_ID, tab);
    const hide = isAdmin ? [] : grid.header.map((h, i) => (ADMIN_ONLY.has(h.trim()) ? i : -1)).filter((i) => i >= 0);
    const drop = (r: string[]) => (hide.length ? r.filter((_, i) => !hide.includes(i)) : r);
    // 상세 이동 메타데이터가 잠시 못 만들어져도 시트 읽기 자체는 실패시키지 않는다.
    const detailHrefs = await rowDetailHrefs(grid).catch((error) => {
      console.warn('[api/products/sheet] detail links unavailable', error instanceof Error ? error.message : 'unknown');
      return grid.rows.map(() => null);
    });

    return NextResponse.json({
      tabs,
      tab: grid.tab,
      header: drop(grid.header),
      rows: grid.rows.map(drop),
      rowDetailHrefs: detailHrefs,
      // 원본 Google Sheet는 ERP의 역할별 마스킹을 거치지 않는다. 따라서 이 주소는
      // ERP admin에게만 내보내며, 실제 열람은 Google Drive ACL이 한 번 더 결정한다.
      originalSheetHref: isAdmin ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(PRODUCT_SHEET_ID)}/edit` : undefined,
      readAt: grid.readAt,
      maskedColumns: hide.map((i) => grid.header[i]),
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    // 시트가 잠긴 뒤 서비스계정 공유가 안 돼 있으면 여기로 온다 — 화면이 무엇을 해야 하는지 말해 준다.
    const message = String((error as { message?: unknown })?.message || error);
    return NextResponse.json({ error: 'sheet unavailable', detail: message }, { status: 502, headers: PRIVATE_HEADERS });
  }
}
