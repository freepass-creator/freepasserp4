/**
 * **상품마스터의 상태·기간별 대여료·보증금을 «발행된 상품리스트 값 그대로» 맞춘다 — 그래야 ERP(상품마스터를 읽음)와 영업자 표가 정확히 같다.**
 * 기본 dry-run, 반영은 `--apply`. `--audit-only` 는 견주기만(어긋남 있으면 exit 1 — 일일 반영 게이트).
 *
 * ★사장님 2026-08-18 — 「상품마스터를 당겨가서 상품시트와 ERP랑 정확하게 일치해야 해 — 그렇게 구현해 줘」.
 *   실측: 같은 21곳을 두 파서(발행기 · 상품마스터 갱신기)가 따로 읽으니 갈렸다 — 아이카 1개월 15대 빈칸, 렌트존·SA·아이카 장기보증 128대 빈칸,
 *   리더스 36개월 「-」인데 옛 값 560,000 유지, 손오공 구독 보증금 텍스트↔계산값. ERP 는 상품마스터를 읽으므로 영업자가 보는 값과 달랐다.
 *   그래서 **한 파서(발행기)의 결과를 정본**으로 두고, 상품마스터의 live 칸을 그 값으로 덮어 맞춘다(sync-product-master-live 다음 단계).
 *
 * ★무엇을 맞추나(발행된 상품리스트 줄 = 팔 수 있는 차):
 *   차량상태 ← 배차상태 · N개월 대여료 ← 상품리스트 N개월(1·12·24·36·48·60) · N개월 보증금 ← 단기보증(1·12) / 장기보증(24~60) — 그 기간 대여료가 있을 때만.
 *   「-」(운영 안 함)는 대여료·보증금을 **비운다**(옛 값 유지 금지). 보증금 「무보증」은 0(비우면 ERP 가 그 기간을 뺀다). 보증금이 다른 글자(손오공 「연수×대여료」)면 상품마스터의 계산값을 둔다(ERP 규칙, 영업자 표엔 글자).
 *   대여료는 있는데 보증금이 없는 기간은 ERP 가 뺀다(schema 상 대여료·보증금 쌍) — 경고로 세어 보여 준다(공급사가 단기보증/장기보증을 채워야 같아진다).
 *   6·18·72·84개월·변형(3만km·인수형)·정책코드·차종코드·차명 칸은 건드리지 않는다(갱신기·정본이 맡는다).
 *   상품리스트에 없는 차(출고불가·미발행)는 건드리지 않는다 — 갱신기가 상태를 출고불가로 맡는다.
 * ★맞춘 뒤 다시 읽어 견준다 — 어긋남 0 이어야 끝난다.
 *
 *   npx tsx scripts/sync-product-master-from-sales.mts
 *   npx tsx scripts/sync-product-master-from-sales.mts --apply
 *   npx tsx scripts/sync-product-master-from-sales.mts --audit-only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { pickPublishedSalesTabs, standardMoneyIndex } from '../lib/domain/sales-published-tabs';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { isExactRealPlate } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const AUDIT_ONLY = process.argv.includes('--audit-only');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SALES = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
/** 「₩540,000.00」·「540,000」·「540000」 → 「540000」. 「-」·빈칸·글자 → ''. */
const num = (v: unknown) => { const s = S(v).replace(/[₩,\s원]/g, ''); if (!s || !/^\d+(\.\d+)?$/.test(s)) return ''; const n = Math.round(Number(s)); return n > 0 ? String(n) : ''; };
const isText = (v: unknown) => !!S(v) && S(v) !== '-' && !num(v);
/** 공급사가 「무보증」이라 적은 것은 빈 칸이 아니라 «보증금 0원»(sheet-import MEANS_NO_DEPOSIT 와 같은 규칙). ERP 는 보증금 칸이 비면 그 기간을 통째로 뺀다 — 0 으로 박아야 영업자 표(무보증)와 같다. */
const NO_DEPOSIT = /^(무보증|보증금없음|보증없음|없음|0|0원|₩?0(\.0+)?)$/;
const isNoDeposit = (v: unknown) => NO_DEPOSIT.test(S(v).replace(/[\s,]/g, ''));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const SHORT = ['1', '12'] as const; const LONG = ['24', '36', '48', '60'] as const;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── 발행된 상품리스트(최신 탭)
const meta = await call(`${SH}/${SALES}?fields=sheets.properties(title,hidden)`);
// ★발행된 표 = 상품리스트 · 손오공구독 · 오플구독 세 탭의 합(2026-08-19 탭 3개로 회귀) — 한 탭만 읽으면 오플·손오공 구독이 «없는 차»가 된다.
const publishedTabs = pickPublishedSalesTabs(((meta.sheets || []) as Rec[]).filter((s) => !s.properties?.hidden).map((s) => S(s.properties?.title)));
if (!publishedTabs.some((t) => t.prefix === '상품리스트')) throw new Error('발행된 「상품리스트」 탭이 없다');
const salesTitle = publishedTabs.map((t) => t.title).join(' + ');
type SalesRow = { plate: string; state: string; rent: Record<string, string>; short: string; long: string; shortText: boolean; longText: boolean; shortNoDep: boolean; longNoDep: boolean };
const sales = new Map<string, SalesRow>();
const need = ['차량번호', '배차상태', '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'];
for (const tab of publishedTabs) {
const sv = await call(`${SH}/${SALES}/values/${encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'!A1:CZ2000`)}`) as { values?: string[][] };
const srows = ((sv.values || []) as string[][]).map((r) => r.map(S)); const sh = srows[0] || [];
// ★갈래 탭(손오공구독·오플구독)은 우리 공통 대여료 블록 대신 공급사 기간별 대여료가 서 있다 — 표준 칸은 별칭으로 되찾고(12개월←12개월 반납형 / 12개월 3만km …),
//   별칭도 없는 칸(단기보증·1개월 등 그 공급사가 안 파는 기간)은 -1 → 빈 값으로 읽어 「-」와 같이 다룬다.
const sat = (n: string) => standardMoneyIndex(tab.prefix, sh, n);
for (const n of need) if (sat(n) < 0 && (tab.prefix === '상품리스트' || n === '차량번호' || n === '배차상태')) throw new Error(`「${tab.title}」 머리행에 「${n}」 없음`);
for (const r of srows.slice(1)) {
  const plate = norm(r[sat('차량번호')]); if (!plate) continue;
  if (sales.has(plate)) { console.log(`  ⚠ 같은 차가 두 탭에: ${plate} (「${tab.title}」) — 먼저 읽은 탭 값을 쓴다`); continue; }
  const rent: Record<string, string> = {}; for (const m of [...SHORT, ...LONG]) rent[m] = num(r[sat(`${m}개월`)]);
  sales.set(plate, { plate, state: S(r[sat('배차상태')]), rent, short: num(r[sat('단기보증')]), long: num(r[sat('장기보증')]), shortText: isText(r[sat('단기보증')]), longText: isText(r[sat('장기보증')]), shortNoDep: isNoDeposit(r[sat('단기보증')]), longNoDep: isNoDeposit(r[sat('장기보증')]) });
}
}
// ── 상품마스터
const base = `${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
const pv = await call(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AX2000`)}`) as { values?: string[][] };
const prows = ((pv.values || []) as string[][]).map((r) => r.map(S)); const ph = prows[0] || [];
const pat = (n: string) => ph.indexOf(n);
for (const n of ['차량번호', '차량상태', '최종갱신', '원천']) if (pat(n) < 0) throw new Error(`상품마스터 머리행에 「${n}」 없음`);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const writes: { range: string; values: string[][] }[] = [];
const diffs: string[] = []; let matched = 0; let missing = 0;
const cellDiff = new Map<string, number>();
const rentNoDeposit: string[] = [];
const plan = (rowNo: number, col: string, next: string, now: string, plate: string) => {
  if (next === '0') { if (isNoDeposit(now)) return; }                                   // 무보증 0 — 이미 0/무보증이면 그대로
  else if (num(now) === num(next) && (!!num(next) || !S(now) || S(now) === next)) return;   // 숫자로 같거나(둘 다 비어 있거나) 이미 같음
  cellDiff.set(col, (cellDiff.get(col) || 0) + 1);
  if (diffs.length < 30) diffs.push(`${plate} ${col}: 상품마스터 「${now}」 → 판매시트 「${next || '(빈칸)'}」`);
  writes.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(pat(col))}${rowNo}`, values: [[next]] });
};
prows.slice(1).forEach((r, k) => {
  const plate = norm(r[pat('차량번호')]); if (!plate) return;
  const s = sales.get(plate); if (!s) return;
  matched++;
  const rowNo = k + 2;
  // 상태
  if (S(r[pat('차량상태')]) !== s.state && s.state) { cellDiff.set('차량상태', (cellDiff.get('차량상태') || 0) + 1); if (diffs.length < 30) diffs.push(`${plate} 차량상태: 「${r[pat('차량상태')]}」 → 「${s.state}」`); writes.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(pat('차량상태'))}${rowNo}`, values: [[s.state]] }); }
  // 기간별 대여료·보증금
  for (const m of [...SHORT, ...LONG]) {
    const rentCol = `${m}개월 대여료`, depCol = `${m}개월 보증금`; if (pat(rentCol) < 0) continue;
    const rent = s.rent[m];
    plan(rowNo, rentCol, rent, S(r[pat(rentCol)]), plate);
    const isShort = (SHORT as readonly string[]).includes(m);
    const depNum = isShort ? s.short : s.long; const depText = isShort ? s.shortText : s.longText;
    if (!rent) { plan(rowNo, depCol, '', S(r[pat(depCol)]), plate); continue; }        // 운영 안 하는 기간 — 보증금도 비운다
    // 보증금은 판매시트 값이 **숫자일 때만** 덮는다. 「무보증」은 0(무보증 = 보증금 0원 — 비우면 ERP 가 그 기간을 뺀다).
    // 「-」·다른 글자(손오공 「연수×대여료」)면 상품마스터 값(공급사 규칙 계산 등)을 둔다 — 영업자 표엔 글자, ERP 엔 계산값.
    const noDep = isShort ? s.shortNoDep : s.longNoDep;
    if (depNum) plan(rowNo, depCol, depNum, S(r[pat(depCol)]), plate);
    else if (noDep) { if (!isNoDeposit(r[pat(depCol)])) plan(rowNo, depCol, '0', S(r[pat(depCol)]), plate); }
    else if (!depText && !num(r[pat(depCol)]) && !isNoDeposit(r[pat(depCol)])) rentNoDeposit.push(`${plate}(${S(r[pat('공급사명')])} ${m}개월)`);   // 대여료는 있는데 보증금이 없다 — ERP 는 이 기간을 뺀다(공급사가 채워야 함)
    void depText;
  }
});
// ── 양쪽 대조: 상품리스트에만 있는 차 / 상품마스터에서 팔 수 있는데 상품리스트엔 없는 차
const masterPlates = new Set(prows.slice(1).map((r) => norm(r[pat('차량번호')])).filter(Boolean));
const onlySales = [...sales.values()].filter((s) => !masterPlates.has(s.plate));
const onlySalesPending = onlySales.filter((s) => !isExactRealPlate(s.plate));   // 번호미정(「미정」 등) — 상품마스터/ERP 는 차량번호가 있어야 실린다(번호 나오면 자동 합류)
const onlySalesReal = onlySales.filter((s) => isExactRealPlate(s.plate));
const onlyMaster = prows.slice(1).filter((r) => { const p = norm(r[pat('차량번호')]); return p && !sales.has(p) && S(r[pat('차량상태')]) && S(r[pat('차량상태')]) !== '출고불가'; })
  .map((r) => `${norm(r[pat('차량번호')])}(${S(r[pat('공급사명')])} · ${S(r[pat('차량상태')])})`);
