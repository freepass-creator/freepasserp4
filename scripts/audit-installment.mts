/**
 * **분납이 끝났나 — 계산으로 판정한다(읽기 전용).**
 *
 * ★사장님 2026-08-25 「분납완료는 계약 시작하고 그 기간 지나서 환수 없으면 완료 된 거야」.
 *   ⇒ 공급사에서 입금 실적을 받아올 필요가 없다. **인도일 + 기간 + 환수 유무**로 정해진다.
 *
 * ★판정
 *   · 인도일 + (회차−1)개월이 **아직 안 지났다**      → 진행중. 계속 본다
 *   · 지났고 그 차에 **환수 줄이 있다**               → 환수. 청구를 되돌려야 한다
 *   · 지났고 환수가 없다                            → **완료**. 더 안 본다
 *   · 인도일이 없다                                 → 아직 시작도 안 했다
 *
 * ★기간을 이렇게 잡는다 — 2회분납은 인도 다음 달에 2회차, 3회분납은 그다음 달까지.
 *   ⚠ **가정이다.** 공급사마다 다르면 회차 간격을 「수수료」 탭에 받아 와야 한다.
 *     지금은 이 가정으로 세고, 어긋나면 그 자리를 고친다.
 *
 * ★환수는 **차번으로** 찾는다 — 환수 줄은 나중 달 탭에 따로 선다(같은 줄이 안 바뀐다).
 *
 *   npx tsx scripts/audit-installment.mts
 *   npx tsx scripts/audit-installment.mts --gap=2      회차 간격을 2개월로 본다
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const GAP = Number(arg('gap', '1')) || 1;          // 회차 사이 개월
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 150)}`);
  }
};

const ymOf = (tab: string) => { const m = /(\d{2})\s*\/\s*(\d{1,2})/.exec(tab); return m ? { y: 2000 + Number(m[1]), m: Number(m[2]) } : null; };
/** 「12/3」·「1/14」 처럼 연도가 없다 — 그 줄이 실린 **탭의 연월**로 연도를 정한다. */
const dateOf = (raw: string, tab: string): Date | null => {
  const t = ymOf(tab); if (!t) return null;
  const m = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})$/.exec(S(raw));
  if (!m) { const d = new Date(S(raw)); return Number.isNaN(+d) ? null : d; }
  const mm = Number(m[1]), dd = Number(m[2]);
  // 탭이 1월인데 12월 날짜면 전해다.
  const y = mm > t.m + 1 ? t.y - 1 : t.y;
  return new Date(y, mm - 1, dd);
};
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const fmt = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '-');

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title)).filter((t: string) => ymOf(t));

type Row = { tab: string; plate: string; state: string; pay: string; deliver: Date | null; supplier: string; channel: string; cust: string };
const rows: Row[] = [];
for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:BZ1400`)}`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { continue; }
  const hi = g.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = g[hi];
  const at = (...n: string[]) => { for (const x of n) { const i = h.findIndex((c) => c.replace(/\n/g, ' ').trim() === x); if (i >= 0) return i; } return -1; };
  const [ip, is, ipay, id, isup, ich, icu] = [at('차량번호'), at('상태 표기', '상태'), at('분납여부'), at('인도일'), at('업체명', '공급사'), at('에이전시', '영업채널'), at('고객명')];
  for (const r of g.slice(hi + 1)) {
    const p = key(r[ip]); if (!p) continue;
    rows.push({ tab, plate: p, state: S(r[is]), pay: ipay >= 0 ? S(r[ipay]) : '', deliver: id >= 0 ? dateOf(r[id], tab) : null, supplier: isup >= 0 ? S(r[isup]) : '', channel: ich >= 0 ? S(r[ich]) : '', cust: icu >= 0 ? S(r[icu]) : '' });
  }
}

// ★환수는 차번으로 본다 — 나중 달에 따로 선 줄이다.
const clawed = new Set(rows.filter((r) => /환수/.test(r.state)).map((r) => r.plate));
const cancelled = new Set(rows.filter((r) => /취소/.test(r.state)).map((r) => r.plate));
const today = new Date();

type Out = Row & { rounds: number; due: Date | null; verdict: string };
const out: Out[] = [];
for (const r of rows) {
  const m = /(\d)회/.exec(r.pay);
  if (!m) continue;                       // 일시납·빈칸은 분납이 아니다
  const rounds = Number(m[1]);
  if (rounds < 2) continue;
  const due = r.deliver ? addMonths(r.deliver, (rounds - 1) * GAP) : null;
  let verdict = '';
  if (clawed.has(r.plate)) verdict = '환수';
  else if (cancelled.has(r.plate)) verdict = '취소';
  else if (!r.deliver) verdict = '인도 전';
  else if (due && due > today) verdict = '진행중';
  else verdict = '완료';
  out.push({ ...r, rounds, due, verdict });
}

// 같은 차가 여러 달에 실린다 — 차번 하나로 접는다(제일 이른 인도일 기준).
const byPlate = new Map<string, Out>();
for (const x of out) {
  const p = byPlate.get(x.plate);
  if (!p || (x.deliver && (!p.deliver || x.deliver < p.deliver))) byPlate.set(x.plate, x);
}
const list = [...byPlate.values()];
const tally = new Map<string, number>();
for (const x of list) tally.set(x.verdict, (tally.get(x.verdict) || 0) + 1);

console.log(`\n■ 분납 건 ${list.length}대 — 회차 간격 ${GAP}개월로 봤을 때 (오늘 ${fmt(today)})\n`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(8)} ${String(n).padStart(4)}대`);

const 진행 = list.filter((x) => x.verdict === '진행중').sort((a, b) => (a.due?.getTime() || 0) - (b.due?.getTime() || 0));
console.log(`\n  ── ★계속 봐야 하는 것 — 진행중 ${진행.length}대`);
for (const x of 진행) console.log(`     ${x.plate.padEnd(11)} ${x.rounds}회 · 인도 ${fmt(x.deliver)} → 완료예정 ${fmt(x.due)}  ${x.supplier.slice(0, 8).padEnd(9)} ${x.channel.slice(0, 8).padEnd(9)} ${x.cust}`);

const 환수 = list.filter((x) => x.verdict === '환수');
console.log(`\n  ── 환수로 뒤집힌 분납 ${환수.length}대`);
for (const x of 환수.slice(0, 12)) console.log(`     ${x.plate.padEnd(11)} ${x.rounds}회 · 인도 ${fmt(x.deliver)}  ${x.supplier.slice(0, 8).padEnd(9)} ${x.channel}`);
if (환수.length > 12) console.log(`     … 외 ${환수.length - 12}대`);

writeFileSync('tmp/installment.json', JSON.stringify(list, null, 2));
console.log(`\n  목록 tmp/installment.json — 아무것도 안 썼다.`);
console.log(`  ⚠ 회차 간격 ${GAP}개월은 가정이다. 공급사마다 다르면 --gap 으로 다시 세거나 「수수료」 탭에 받아야 한다.\n`);
