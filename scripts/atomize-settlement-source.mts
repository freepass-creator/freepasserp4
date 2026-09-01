/**
 * **원본 정산시트를 원자 틀에 부어 본다.** 읽기만 한다 — 아무것도 쓰지 않는다.
 *
 * ★사장님 2026-08-26 「erp에서 틀을 먼저 잡고 기존 원본 정산시트에서 값들을 원자화해서 갖고오면 되거든」.
 *   틀은 `lib/domain/settlement-atoms.ts` 에 섰다. 이제 **부어 보고 무엇이 넘치는지 센다.**
 *
 * 답해야 할 것 넷 —
 *   ① 3,028줄 중 **같은 계약이 몇 번 겹쳐 적혀 있나** (월 탭마다 이월돼 있다)
 *   ② 지금 원장 428줄과 **겹치는 것 / 새로 들어올 것**
 *   ③ 「상태 표기」 글자를 **체크 넷(계약서·인도완료·계약취소·환수)으로 풀 수 있나**
 *   ④ 필수 칸이 빈 줄이 몇이나 되나 = **사람이 채워야 할 몫**
 *
 * ⚠ 세기 전에 옮기지 않는다. 3,028줄을 그냥 부으면 이월된 중복이 실적을 몇 배로 부풀린다.
 *
 *   npx tsx scripts/atomize-settlement-source.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { SETTLEMENT_ATOMS, bySource, checksFromStatus, plateKeyOf } from '../lib/domain/settlement-atoms';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => n.toLocaleString('ko-KR');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** ★구글 날짜는 숫자로 온다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다. */
