/**
 * 「프리패스 상품리스트」 시트에 우리 재고를 «우리 규격»으로 쓴다.
 *
 * 화면의 «반영하기» 가 붙을 자리와 같은 코드를 쓴다(lib/domain/product-sheet-export + lib/server/google-sheets).
 * 스크립트로 먼저 두는 이유는 UI 를 건드리지 않고 끝까지 검증하기 위해서다 —
 * SheetSync.tsx 는 지금 재고 연동 작업이 물고 있어서 같이 손대면 충돌한다.
 *
 * 대상 판정은 화면과 같은 함수(isOfferableProduct)를 쓴다. 스크립트가 자기만의 기준을 만들면
 * 시트와 화면의 대수가 달라지고, 그 차이를 나중에 아무도 설명 못 한다.
 *
 *   npx tsx scripts/export-products-to-sheet.mts            대상 집계만(쓰기 없음)
 *   npx tsx scripts/export-products-to-sheet.mts --apply    시트에 쓴다
 *   ... --sheet=<스프레드시트ID>  ... --tab=<탭이름>
 */
import { readFileSync } from 'node:fs';
import { isOfferableProduct } from '../lib/domain/product.ts';
import {
  PRODUCT_SHEET_COLUMNS, PRODUCT_SHEET_HEADER, STATUS_COLUMN_INDEX,
  productSheetRow, sortForSheet,
} from '../lib/domain/product-sheet-export.ts';
import { writeSheetTable, sheetsServiceAccountEmail } from '../lib/server/google-sheets.ts';

// 로컬 실행용 자격증명 — 다른 감사 스크립트와 같은 기본 경로.
// 라이브러리(lib/server/google-sheets)는 환경변수만 본다. 운영에서 파일 경로에 기대지 않게 하려는 것이라
// 기본값은 여기(스크립트)에서만 채운다.
process.env.GOOGLE_APPLICATION_CREDENTIALS ||= 'tmp/firebase-auth/sa.json';

const APPLY = process.argv.includes('--apply');
const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const SHEET_ID = arg('sheet', '1G0tPyFI4JIfc-Ijd5qJNbgPGzcs2Ek5hQJwDHuml8VU');
const TAB = arg('tab', '시트1');

const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  const [p3, p4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);

  // 필드 단위 병합 — 키 단위로 합치면 v4 부분패치가 v3 필드를 통째로 날린다(실제로 겪은 사고).
  const merge = (a: unknown, b: unknown) => {
    const m = new Map<string, Rec>();
    for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m.set(k, { ...v, _key: k });
    for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m.set(k, { ...(m.get(k) || {}), ...v, _key: k });
    return m;
  };

  const partners = merge(t3.val(), t4.val());
  const nameOf = new Map<string, string>();
  for (const p of partners.values()) {
    const code = S(p.company_code || p.partner_code || p._key);
    const name = S(p.company_name || p.name || p.partner_name);
    if (code && name) nameOf.set(code, name);
  }

  const products = [...merge(p3.val(), p4.val()).values()]
    .filter((p) => p._deleted !== true && S(p.status) !== 'deleted');

  // 테스트 데이터는 «남에게 보여주는» 시트에 절대 나가면 안 된다.
  // 한 번 지우는 것으로는 재발한다 — QA 공급사는 오픈 스모크용으로 계속 살아 있기 때문이다.
  // 그래서 지우는 것과 별개로, 내보내는 길목에서 항상 막는다.
  const TEST_MARK = /(\[QA\]|^QA[\s_-]|테스트|test\b|샘플|sample|dummy|더미)/i;
  const testCodes = new Set<string>();
  for (const p of partners.values()) {
    const code = S(p.company_code || p.partner_code || p._key);
    if (code && (TEST_MARK.test(S(p.company_name || p.name || p.partner_name)) || TEST_MARK.test(code))) testCodes.add(code);
  }

  const offerable = products.filter((p) => isOfferableProduct(p as never));
  const excluded = offerable.filter((p) => testCodes.has(S(p.provider_company_code)));
  const clean = offerable.filter((p) => !testCodes.has(S(p.provider_company_code)));
  if (excluded.length) console.log(`\n  ⚠ 테스트 공급사 매물 ${excluded.length}대 제외: ${excluded.map((p) => S(p._key)).join(' · ')}`);
  const rows = sortForSheet(clean.map((p) => productSheetRow(p as never, nameOf.get(S(p.provider_company_code)) || '')));

  const byProvider = new Map<string, number>();
  for (const r of rows) byProvider.set(String(r[0] || '(미상)'), (byProvider.get(String(r[0] || '(미상)')) || 0) + 1);

  console.log(`\n══ 프리패스 상품리스트 ══\n`);
  console.log(`  살아있는 매물 ${products.length}대 · 게시 가능 ${rows.length}대 · 열 ${PRODUCT_SHEET_HEADER.length}개`);
  console.log(`  대상 시트 ${SHEET_ID} · 탭 「${TAB}」\n`);
  console.log('  공급사별');
  for (const [name, n] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${name.padEnd(16)} ${String(n).padStart(4)}대`);
  }

  if (!APPLY) {
    console.log(`\n  표본 1행: ${rows[0]?.slice(0, 8).join(' · ')}`);
    console.log(`\n※ dry-run. 시트에 쓰려면 --apply`);
    console.log(`   서비스계정 ${sheetsServiceAccountEmail()} 가 편집자여야 한다.\n`);
    return;
  }

  const stamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const res = await writeSheetTable({
    spreadsheetId: SHEET_ID,
    tabTitle: TAB,
    columns: PRODUCT_SHEET_COLUMNS,
    rows,
    statusColumnIndex: STATUS_COLUMN_INDEX,
    caption: `프리패스 상품리스트 — ${rows.length}대 · ${stamp} 기준 (자동 생성, 직접 수정하면 다음 반영 때 덮어써집니다)`,
  });
  console.log(`\n✅ 시트 반영 완료 — 「${res.tabTitle}」 ${res.rows}행\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n실패: ${e.message}\n`); process.exit(1); });
