/**
 * **축이 실제로 «어디서 입력되어 어디까지 갔는지» 한 줄로 본다.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-22 「그럼 오류 없게끔 만들어줘 · 어떤 게 어디에서 입력되어서 어떻게 상품리스트에 반영되고 그게 ERP 로 가는지」)
 *   형식 검사(열이 있나)만으로는 **값이 새는 걸 못 잡는다.** 실제로 세부모델이 100%→33% 로 떨어진 채 사흘을 갔고,
 *   그동안 `check-pipeline-contracts`(열 있나)도 `audit-sheet-erp-parity`(차가 ERP 에 있나)도 초록이었다.
 *   이 명령은 축마다 **공급사 시트 → 판매시트 → ERP** 세 지점의 채움률을 재고,
 *   `sales-axis-registry` 가 선언한 문턱 밑으로 떨어지면 **실패(exit 1)** 한다.
 *
 *   npx tsx scripts/audit-axis-coverage.mts          # 보기만
 *   npx tsx scripts/audit-axis-coverage.mts --gate   # 문턱 미달이면 exit 1 (자동 동기·배포 전 게이트)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_AXES } from '../lib/domain/sales-axis-registry';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { SHEET_NAME_MATCH, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { isOfferableProduct } from '../lib/domain/product';

const GATE = process.argv.includes('--gate');
const S = (v: unknown) => String(v ?? '').trim();
const filled = (v: unknown) => { const t = S(v); return !!t && !/^[-–—.]+$/.test(t); };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
// ⚠ 위임(subject)과 RTDB 스코프를 한 클라이언트에 섞으면 401 unauthorized_client 가 난다 — 반드시 나눈다.
const dbJwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const call = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await sheetJwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const SALES_SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';

/** 정제칸 이름은 레지스트리가 안다(`refinedColumn`) — 스크립트마다 따로 적으면 갈린다. */
const refinedNameOf = (column: string) =>
  SALES_AXES.find((a) => a.column === column)?.refinedColumn ?? column;

// ── ① 공급사 시트(정제칸)
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const supplierCount = new Map<string, { filled: number; total: number }>();
for (const f of (found.files || [])) {
  const meta = await call(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  for (const sh of (meta.sheets || [])) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ700`)}`);
    const rows = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = rows[hi];
    const body = rows.slice(hi + 1).filter((r) => S(r[head.indexOf('차량번호')]));
    for (const axis of SALES_AXES) {
      const name = refinedNameOf(axis.column);
      const i = head.indexOf(name);
      const cur = supplierCount.get(axis.column) || { filled: 0, total: 0 };
      cur.total += body.length;
      if (i >= 0) cur.filled += body.filter((r) => filled(r[i])).length;
      supplierCount.set(axis.column, cur);
    }
    break;
  }
  await sleep(120);
}

