/**
 * **원본에도 없는 판매수수료를 요율로 계산해 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-25) — 원본 「프리패스 26/5」 탭에는 **「판매수수료」 열이 아예 없다**
 *   (열 24가 「수수료율(공급사)」로 중복돼 있고, 「판매 수수료(수식X)」에 7줄만 적혀 있다).
 *   지급액(출고수수료)은 68/70 차 있는데 청구액만 통째로 빈다 —
 *   그대로 두면 월별 요약에서 **5월 우리 몫이 −5,925만원**으로 나온다.
 *
 * ★**지어내는 것이 아니다.** 원장 「수수료표」 탭이 적어 놓은 산식 그대로다.
 *   ⚠ **기준이 셋이다.** 하나로 밀면 46%밖에 안 맞는다(실측 2026-08-25).
 * ```
 * 요율이 1 이상   → 그 값이 곧 «건당 고정액»이다. 곱하지 않는다
 *                  오플구독 800,000 · 재렌트 500,000  (수수료표 「건당 고정 · 요율 아님」)
 * 선출고·견적출고 → 차량가액 × 요율            (수수료표 「기준 = 차량가액」)
 *                  검산 133호1993  출고 1,434,000 ÷ 3% = 차량가액 4,780만
 * 그 밖           → 렌탈료 × 계약기간 × 요율   (수수료표 「기준 = 대여료×기간」)
 *                  검산 49호3059  920,000 × 48 × 3.25% = 1,435,200 ✓
 * ```
 * ★**먼저 지급 쪽으로 공식을 검산한다.** 출고수수료와 에이전시요율이 «둘 다 있는» 줄에서
 *   `렌탈료 × 기간 × 에이전시요율` 이 적힌 값과 맞는지 세어 본다. 안 맞으면 **아무것도 안 쓴다** —
 *   공식이 틀린 채로 청구액을 지어내면 그게 곧 돈 사고다.
 *
 * ★**계산한 칸에는 메모를 단다.** 「원본에 없어 계산한 값」이라고 적어 둬야
 *   나중에 보는 사람이 «적힌 값»과 «계산한 값»을 가른다(사장님 「자료에 구멍이 있으면 모른다」).
 * ⚠ 값이 있는 칸은 안 덮는다. 적힌 값이 늘 이긴다.
 *
 *   npx tsx scripts/compute-missing-fees.mts
 *   npx tsx scripts/compute-missing-fees.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const TABS = ['접수', '취소', '분납실적', '완료실적'];
/** 검산이 이 비율보다 낮으면 아무것도 안 쓴다. */
const MIN_MATCH = 0.9;
/** 원 단위 반올림 오차는 봐 준다. */
const TOL = 2;
const NOTE = '원본에 없어 계산한 값 (scripts/compute-missing-fees.mts)';

/**
 * 수수료 한 건. **기준이 셋이다** — 원장 「수수료표」 탭과 같아야 한다.
 * ★요율 칸에 1 이상이 들어 있으면 그건 요율이 아니라 **건당 고정액**이다(오플구독 80만·재렌트 50만).
 */
const feeOf = (rate: number, rent: number, term: number, price: number, product: string) => {
  if (!rate) return 0;
  if (rate >= 1) return Math.round(rate);                                   // 건당 고정
  if (/선출고|견적출고/.test(product)) return price ? Math.round(price * rate) : 0; // 차량가액 기준
  return rent && term ? Math.round(rent * term * rate) : 0;                 // 대여료 × 기간
};

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const p2 = (n: number) => String(n).padStart(2, '0');
const SERIAL0 = Date.UTC(1899, 11, 30);
const ym = (v: string) => {
  const t = S(v);
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) { const u = new Date(SERIAL0 + Math.round(n) * 86_400_000); return `${u.getUTCFullYear()}-${p2(u.getUTCMonth() + 1)}`; }
  return '';
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
const gidOf = new Map<string, number>();
for (const p of ((meta.sheets || []) as any[]).map((s) => s.properties)) gidOf.set(S(p.title), Number(p.sheetId));

type Put = { tab: string; gid: number; row: number; col: number; plate: string; month: string; to: number; rent: number; term: number; rate: number; how: string };
const puts: Put[] = [];
let okAgency = 0, badAgency = 0;
const badRows: string[] = [];
const cannot: string[] = [];

for (const tab of TABS) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const head = rows[hi];
  const at = (n: string) => head.indexOf(n);
  const [iPlate, iRent, iTerm, iSup, iAg, iSell, iShip, iBill, iPrice, iProd] =
    ['차량번호', '렌탈료', '계약기간', '공급사수수료율', '에이전시수수료율', '판매수수료', '출고수수료', '청구월', '차량가액', '상품구분'].map(at);
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const plate = S(row[iPlate]);
    if (!plate) continue;
    const rent = N(row[iRent]), term = N(row[iTerm]), price = N(row[iPrice]), prod = S(row[iProd]);
    // ── 검산: 적힌 출고수수료가 같은 산식으로 나오나
    const ag = N(row[iAg]), ship = N(row[iShip]);
    if (ag && ship) {
      const want = feeOf(ag, rent, term, price, prod);
      if (want && Math.abs(want - ship) <= TOL) okAgency++;
      else { badAgency++; if (badRows.length < 8) badRows.push(`${plate.padEnd(11)} ${prod.padEnd(8)} 적힘 ${ship.toLocaleString('ko-KR')} ≠ 계산 ${want.toLocaleString('ko-KR')}`); }
    }
    // ── 채울 것: 판매수수료가 비었고 재료가 다 있는 줄
    if (N(row[iSell])) continue;
    const month = ym(S(row[iBill]));
    if (!month) continue;                                  // 인도 전이면 청구가 없다
    const sup = N(row[iSup]);
    const to = feeOf(sup, rent, term, price, prod);
    if (!to) { cannot.push(`${tab} ${plate} ${month}`); continue; }
    const how = sup >= 1 ? '건당 고정' : /선출고|견적출고/.test(prod) ? `차량가액 ${price.toLocaleString('ko-KR')} × ${(sup * 100).toFixed(2)}%` : `${rent.toLocaleString('ko-KR')} × ${term}개월 × ${(sup * 100).toFixed(2)}%`;
    puts.push({ tab, gid: gidOf.get(tab)!, row: r, col: iSell, plate, month, to, rent, term, rate: sup, how });
  }
}

