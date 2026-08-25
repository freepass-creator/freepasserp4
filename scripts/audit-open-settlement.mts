/**
 * **아직 관리해야 하는 정산 건을 뽑는다(읽기 전용).**
 *
 * ★사장님 2026-08-25 「현재 진행중인 관리해야하는 항목들을 파악해봐 완료된거 아니고
 *   아직 분납 환수대상에서 관리해야하는거」.
 *
 * ★정본은 **원본 「프리패스 정산」**(월별 탭)이다. aiops 정산원장이 아니다 —
 *   실측 2026-08-25: 원본 3,027줄·차번 1,960종 · 원장 1,706줄·1,240종. 원장이 722종 빠져 있다.
 *
 * ★**«완료»를 우리가 정하지 않는다.** 분납 회차별 입금일이 시트 어디에도 없다.
 *   그래서 「2회분납이 끝났나」는 이 도구가 못 판정한다 — **분납 건 전부를 관리 대상으로 세고**,
 *   끝났는지는 사람이 표시해야 한다. 없는 데이터를 지어내 «완료»로 접지 않는다.
 *
 * ★갈래
 *   ① 분납 진행       분납여부가 2회·3회분납 — 최종완료 여부를 모른다
 *   ② 환수            상태가 환수 — 이미 청구한 것을 되돌려야 한다
 *   ③ 인도 전         인도일이 없다 — 청구 관문을 못 넘었다
 *   ④ 미청구          인도는 됐는데 청구금액이 비었다
 *
 *   npx tsx scripts/audit-open-settlement.mts
 *   npx tsx scripts/audit-open-settlement.mts --since=26/1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s/g, '');
const N = (v: unknown) => { const x = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(x) ? x : 0; };
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SINCE = arg('since', '26/1');
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

const ym = (tab: string) => { const m = /(\d{2})\s*\/\s*(\d{1,2})/.exec(tab); return m ? Number(m[1]) * 100 + Number(m[2]) : 0; };
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title)).filter((t: string) => ym(t) >= ym(SINCE));

type Row = { tab: string; row: number; plate: string; state: string; recv: string; deliver: string; pay: string; supplier: string; channel: string; owner: string; cust: string; rent: number; billed: number };
const rows: Row[] = [];
for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:BZ1400`)}`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { continue; }
  const hi = g.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = g[hi];
  const at = (...names: string[]) => { for (const n of names) { const i = h.findIndex((x) => x.replace(/\n/g, ' ').trim() === n); if (i >= 0) return i; } return -1; };
  const [ip, is, ir, id, ipay, isup, ich, iow, icu, irent, ibill] = [
    at('차량번호'), at('상태 표기', '상태'), at('접수일'), at('인도일'), at('분납여부'),
    at('업체명', '공급사'), at('에이전시', '영업채널'), at('영업자', '영업담당자'), at('고객명'),
    at('렌탈료'), at('계약완료건 청구 금액', '청구 금액', '공급사 청구금액'),
  ];
  g.slice(hi + 1).forEach((r, k) => {
    const p = key(r[ip]); if (!p) return;
    rows.push({
      tab, row: hi + 2 + k, plate: p, state: S(r[is]), recv: S(r[ir]), deliver: id >= 0 ? S(r[id]) : '',
      pay: ipay >= 0 ? S(r[ipay]) : '', supplier: isup >= 0 ? S(r[isup]) : '', channel: ich >= 0 ? S(r[ich]) : '',
      owner: iow >= 0 ? S(r[iow]) : '', cust: icu >= 0 ? S(r[icu]) : '', rent: irent >= 0 ? N(r[irent]) : 0,
      billed: ibill >= 0 ? N(r[ibill]) : 0,
    });
  });
}

const 분납 = rows.filter((r) => /2회|3회|분납/.test(r.pay) && !/일시납/.test(r.pay));
const 환수 = rows.filter((r) => /환수/.test(r.state));
const 인도전 = rows.filter((r) => !r.deliver && !/취소|환수/.test(r.state));
const 미청구 = rows.filter((r) => r.deliver && !r.billed && !/취소|환수/.test(r.state));

console.log(`\n■ 원본 「프리패스 정산」 ${SINCE} 이후 ${tabs.length}탭 · ${rows.length}줄 · 차번 ${new Set(rows.map((r) => r.plate)).size}종\n`);
console.log(`  ① 분납 진행   ${String(분납.length).padStart(4)}줄   ★최종완료 여부를 시트가 모른다(회차별 입금일이 없다)`);
console.log(`  ② 환수        ${String(환수.length).padStart(4)}줄   이미 청구한 것을 되돌려야 한다`);
console.log(`  ③ 인도 전     ${String(인도전.length).padStart(4)}줄   청구 관문을 못 넘었다`);
console.log(`  ④ 미청구      ${String(미청구.length).padStart(4)}줄   인도는 됐는데 청구금액이 비었다`);

const show = (name: string, list: Row[], n = 12) => {
  if (!list.length) return;
  console.log(`\n  ── ${name} (앞 ${Math.min(n, list.length)})`);
  for (const r of list.slice(0, n)) {
    console.log(`     ${r.tab.padEnd(13)} ${r.plate.padEnd(11)} ${r.state.slice(0, 8).padEnd(10)} ${(r.pay || '-').padEnd(7)} 접수 ${(r.recv || '-').padEnd(7)} 인도 ${(r.deliver || '-').padEnd(7)} ${r.supplier.slice(0, 7).padEnd(8)} ${r.channel.slice(0, 8)}`);
  }
  if (list.length > n) console.log(`     … 외 ${list.length - n}줄`);
};
show('① 분납 진행', 분납);
show('② 환수', 환수);
show('③ 인도 전', 인도전);
show('④ 미청구', 미청구, 8);

const bySup = new Map<string, number>();
for (const r of 분납) bySup.set(r.supplier, (bySup.get(r.supplier) || 0) + 1);
console.log('\n  ── 분납 건이 많은 공급사');
for (const [k, n] of [...bySup].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`     ${(k || '(빈칸)').padEnd(12)} ${n}건`);

writeFileSync('tmp/open-settlement.json', JSON.stringify({ 분납, 환수, 인도전, 미청구 }, null, 2));
console.log(`\n  목록 tmp/open-settlement.json — 아무것도 안 썼다.\n`);
