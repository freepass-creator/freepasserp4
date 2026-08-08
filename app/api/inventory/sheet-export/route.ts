import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { SheetsClient } from '@/lib/server/google-sheets-writer';
import {
  attachPolicy, buildInventorySheet, exportTabName, policyMap, sortForSales,
} from '@/lib/domain/inventory-sheet-export';
import { isListableProduct } from '@/lib/domain/product';

/** 영업자가 늘 보는 고정 탭. 이름을 바꾸면 영업자 즐겨찾기가 끊긴다. */
const AGENT_SHEET_TAB = '상품리스트';
import type { EntityRecord } from '@/lib/intake/entities';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const S = (v: unknown) => String(v ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type Rec = Record<string, any>;
const dead = (p: Rec) => p._deleted === true || !!p.deletedAt || S(p.status) === 'deleted';

/**
 * 재고 → 영업자용 구글시트 내보내기.
 *
 * 누를 때마다 **새 탭을 맨 왼쪽에** 만든다. 지난 회차는 이력으로 남고, 지우는 건 관리자 몫이다.
 * 표 정의는 `lib/domain/inventory-sheet-export.ts` 하나만 쓴다(CLI 와 공용).
 */
export async function POST(request: Request) {
  const spreadsheetId = S(process.env.INVENTORY_EXPORT_SHEET_ID);
  if (!spreadsheetId) return json({ error: '내보낼 구글시트가 설정되지 않았습니다(INVENTORY_EXPORT_SHEET_ID).' }, 503);

  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  // 전 공급사 재고가 한 장에 나가므로 관리자만 허용한다.
  if (actor.role !== 'admin') return json({ error: '관리자만 내보낼 수 있습니다.' }, 403);

  try {
    const db = firebaseAdminDatabase();
    // 정책(연령·보험·심사)은 별도 노드다 — 같이 읽어 조인하지 않으면 그 열이 통째로 빈다.
    const [productsSnap, v3Partners, v4Partners, v3Policies, v4Policies] = await Promise.all([
      db.ref('v4/products').get(),
      db.ref('partners').get(),
      db.ref('v4/partners').get(),
      db.ref('policies').get(),
      db.ref('v4/policies').get(),
    ]);
    const policies = policyMap(v3Policies.val() || {}, v4Policies.val() || {});

    const partners: Record<string, Rec> = {};
    for (const raw of [v3Partners.val() || {}, v4Partners.val() || {}] as Record<string, Rec>[]) {
      for (const [key, row] of Object.entries(raw)) {
        if (row && typeof row === 'object') partners[key] = { ...(partners[key] || {}), ...row, _key: key };
      }
    }
    // ★대상이 공급사 원본 시트면 중단한다 — 덮어쓰면 재고 정본이 사라진다.
    const idOf = (url: string) => (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
    for (const partner of Object.values(partners)) {
      if (S(partner.sheet_url) && idOf(S(partner.sheet_url)) === spreadsheetId) {
        return json({ error: '중단 — 내보내기 대상이 공급사 원본 시트입니다. 설정을 확인하세요.' }, 409);
      }
    }
    // 코드가 비면 «아무 공급사나» 걸리므로 먼저 끊는다 — 빈 문자열은 _key·partner_code 어느 쪽과도 매칭시키지 않는다.
    const nameOf = (code: string) => {
      if (!code) return '';
      const hit = Object.values(partners).find((p) => S(p.partner_code) === code || S(p._key) === code);
      return S(hit?.partner_name || hit?.company_name);
    };

    const products = Object.entries((productsSnap.val() || {}) as Record<string, Rec>)
      .filter(([, p]) => p && typeof p === 'object' && !dead(p))
      .map(([key, p]) => ({ ...p, _key: key, product_code: p.product_code || key } as EntityRecord))
      .filter((p) => isListableProduct(p))
      .map((p) => attachPolicy(p, policies));
    const rows = sortForSales(products);

    const client = await SheetsClient.open(spreadsheetId);
    /**
     * 영업자가 보는 것은 **한 장**이어야 한다.
     * 예전에는 누를 때마다 새 탭을 만들어, 연동을 반영할 때마다 탭이 쌓이고 영업자는
     * 어느 것이 «지금»인지 매번 골라야 했다. 고정 탭 하나를 늘 최신으로 덮어쓴다.
     * 이력이 필요하면 `?snapshot=1` 로 날짜 탭을 따로 만든다.
     */
    const snapshot = new URL(request.url).searchParams.get('snapshot') === '1';
    const meta = await client.meta();
    const { gid, title } = snapshot
      ? await client.addLeftmostTab(exportTabName(rows.length), meta.sheets.map((s) => s.properties.title))
      : await client.openOrCreateTab(AGENT_SHEET_TAB);
    // 실패해도 값은 이미 들어갔으므로 오류를 삼키지 않는다.
    // 카탈로그 링크 주소 — 설정이 없으면 이 요청이 들어온 곳(=지금 fp4 를 서비스하는 주소).
    // freepasserp.com 을 박아 두면 도메인 전환 전까지 erp3 로 가서 링크가 죽는다.
    const linkOrigin = S(process.env.INVENTORY_EXPORT_ORIGIN) || new URL(request.url).origin;
    const built = buildInventorySheet(gid, rows, nameOf, { bandedRangeIds: [], conditionalCount: 0, merges: 0 }, linkOrigin);
    await client.write(title, built.values);
    await client.batchUpdate(built.requests);

    return json({
      ok: true,
      count: rows.length,
      tab: title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[sheet-export] failed', message);
    return json({ error: `시트 내보내기 실패 — ${message}` }, 502);
  }
}
