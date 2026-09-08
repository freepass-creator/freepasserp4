/**
 * **발행한 시트가 원자와 «정말 같은가» — 칸 단위 대조.** 읽기 전용 · 어긋나면 종료코드 1.
 *
 * > 사장님 2026-09-08 「너무 빠르게만 필요없고 **적당한 속도에 완벽하게 박혀야 함**」
 *
 * 발행이 «끝났다」는 것과 «제대로 박혔다」는 것은 다르다. 발행기는 스스로 「반영 완료」라 찍지만,
 * 그건 구글이 200 을 줬다는 뜻이지 **그 칸에 그 값이 들어갔다는 뜻이 아니다.**
 * 오늘만 해도 시트에 「장기보증=0」이 서 있었고, 「(공급사 없음) 84대」 탭이 남아 있었고,
 * 오플 보증금이 0/84 였다 — 셋 다 발행은 «성공»했다.
 *
 * ```
 * 원자 products  ──▶  상품리스트 F01(4탭)  ──▶  하허호 F86(회사별 탭)
 *      ①대조                    ②대조
 * ```
 * ① 원자 ↔ F01 — 차 한 대의 «정체·상태·요금»이 시트 칸에 그대로 있나
 * ② F01 ↔ F86 — F01 의 줄이 F86 에 «하나도 빠짐없이, 값 그대로» 옮겨졌나 (F86 은 F01 을 회사별로만 쪼갠 것)
 *
 * ★**빠진 차 · 남는 차 · 값이 다른 칸**을 갈래로 나눠 센다. 숫자만 맞대면 «어느 차»인지 모른다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-sheet-vs-atom.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SALES_PUBLISHED_TAB_PREFIXES } from '../lib/domain/sales-published-tabs';
import { isDepositColumn } from '../lib/domain/sales-sheet-format';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s/g, '');
/** 표기 차이는 사고가 아니다 — 쉼표·공백·대시만 걷고 견준다. */
const EQ = (a: unknown, b: unknown) => {
  const n = (x: unknown) => S(x).replace(/[,\s]/g, '').replace(/^-+$/, '');
  return n(a) === n(b);
};
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const api = async (u: string): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : {};
};
const F01 = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const F86 = '1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg';

/** 시트 칸 → 원자 필드. «곧바로 견줄 수 있는 것»만 담는다(가공이 낀 칸은 뺀다 — 거짓 경보가 신뢰를 깎는다). */
const MAP: [string, string][] = [
  ['배차상태', 'vehicle_status'], ['구분', 'product_type'],
  ['제조사', 'maker'], ['모델', 'model'], ['세부모델', 'sub_model'], ['세부트림', 'trim_name'],
  ['외장', 'ext_color'], ['내장', 'int_color'], ['연식', 'year'], ['Km', 'mileage'],
  ['연료', 'fuel_type'], ['배기량', 'engine_cc'], ['원산지', 'origin'], ['최초등록', 'first_registration_date'],
];

// ── 원자 ────────────────────────────────────────────────────
const atoms = new Map<string, any>();
for (const d of (await getFirestore().collection('products').get()).docs) {
  const v = d.data() as any; atoms.set(K(v.car_number) || d.id, v);
}
/**
 * ★**시트에 실려야 할 차 = 발행기와 «같은 잣대»로 센다** (`listable === true`).
 *   ⚠ 처음엔 「출고불가만 빼면 된다」로 셌는데, 그러면 **일부러 내린 차**까지 「빠졌다」고 운다.
 *   실측 4대가 그랬다 — 차명이 «아예 없는» 차(`검수상태=원문없음`)는 규칙대로 내린 것이지 사고가 아니다.
 *   ★검사가 거짓으로 울면 사람이 검사를 안 믿게 된다. 잣대는 발행기와 하나여야 한다.
 */
const 실릴차 = [...atoms.values()].filter((v) => v.listable === true);
const 일부러내림 = [...atoms.values()].filter((v) => v.listable !== true && S(v.vehicle_status).replace(/\s+/g, '') !== '출고불가');
console.log(`\n원자 ${atoms.size} · 시트에 실려야 할 차 ${실릴차.length}`);

