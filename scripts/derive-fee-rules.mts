/**
 * **기존 실적을 역산해 수수료 기준을 세운다.** 읽기만 한다(쓰지 않는다).
 *
 * ★사장님 2026-08-25 「수수료 계산 기준도 확인해봐봐 기존 실적 다 확인해서 역산해서 정립해야함」.
 *
 * ★**적힌 수수료가 어느 산식에서 나왔는지 줄마다 맞춰 본다.**
 * ```
 * 대여료×기간   렌탈료 × 계약기간 × 요율
 * 차량가액      차량가액 × 요율
 * 고정          요율 칸에 든 값 그 자체(요율이 아니라 «금액»이다 — 1 이상이면 고정으로 본다)
 * ```
 * ★그다음 **공급사 × 상품구분 × 계약기간**으로 묶어 «어떤 요율을 쓰나»를 센다.
 *   한 묶음에 요율이 여럿이면 그건 규칙이 아니라 «건마다 협의»다 — 그렇게 적어 둔다.
 * ⚠ 짐작을 넣지 않는다. 맞는 산식이 없으면 「모름」으로 세고 그대로 보여 준다.
 *
 *   npx tsx scripts/derive-fee-rules.mts
 *   npx tsx scripts/derive-fee-rules.mts --csv   (tmp/fee-rules.csv 로 뽑기)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const TABS = ['접수', '취소', '분납실적', '완납실적'];
const TOL = 2;                      // 원 단위 반올림 오차는 봐 준다
const CSV = process.argv.includes('--csv');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(15_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

type Row = { sup: string; prod: string; term: number; rent: number; price: number; rate: number; fee: number; side: '공급사' | '에이전시'; plate: string };
const rows: Row[] = [];
for (const tab of TABS) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    const plate = S(r[at('차량번호')]);
    if (!plate) continue;
    const base = { sup: S(r[at('공급사')]), prod: S(r[at('상품구분')]), term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), plate };
    const s1 = N(r[at('공급사수수료율')]), f1 = N(r[at('판매수수료')]);
    const s2 = N(r[at('에이전시수수료율')]), f2 = N(r[at('출고수수료')]);
    if (s1 && f1) rows.push({ ...base, rate: s1, fee: f1, side: '공급사' });
    if (s2 && f2) rows.push({ ...base, rate: s2, fee: f2, side: '에이전시' });
  }
}

/** 이 줄이 어느 산식에서 나왔나. 맞는 게 없으면 「모름」. */
const baseOf = (r: Row) => {
  if (r.rate >= 1) return Math.abs(r.rate - r.fee) <= TOL ? '고정' : '모름';
  if (r.rent && r.term && Math.abs(r.rent * r.term * r.rate - r.fee) <= TOL) return '대여료×기간';
  if (r.price && Math.abs(r.price * r.rate - r.fee) <= TOL) return '차량가액';
  return '모름';
};

console.log(`\n■ 기존 실적 역산 — 수수료가 적힌 ${rows.length}칸\n`);
const byBase = new Map<string, number>();
for (const r of rows) byBase.set(baseOf(r), (byBase.get(baseOf(r)) || 0) + 1);
for (const [k, v] of [...byBase].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(10)} ${String(v).padStart(4)}칸  ${((v / rows.length) * 100).toFixed(1)}%`);

// ── 상품구분 × 기준
console.log('\n■ 상품구분이 기준을 정하나');
const pb = new Map<string, Map<string, number>>();
for (const r of rows) {
  const k = r.prod || '(빈칸)';
  if (!pb.has(k)) pb.set(k, new Map());
  const m = pb.get(k)!; const b = baseOf(r);
  m.set(b, (m.get(b) || 0) + 1);
}
for (const [k, m] of [...pb].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  console.log(`   ${k.padEnd(10)} ${[...m].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(' · ')}`);
}

// ── 공급사 × 상품구분 × 기간 → 요율
type Key = string;
const rateOf = new Map<Key, Map<number, number>>();
for (const r of rows) {
  const k = `${r.side}|${r.sup || '(빈칸)'}|${r.prod || '(빈칸)'}|${baseOf(r) === '대여료×기간' ? r.term : 0}`;
  if (!rateOf.has(k)) rateOf.set(k, new Map());
  const m = rateOf.get(k)!;
  m.set(r.rate, (m.get(r.rate) || 0) + 1);
}
const lines: string[][] = [];
for (const [k, m] of rateOf) {
  const [side, sup, prod, term] = k.split('|');
  const list = [...m].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((a, [, n]) => a + n, 0);
  const top = list[0];
  const kind = top[0] >= 1 ? '고정' : /선출고|견적출고/.test(prod) ? '차량가액' : '대여료×기간';
  const shown = top[0] >= 1 ? top[0].toLocaleString('ko-KR') : `${(top[0] * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
  lines.push([side, sup, prod, term === '0' ? '' : `${term}개월`, kind, shown, String(total),
    list.length > 1 ? `⚠ ${list.length}가지 — ${list.slice(1, 4).map(([v, n]) => `${v >= 1 ? v.toLocaleString('ko-KR') : `${(v * 100).toFixed(2)}%`}×${n}`).join(' ')}` : '']);
}
lines.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || Number(a[3].replace(/\D/g, '') || 0) - Number(b[3].replace(/\D/g, '') || 0));

console.log('\n■ 공급사 × 상품구분 × 기간 → 요율  (건수 많은 값이 그 묶음의 기준이다)');
console.log(`   ${'쪽'.padEnd(6)}${'공급사'.padEnd(12)}${'상품구분'.padEnd(10)}${'기간'.padEnd(7)}${'기준'.padEnd(12)}${'요율'.padStart(11)}${'건'.padStart(5)}  흔들림`);
for (const l of lines) {
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(`   ${pad(l[0], 6)}${pad(l[1], 12)}${pad(l[2], 10)}${pad(l[3], 7)}${pad(l[4], 12)}${l[5].padStart(11)}${l[6].padStart(5)}  ${l[7]}`);
}

const shaky = lines.filter((l) => l[7]);
console.log(`\n   묶음 ${lines.length} · 그중 요율이 여럿인 묶음 ${shaky.length} — 그건 규칙이 아니라 «건마다 협의»다.`);

const unknown = rows.filter((r) => baseOf(r) === '모름');
if (unknown.length) {
  console.log(`\n■ 어느 산식에도 안 맞는 ${unknown.length}칸 — 보기 10개`);
  for (const r of unknown.slice(0, 10)) {
    console.log(`   ${r.plate.padEnd(11)} ${r.side} ${r.sup.padEnd(9)} ${r.prod.padEnd(8)} 요율 ${r.rate} · 렌탈료 ${r.rent.toLocaleString('ko-KR')} × ${r.term} · 차량가액 ${r.price.toLocaleString('ko-KR')} → 적힌 ${r.fee.toLocaleString('ko-KR')}`);
  }
}

if (CSV) {
  const csv = ['쪽,공급사,상품구분,기간,기준,요율,건수,흔들림', ...lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
  writeFileSync('tmp/fee-rules.csv', '﻿' + csv, 'utf8');
  console.log('\n   ✓ tmp/fee-rules.csv');
}