// ── ② 판매시트 3탭
const meta = await call(`${SH}/${SALES_SHEET}?fields=sheets.properties(title,hidden)`);
const titles = (meta.sheets || []).filter((s: any) => !s.properties.hidden).map((s: any) => S(s.properties.title));
const salesCount = new Map<string, { filled: number; total: number }>();
for (const t of pickPublishedSalesTabs(titles)) {
  const v = await call(`${SH}/${SALES_SHEET}/values/${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ700`)}`);
  const rows = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  const head = rows[hi] || [];
  const body = rows.slice(hi + 1).filter((r) => S(r[head.indexOf('차량번호')]));
  for (const axis of SALES_AXES) {
    const i = head.indexOf(axis.column);
    const cur = salesCount.get(axis.column) || { filled: 0, total: 0 };
    cur.total += body.length;
    if (i >= 0) cur.filled += body.filter((r) => filled(r[i])).length;
    salesCount.set(axis.column, cur);
  }
}

// ── ③ ERP(판매가능만 — 출고불가는 값이 낡아도 손님에게 안 나간다)
const tok = (await dbJwt.getAccessToken()).token;
const all = await (await fetch(`https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app/v4/products.json?access_token=${tok}`)).json() as Record<string, any>;
const sellable = Object.entries(all).map(([k, p]) => ({ ...p, _key: k })).filter((p) => isOfferableProduct(p as any));

const pct = (n: { filled: number; total: number } | undefined) => (n && n.total ? Math.round((n.filled / n.total) * 100) : 0);

console.log('■ 축이 어디서 들어와 어디까지 갔나 — 공급사 정제칸 ▶ 판매시트 ▶ ERP\n');
console.log('축'.padEnd(10) + '정제칸'.padEnd(9) + '판매시트'.padEnd(11) + 'ERP'.padEnd(9) + '문턱(시트/ERP)'.padEnd(16) + '판정');
console.log('─'.repeat(78));

/**
 * **값의 «꼴»이 맞나** — 채움률이 초록인데 내용이 엉뚱한 경우를 잡는다.
 *
 * ⚠ 2026-09-05 실측: Km 축은 시트 95% · ERP 96% 로 이 표가 초록이었는데,
 *   76대의 주행거리 칸에 「블랙」·「화이트」 같은 **색 이름**이 들어 있었다(RP023 72 · RP004 4).
 *   그 차들은 외장·내장이 비어 있다 — 열이 밀린 것이다. 「채워져 있다」와 「맞는 값이다」는 다르다.
 * ★값이 «있는» 칸만 센다 — 빈 칸은 채움률이 이미 보고 있다.
 */
const offShape = (v: unknown) => {
  const t = S(v);
  if (!filled(t)) return false;
  return !/^\d[\d,.\s]*(km|킬로|만km|년|cc|인승|원|만원)?$/i.test(t.replace(/\s+/g, ' '));
};

let bad = 0;
let shapeBad = 0;
const shapeReport: string[] = [];
for (const axis of SALES_AXES) {
  // 정제칸에서 오지 않는 축(연식·Km·공급사 원문)은 «정제칸 채움률»이라는 말 자체가 성립하지 않는다 — 0% 로 찍으면 사고로 읽힌다.
  const sup = axis.fromRefined ? `${pct(supplierCount.get(axis.column))}%` : '—';
  const sal = pct(salesCount.get(axis.column));
  const erpN = axis.erpField ? sellable.filter((p) => filled((p as any)[axis.erpField!])).length : 0;
  const erp = sellable.length ? Math.round((erpN / sellable.length) * 100) : 0;
  let under = sal < axis.minFillSheet || erp < axis.minFillErp;

  /* 꼴 검사 — 숫자여야 하는 축에 글자가 들어오면 채움률이 아무리 높아도 사고다. */
  let off = 0;
  if (axis.shape === 'number' && axis.erpField) {
    const offRows = sellable.filter((p) => offShape((p as any)[axis.erpField!]));
    off = offRows.length;
    const offPct = sellable.length ? (off / sellable.length) * 100 : 0;
    if (offPct > (axis.maxOffShape ?? 1)) {
      under = true;
      shapeBad++;
      const bySup = new Map<string, number>();
      for (const p of offRows) {
        const who = S((p as any).partner_code) || S((p as any).provider_company_code) || '?';
        bySup.set(who, (bySup.get(who) || 0) + 1);
      }
      const worst = [...bySup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, n]) => `${k} ${n}대`).join(' · ');
      const samples = [...new Set(offRows.map((p) => S((p as any)[axis.erpField!])))].slice(0, 5).join(' / ');
      shapeReport.push(`  ⛔ ${axis.column} — 숫자가 아닌 값 ${off}대 (${offPct.toFixed(1)}%) · ${worst}\n     들어온 값: ${samples}`);
    }
  }
  if (under) bad++;
  console.log(
    axis.column.padEnd(10)
    + sup.padEnd(9)
    + `${sal}%`.padEnd(11)
    + `${erp}%`.padEnd(9)
    + `${axis.minFillSheet}/${axis.minFillErp}`.padEnd(16)
    + (off ? `⛔ 꼴 어긋남 ${off}대` : under ? '⛔ 문턱 미달' : '✓'),
  );
}

console.log(`\n  공급사 재고 기준 · 판매시트 발행분 · ERP 판매가능 ${sellable.length}대`);
if (shapeReport.length) {
  console.log('\n  ■ 채움률은 맞는데 «값이 엉뚱한» 축 — 열이 밀렸을 가능성이 크다(원천을 본다)');
  for (const line of shapeReport) console.log(line);
}
if (bad) {
  console.log(`\n  ⛔ ${bad}개 축이 문턱 밑이다 — **값이 새고 있다.**`);
  console.log('     정제칸이 비었으면 정제시트를 채우고, 정제칸은 찼는데 판매시트가 비면 발행기를,');
  console.log('     판매시트는 찼는데 ERP 가 비면 유입(sheet-import·sheet-merge)을 본다.');
  if (GATE) process.exit(1);
} else {
  console.log('\n  ✓ 모든 축이 문턱 위 — 정제칸에서 ERP 까지 값이 안 샌다');
}