missing = onlySales.length;
const touchedRows = new Set(writes.map((w) => w.range.split('!')[1].replace(/^[A-Z]+/, '')));
console.log(`■ 상품마스터 ← 상품리스트 ${AUDIT_ONLY ? '견주기' : APPLY ? '반영' : '미리보기'} — 「${salesTitle}」 ${sales.size}대 · 상품마스터에 있는 차 ${matched} · 없는 차 ${missing}`);
console.log(`  어긋난 칸 ${writes.length}(줄 ${touchedRows.size}): ${[...cellDiff].map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`);
for (const d of diffs) console.log(`   ${d}`);
if (rentNoDeposit.length) console.log(`  ※ 대여료는 있는데 보증금이 없는 기간 ${rentNoDeposit.length}칸 — 영업자 표엔 대여료·보증금 「-」로 보이지만 ERP 는 이 기간을 뺀다(공급사 시트 단기보증/장기보증을 채워야 같아진다): ${rentNoDeposit.slice(0, 12).join(', ')}${rentNoDeposit.length > 12 ? ' …' : ''}`);
if (onlySalesPending.length) console.log(`  ※ 번호미정이라 상품마스터(→ERP)에 못 싣는 차 ${onlySalesPending.length}: ${onlySalesPending.map((s) => `${s.plate}`).join(', ')} — 차량번호가 나오면 다음 반영 때 자동 합류(영업자 표엔 그대로 보인다)`);
if (onlySalesReal.length) console.log(`  ✗ 상품리스트에는 있는데 상품마스터에 없는 차 ${onlySalesReal.length}: ${onlySalesReal.map((s) => s.plate).join(', ')} — 갱신기(sync-product-master-live)가 못 읽었다`);
if (onlyMaster.length) console.log(`  ✗ 상품마스터에선 팔 수 있는데 상품리스트에 없는 차 ${onlyMaster.length}: ${onlyMaster.slice(0, 20).join(', ')}${onlyMaster.length > 20 ? ' …' : ''}`);
writeFileSync('tmp/product-master-from-sales.json', JSON.stringify({ salesTitle, sales: sales.size, matched, missing, rentNoDeposit, onlySalesPending: onlySalesPending.map((s) => s.plate), onlySalesReal: onlySalesReal.map((s) => s.plate), onlyMaster, cellDiff: [...cellDiff], diffs }, null, 2));
const mismatch = writes.length + onlySalesReal.length + onlyMaster.length;
if (AUDIT_ONLY) { if (mismatch) { console.log('  ✗ 상품리스트 ↔ 상품마스터 어긋남 — 일치하지 않는다'); process.exit(1); } console.log('  ✓ 일치'); process.exit(0); }
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }
// 최종갱신·원천 표식
for (const rowNo of touchedRows) { writes.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(pat('최종갱신'))}${rowNo}`, values: [[today]] }); writes.push({ range: `'${PRODUCT_MASTER_TAB}'!${colA1(pat('원천'))}${rowNo}`, values: [['판매시트 발행값(sync-product-master-from-sales)']] }); }
for (let i = 0; i < writes.length; i += 500) await call(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 500) }) });
console.log(`  ✓ 반영 ${writes.length}칸`);
// 되읽어 검증
const again = await call(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AX2000`)}`) as { values?: string[][] };
const rows2 = ((again.values || []) as string[][]).map((r) => r.map(S)); let bad = 0;
for (const r of rows2.slice(1)) { const s = sales.get(norm(r[pat('차량번호')])); if (!s) continue; for (const m of [...SHORT, ...LONG]) { if (num(r[pat(`${m}개월 대여료`)]) !== s.rent[m]) bad++; const isShort = (SHORT as readonly string[]).includes(m); const dn = isShort ? s.short : s.long; const nd = isShort ? s.shortNoDep : s.longNoDep; if (s.rent[m] && dn && num(r[pat(`${m}개월 보증금`)]) !== dn) bad++; if (s.rent[m] && !dn && nd && !isNoDeposit(r[pat(`${m}개월 보증금`)])) bad++; } if (S(r[pat('차량상태')]) !== s.state) bad++; }
console.log(bad ? `  ✗ 되읽기 어긋남 ${bad}칸` : '  ✓ 되읽기 일치 — 상품리스트 ↔ 상품마스터(→ERP) 같다');
if (bad) process.exit(1);