// ── ① 원자 ↔ F01 ────────────────────────────────────────────
type Row = { tab: string; car: string; cells: Record<string, string> };
const f01: Row[] = [];
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F01}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => S(s.properties?.title));
  for (const prefix of SALES_PUBLISHED_TAB_PREFIXES) {
    const t = titles.find((x) => x.startsWith(prefix)); if (!t) continue;
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F01}/values/${encodeURIComponent(`'${t}'!A1:CZ3000`)}`);
    const grid: string[][] = (v.values || []).map((r: any[]) => (r || []).map(S));
    const hdr = grid[0] || []; const ci = hdr.indexOf('차량번호');
    for (const r of grid.slice(1)) {
      const car = K(r[ci]); if (!car) continue;
      const cells: Record<string, string> = {};
      hdr.forEach((h, i) => { if (S(h)) cells[S(h)] = S(r[i]); });
      f01.push({ tab: prefix, car, cells });
    }
  }
}
const f01Cars = new Set(f01.map((r) => r.car));
const 빠진차 = 실릴차.filter((v) => !f01Cars.has(K(v.car_number)));
const 남는차 = f01.filter((r) => { const a = atoms.get(r.car); return !a || S(a.vehicle_status).replace(/\s+/g, '') === '출고불가'; });
const 어긋난칸 = new Map<string, { n: number; 표본: string[] }>();
for (const r of f01) {
  const a = atoms.get(r.car); if (!a) continue;
  for (const [col, f] of MAP) {
    if (!(col in r.cells)) continue;
    const 시트 = r.cells[col], 원자 = S(a[f]);
    if (!원자 && !S(시트)) continue;
    if (EQ(시트, 원자)) continue;
    const e = 어긋난칸.get(col) || { n: 0, 표본: [] };
    e.n++; if (e.표본.length < 3) e.표본.push(`${r.car} 시트「${시트 || '—'}」↔ 원자「${원자 || '—'}」`);
    어긋난칸.set(col, e);
  }
}
/** ★요금 — 「값이 있어야 할 칸이 비었나」만 본다. 칸 이름이 회사마다 달라 1:1 로는 못 맞댄다. */
let 요금빈줄 = 0;
for (const r of f01) {
  const a = atoms.get(r.car); if (!a) continue;
  const 원자요금 = a.price && typeof a.price === 'object' && Object.keys(a.price).length;
  if (!원자요금) continue;
  const 시트요금 = Object.entries(r.cells).some(([h, v]) => /개월|월렌트/.test(h) && !isDepositColumn(h) && S(v) && S(v) !== '-');
  if (!시트요금) 요금빈줄++;
}

console.log(`\n■ ① 원자 ↔ 상품리스트 F01 — 시트 ${f01.length}줄`);
console.log(`  실려야 하는데 «빠진 차» ${빠진차.length}`);
if (빠진차.length) console.log(`     ${빠진차.slice(0, 6).map((v) => `${S(v.car_number)}(${S(v.provider_name) || S(v.provider_company_code)}·${S(v.vehicle_status)})`).join(' · ')}`);
console.log(`  내려야 하는데 «서 있는 차» ${남는차.length}`);
if (남는차.length) console.log(`     ${남는차.slice(0, 6).map((r) => r.car).join(' · ')}`);
console.log(`  값이 다른 칸 ${[...어긋난칸.values()].reduce((s, e) => s + e.n, 0)}`);
for (const [col, e] of [...어긋난칸].sort((a, b) => b[1].n - a[1].n)) console.log(`     ${col} ${e.n} — ${e.표본.join(' · ')}`);
console.log(`  원자엔 요금이 있는데 시트 대여료가 통째로 빈 줄 ${요금빈줄}`);

// ── ② F01 ↔ F86 ─────────────────────────────────────────────
const f86 = new Map<string, Record<string, string>>();
let f86줄 = 0;
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F86}?fields=sheets.properties.title`);
  const titles: string[] = (meta.sheets || []).map((s: any) => S(s.properties?.title)).filter((t: string) => !/공지|안내|이 시트/.test(t));
  for (const t of titles) {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${F86}/values/${encodeURIComponent(`'${t}'!A1:CZ3000`)}`);
    const grid: string[][] = (v.values || []).map((r: any[]) => (r || []).map(S));
    const hdr = grid[0] || []; const ci = hdr.indexOf('차량번호'); if (ci < 0) continue;
    for (const r of grid.slice(1)) {
      const car = K(r[ci]); if (!car) continue;
      f86줄++;
      const cells: Record<string, string> = {};
      hdr.forEach((h, i) => { if (S(h)) cells[S(h)] = S(r[i]); });
      f86.set(car, cells);
    }
  }
}
const F86빠짐 = f01.filter((r) => !f86.has(r.car));
/** ★F86 은 F01 을 쪼갠 것이라 F01 에 없는 차가 서면 «묵은 탭»이거나 헛것이다. */
const F86헛것 = [...f86.keys()].filter((c) => !f01Cars.has(c));
const F86값차이 = new Map<string, { n: number; 표본: string[] }>();
for (const r of f01) {
  const b = f86.get(r.car); if (!b) continue;
  for (const [col, v] of Object.entries(r.cells)) {
    if (!(col in b)) continue;                    // 그 회사가 안 쓰는 요금 칸 — 일부러 뺀 것
    if (EQ(v, b[col])) continue;
    const e = F86값차이.get(col) || { n: 0, 표본: [] };
    e.n++; if (e.표본.length < 3) e.표본.push(`${r.car} F01「${v || '—'}」↔ F86「${b[col] || '—'}」`);
    F86값차이.set(col, e);
  }
}
console.log(`\n■ ② 상품리스트 F01 ↔ 하허호 F86 — F86 ${f86줄}줄`);
console.log(`  F01 에 있는데 F86 에 «없는 차» ${F86빠짐.length}${F86빠짐.length ? ` — ${F86빠짐.slice(0, 6).map((r) => r.car).join(' · ')}` : ''}`);
console.log(`  F01 에 없는데 F86 에 «서 있는 차» ${F86헛것.length}${F86헛것.length ? ` — ${F86헛것.slice(0, 6).join(' · ')}` : ''}`);
console.log(`  값이 다른 칸 ${[...F86값차이.values()].reduce((s, e) => s + e.n, 0)}`);
for (const [col, e] of [...F86값차이].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`     ${col} ${e.n} — ${e.표본.join(' · ')}`);

// ── 결과 ────────────────────────────────────────────────────
/**
 * ★**막는 것과 알리는 것을 가른다.**
 *   빠진 차·헛것·값 어긋남은 «틀린 표»라 막는다. 요금 빈 줄은 원천 몫이라 알린다.
 */
const 막음: string[] = [];
if (빠진차.length) 막음.push(`시트에 «빠진 차» ${빠진차.length}대 — 팔 수 있는데 어디에도 안 선다`);
if (남는차.length) 막음.push(`시트에 «남은 차» ${남는차.length}대 — 출고불가인데 서 있다(판 차를 또 판다)`);
if (F86헛것.length) 막음.push(`F86 에 헛것 ${F86헛것.length}대 — 묵은 탭이 남았을 수 있다`);
if (F86빠짐.length) 막음.push(`F86 에 «안 옮겨진 차» ${F86빠짐.length}대`);
const 칸어긋남 = [...어긋난칸.values()].reduce((s, e) => s + e.n, 0) + [...F86값차이.values()].reduce((s, e) => s + e.n, 0);
if (칸어긋남) 막음.push(`값이 다른 칸 ${칸어긋남}개 — 시트와 원자가 다른 말을 한다`);

console.log('');
if (요금빈줄) console.log(`  ▲ 원자엔 요금이 있는데 시트가 빈 줄 ${요금빈줄}`);
for (const x of 막음) console.log(`  ⛔ ${x}`);
if (막음.length) { console.log(`\n⛔ 시트가 원자대로 «안 박혔다» — ${막음.length}갈래.\n`); process.exit(1); }
console.log(`\n✓ 시트가 원자대로 박혔다${요금빈줄 ? ` — 알림 1건` : ''}\n`);
process.exit(0);