const SERIAL0 = Date.UTC(1899, 11, 30);
const toDate = (v: unknown): Date | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');
/** 차번 열쇠 — 「미정」은 열쇠가 못 된다(원본에 그대로 적혀 있다). */
const plateKey = plateKeyOf;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<Record<string, unknown>> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(1200 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

type Poured = Record<string, string> & { __tab: string; __row: number };

// ─────────────────────────────────────────────── 붓는다
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`);
const tabs = ((meta.sheets || []) as { properties: { title: string } }[]).map((s) => s.properties.title);
const rows: Poured[] = [];
const noPlate: Poured[] = [];
const statusWords = new Map<string, number>();
let dataTabs = 0;

for (const tab of tabs) {
  const got = await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ400`)}?valueRenderOption=UNFORMATTED_VALUE`,
  ).catch(() => ({} as Record<string, unknown>));
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.some((c) => c.replace(/\s/g, '') === '차량번호'));
  if (hi < 0) continue;
  dataTabs++;
  const head = all[hi];
  // ★자리가 아니라 «이름»으로 붙인다. 원본은 탭마다 열 자리가 흔들린다.
  const map = head.map((h) => bySource(h)?.name || '');
  for (let i = hi + 1; i < all.length; i++) {
    const r = all[i];
    const rec = { __tab: tab, __row: i + 1 } as Poured;
    for (let c = 0; c < map.length; c++) if (map[c] && S(r[c])) rec[map[c]] = S(r[c]);
    if (!plateKey(rec['차량번호'])) { noPlate.push(rec); continue; }
    rows.push(rec);
    const st = S(rec['상태']);
    if (st) statusWords.set(st, (statusWords.get(st) || 0) + 1);
  }
}

console.log(`\n■ 부었다 — 데이터 탭 ${dataTabs}개 · 차번 있는 ${rows.length}줄 · 차번이 「미정」이라 열쇠가 못 되는 ${noPlate.length}줄`);

// ─────────────────────────────────────────────── ① 겹치는가
/** 한 계약의 열쇠 — 차번+접수일. 접수일이 없으면 차번+인도일로 버틴다. */
const keyOf = (r: Poured) => {
  const p = plateKey(r['차량번호']);
  const d = iso(toDate(r['접수일'])) || iso(toDate(r['인도일'])) || '';
  return `${p}|${d}`;
};
const byKey = new Map<string, Poured[]>();
for (const r of rows) {
  const k = keyOf(r);
  (byKey.get(k) || byKey.set(k, []).get(k)!).push(r);
}
const dup = [...byKey.values()].filter((v) => v.length > 1);
console.log(`\n■ ① 겹침 — 계약 ${byKey.size}건이 ${rows.length}줄로 적혀 있다`);
console.log(`   여러 탭에 걸친 계약 ${dup.length}건 · 겹쳐 적힌 줄 ${rows.length - byKey.size}줄`);
console.log('   ⚠ 그냥 부으면 실적이 이만큼 부풀어 오른다. **계약 하나에 줄 하나**로 접어야 한다.');
const worst = dup.sort((a, b) => b.length - a.length).slice(0, 5);
for (const d of worst) console.log(`      ${d[0]['차량번호']} — ${d.length}번  (${d.map((x) => x.__tab).join(' · ')})`);

/** 접을 때는 **뒤 탭이 이긴다** — 나중 탭이 갱신본이다. 단, 빈 칸은 앞 것으로 메운다. */
const folded = [...byKey.values()].map((group) => {
  const out = {} as Poured;
  for (const g of group) for (const [k, v] of Object.entries(g)) if (S(v)) (out as Record<string, string>)[k] = String(v);
  return out;
});

// ─────────────────────────────────────────────── ③ 상태 글자
console.log(`\n■ ③ 「상태 표기」 글자 ${statusWords.size}가지 — 체크 넷으로 풀 수 있나`);
const sorted = [...statusWords].sort((a, b) => b[1] - a[1]);
for (const [w, c] of sorted.slice(0, 14)) console.log(`   ${String(c).padStart(5)}줄  ${w}`);
if (sorted.length > 14) console.log(`   … 외 ${sorted.length - 14}가지`);

// 표(STATUS_TO_CHECKS)로 푼다. 모르는 글자는 아무것도 안 켠다.
const unknown = sorted.filter(([w]) => !checksFromStatus(w).known);
console.log(`   ${unknown.length ? '⛔ 표에 없는 글자 ' + unknown.length + '가지 — ' + unknown.map(([w, c]) => `${w}(${c})`).join(' · ') : '✓ 글자 7가지가 전부 표에 있다 — 체크로 풀린다'}`);
const derived = folded.map((r) => ({ ...checksFromStatus(S(r['상태'])), delivered: !!toDate(r['인도일']) }));
console.log(`   풀어 보면 — 계약서 ${derived.filter((d) => d.paper).length} · 인도완료 ${derived.filter((d) => d.delivered).length} · 취소 ${derived.filter((d) => d.cancelled).length} · 환수 ${derived.filter((d) => d.clawback).length}`);
console.log('   ★인도완료는 글자가 아니라 **인도일이라는 사실**에서 끌어낸다 — 글자는 안 고치고 넘어가기 쉽다.');

// ─────────────────────────────────────────────── ④ 필수 칸이 비었나
// ★인도완료는 «사람이 적는 칸»이 아니라 인도일에서 끌어내는 칸이다. 세는 대상에서 뺀다.
const MUST = SETTLEMENT_ATOMS.filter((a) => a.need === '필수' && a.fill === '사람' && a.name !== '인도완료');
console.log(`\n■ ④ 필수 칸(사람이 적는 것) ${MUST.length}개 — 계약 ${folded.length}건 기준`);
for (const a of MUST) {
  const miss = folded.filter((r) => !S(r[a.name])).length;
  const bar = miss === 0 ? '✓' : miss < folded.length * 0.05 ? '·' : '⛔';
  console.log(`   ${bar} ${a.name.padEnd(10)} 빈 줄 ${String(miss).padStart(5)}  (${((miss / folded.length) * 100).toFixed(1)}%)`);
}
const clean = folded.filter((r) => MUST.every((a) => S(r[a.name])));
console.log(`   → 필수가 다 찬 계약 ${clean.length}건 / ${folded.length}건 (${((clean.length / folded.length) * 100).toFixed(1)}%)`);

// 정산이 실제로 계산되는가 — 기준값이 있나
const hasBase = folded.filter((r) => {
  const p = S(r['상품구분']);
  return /선출고|견적출고/.test(p) ? !!Number(S(r['차량가액']).replace(/[,\s원]/g, ''))
    : !!Number(S(r['렌탈료']).replace(/[,\s원]/g, '')) && !!Number(S(r['계약기간']).replace(/[,\s월]/g, ''));
});
console.log(`   → 수수료 기준값(차량가액 또는 대여료×기간)이 있는 계약 ${hasBase.length}건`);
const written = folded.filter((r) => Number(S(r['판매수수료']).replace(/[,\s원]/g, '')) > 0);
console.log(`   → 판매수수료가 «적혀 있는» 계약 ${written.length}건 — 적힌 값이 이긴다`);

// ─────────────────────────────────────────────── ② 지금 원장과 겹치나
const led = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1('접수')}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
const ledKeys = new Set<string>();
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const got = tab === '접수' ? led : await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  for (const r of all.slice(hi + 1)) {
    const p = plateKey(r[h.indexOf('차량번호')]);
    if (!p) continue;
    ledKeys.add(`${p}|${iso(toDate(r[h.indexOf('접수일')]))}`);
  }
}
const already = folded.filter((r) => ledKeys.has(keyOf(r))).length;
const byPlateOnly = new Set([...ledKeys].map((k) => k.split('|')[0]));
const samePlate = folded.filter((r) => !ledKeys.has(keyOf(r)) && byPlateOnly.has(plateKey(r['차량번호']))).length;
console.log(`\n■ ② 지금 원장 ${ledKeys.size}건과 대조`);
console.log(`   그대로 겹치는 계약     ${already}건`);
console.log(`   차는 같은데 접수일 다름 ${samePlate}건  ← 재계약이거나 날짜가 어긋난 것. 눈으로 봐야 한다`);
console.log(`   원장에 없는 계약       ${folded.length - already - samePlate}건  ← 옛 실적. 가져오면 이만큼 늘어난다`);

writeFileSync('tmp/atomized-source.json', JSON.stringify({
  pouredRows: rows.length, contracts: folded.length, tabs: dataTabs,
  statusWords: sorted, rows: folded,
}, null, 2), 'utf8');
console.log('\n   부어 놓은 것 tmp/atomized-source.json (쓰기 전 눈으로 볼 것)\n');