const rate = okAgency + badAgency ? okAgency / (okAgency + badAgency) : 0;
console.log(`\n■ 빠진 판매수수료 계산 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   검산 — 적힌 출고수수료가 산식과 맞는 줄 ${okAgency} / 어긋난 줄 ${badAgency}  (${(rate * 100).toFixed(1)}%)`);
for (const b of badRows) console.log(`      · ${b}`);

const byMonth = new Map<string, { n: number; sum: number }>();
for (const p of puts) { const c = byMonth.get(p.month) || { n: 0, sum: 0 }; c.n++; c.sum += p.to; byMonth.set(p.month, c); }
console.log(`\n   채울 줄 ${puts.length}`);
for (const [m, c] of [...byMonth].sort().reverse()) console.log(`      ${m}  ${String(c.n).padStart(3)}줄  ${c.sum.toLocaleString('ko-KR')}원`);
if (cannot.length) console.log(`   ⚠ 재료가 없어 못 채우는 줄 ${cannot.length} — ${cannot.slice(0, 5).join(' · ')}`);
console.log('\n   보기 5줄');
for (const p of puts.slice(0, 6)) console.log(`      ${p.plate.padEnd(11)} ${p.how.padEnd(34)} = ${p.to.toLocaleString('ko-KR').padStart(11)}`);

writeFileSync('tmp/computed-fees.json', JSON.stringify({ puts: puts.length, okAgency, badAgency, rate, byMonth: [...byMonth], cannot: cannot.length }, null, 2));
if (rate < MIN_MATCH) {
  console.log(`\n⛔ 검산이 ${(rate * 100).toFixed(1)}% 다 — ${MIN_MATCH * 100}% 아래면 **아무것도 안 쓴다.**`);
  console.log('   공식이 틀린 채로 청구액을 지어내면 그게 곧 돈 사고다.\n');
  process.exit(1);
}
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }
if (!puts.length) { console.log('\n※ 채울 것이 없다.\n'); process.exit(0); }

const byTab = new Map<string, Put[]>();
for (const p of puts) { if (!byTab.has(p.tab)) byTab.set(p.tab, []); byTab.get(p.tab)!.push(p); }
for (const [tab, list] of byTab) {
  const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
  const data = list.map((p) => ({ range: `${a1(tab)}!${colA1(p.col)}${p.row + 1}`, values: [[String(p.to)]] }));
  for (let i = 0; i < data.length; i += 400) {
    await api(`${SH}/${LEDGER}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 400) }) });
  }
  // ★계산한 칸에는 메모를 단다 — «적힌 값»과 «계산한 값»이 눈으로 갈려야 한다.
  const reqs = list.map((p) => ({ repeatCell: {
    range: { sheetId: p.gid, startRowIndex: p.row, endRowIndex: p.row + 1, startColumnIndex: p.col, endColumnIndex: p.col + 1 },
    cell: { note: `${NOTE}\n${p.rent.toLocaleString('ko-KR')} × ${p.term}개월 × ${(p.rate * 100).toFixed(2)}%`, userEnteredFormat: { textFormat: { italic: true } } },
    fields: 'note,userEnteredFormat.textFormat.italic',
  } }));
  for (let i = 0; i < reqs.length; i += 200) {
    await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 200) }) });
  }
  console.log(`   ✓ ${tab} ${list.length}줄 (기울임 + 메모)`);
}

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 빠진 판매수수료 ${puts.length}줄을 요율로 계산해 채웠다\n\n도구 \`scripts/compute-missing-fees.mts --apply\`\n원본 「프리패스 26/5」 탭에는 **「판매수수료」 열이 아예 없다**(열 24가 수수료율로 중복). 지급액만 있고 청구액이 통째로 비어\n월별 요약에서 5월 우리 몫이 −5,925만원으로 나왔다.\n산식 \`렌탈료 × 계약기간 × 공급사요율\` 은 **지급 쪽으로 먼저 검산했다** — 출고수수료가 「렌탈료 × 기간 × 에이전시요율」과\n맞는 줄 ${okAgency} / 어긋난 줄 ${badAgency} (${(rate * 100).toFixed(1)}%).\n${[...byMonth].sort().reverse().map(([m, c]) => `- ${m} ${c.n}줄 ${c.sum.toLocaleString('ko-KR')}원`).join('\n')}\n**계산한 칸은 기울임에 메모가 달려 있다** — 적힌 값과 계산한 값을 눈으로 가르라고.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝 — ${puts.length}줄\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
