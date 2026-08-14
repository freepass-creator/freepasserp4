/**
 * **대수 한 장 — 어느 숫자가 무엇을 센 것인지 한눈에.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「어떤 건 또 520대 막 이렇게 나오고 뭐가 맞는지 모르겄네」)
 *   숫자가 여러 개인 게 아니라 **세는 대상이 다르다.** 그런데 말할 때마다 그 대상을 안 붙이니
 *   듣는 사람에게는 그냥 «틀린 숫자가 여럿»으로 보인다. 그게 표를 못 믿게 만드는 길이다.
 *   그래서 **한 자리에서 전부 세고, 왜 다른지까지 같이 찍는다.**
 *
 * ★대수는 늘 **«우리 시트 / 아닌 시트 / 총»** 으로 가른다(사장님 2026-08-14).
 *   두 무리는 나가는 값이 다르다 — 우리 시트 차는 정제칸과 정책 43칸이 붙어 나가고,
 *   아닌 시트 차는 공급사가 적은 것만 나간다.
 * ★**금액 빠진 차도 같은 형식**으로 센다. 목록에 서 있어도 영업자가 견적을 못 내면 못 파는 차다.
 *
 * ⚠ 탭 «이름»에 적힌 대수를 믿지 마라. 이름은 찍을 때 박은 글자라 그 뒤에 사람이 줄을
 *   더하거나 지우면 그대로 어긋난다 — 실측 2026-08-14: 오플구독 이름은 89대인데 실제 90대였다.
 *   여기서는 **줄을 직접 센다.**
 *
 *   npx tsx scripts/report-counts.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { supplierNameKeys } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SALES = arg('sheet', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
const DOC_NAME = arg('name', '프리패스 재고');
/** 재고 탭으로 볼 이름 — 나머지(AI 정제·AI 인계)는 차를 담는 표가 아니다. */
const STOCK_TABS = /^(상품리스트|손오공구독|오플구독|오플프로모션)/;
const RENT_COLUMNS = ['1개월', '12개월', '24개월', '36개월', '48개월', '60개월'];
/** 며칠 지나면 «낡았다»고 볼까. 공급사는 거의 매일 손본다. */
const STALE_DAYS = 1.5;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** 문패가 우리가 만든 시트를 가리키는 공급사 — 이름은 별칭 꾸러미로 잇는다. */
const oursByName = new Set<string>();
{
  const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  const mine = new Map<string, string>();
  for (const f of ((files.files || []) as Rec[])) {
    const nm = S(f.name).replace(DOC_NAME, '').trim();
    for (const k of supplierNameKeys(nm)) if (!mine.has(k)) mine.set(k, S(f.id));
  }
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || !S(r[1])) continue;
    const keys = supplierNameKeys(S(r[0]));
    /**
     * ★«우리 시트»의 뜻 — 문패가 **우리가 만든 문서**를 가리키는 것.
     *   제공시트와 같은 문서이거나, 문서 이름에 「프리패스」가 든 규격화시트다.
     */
    let isOurs = false;
    for (const k of keys) if (mine.get(k) === id) isOurs = true;
    if (!isOurs) {
      try {
        const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`);
        if (/프리패스/.test(S(meta.properties?.title))) isOurs = true;
      } catch { /* 못 읽으면 아닌 것으로 둔다 — 모르는 것을 «맞음»으로 세지 않는다 */ }
    }
    if (isOurs) for (const k of keys) oursByName.add(k);
  }
}
const isOurs = (who: string) => [...supplierNameKeys(who)].some((k) => oursByName.has(k));

/** 판매시트 탭 — 이름이 아니라 «줄»을 센다. */
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=${encodeURIComponent('sheets.properties(title,hidden)')}`);
const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter((t) => STOCK_TABS.test(t));

console.log('\n■ 대수 한 장 — 어느 숫자가 무엇을 센 것인가\n');

type Row = { tab: string; when: string; days: number; ours: number; other: number; all: number; noMoney: number; noMoneySellable: number; canJudge: boolean };
const out: Row[] = [];
const allPlates = new Set<string>();

for (const t of titles) {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}/values/${encodeURIComponent(a1Tab(t))}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]);
  const hRow = rows.findIndex((r) => r.some((c) => S(c) === '차량번호'));
  if (hRow < 0) continue;
  const hdr = (rows[hRow] || []).map(S);
  const at = (n: string) => hdr.indexOf(n);
  const pi = at('차량번호'), wi = at('공급사'), si = at('배차상태');
  /**
   * ★요금 열을 **이름 모양으로** 찾는다 — 「12개월」뿐 아니라 「12개월 3만km」(오플)·
   *   「24개월 반납형」(손오공 구독)까지 잡아야 한다.
   *   ⚠ 표준 이름만 찾았더니 그 두 탭의 요금 열을 하나도 못 찾아 **159대가 «금액 없음»으로
   *     잘못 세어졌다**(실측 2026-08-14). 거짓 숫자는 «모름»보다 나쁘다 — 사람이 그걸 믿고 움직인다.
   */
  const ri = hdr.map((h, i) => (/\d+\s*개월/.test(h) || /^단기보증$|^장기보증$|보증금/.test(h) ? i : -1)).filter((i) => i >= 0);
  const canJudge = ri.length > 0;
  let ours = 0, other = 0, noMoney = 0, noMoneySellable = 0;
  const seen = new Set<string>();
  for (const r of rows.slice(hRow + 1)) {
    const p = S(r[pi]).replace(/\s/g, '');
    if (!p || seen.has(p)) continue;
    seen.add(p); allPlates.add(p);
    /**
     * ⚠ 오플 탭에는 「공급사」 열이 없다 — 그 탭 자체가 오플 것이다.
     *   열이 없다고 «모름»으로 두면 오플 114대가 어느 쪽에도 안 세어진다.
     */
    const who = wi >= 0 ? S(r[wi]) : (/^오플/.test(t) ? '오토플러스' : (/^손오공/.test(t) ? '손오공' : ''));
    if (isOurs(who)) ours++; else other++;
    if (canJudge && !ri.some((i) => S(r[i]))) {
      noMoney++;
      if (!/출고불가|계약중/.test(S(r[si]))) noMoneySellable++;
    }
  }
  // 탭 이름 끝에 「08.14 21:44」 같은 시각이 박혀 있다.
  const m = t.match(/(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  const when = m ? `${m[1]}.${m[2]} ${m[3]}:${m[4]}` : '?';
  const now = new Date();
  const stamp = m ? new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])) : null;
  const days = stamp ? (now.getTime() - stamp.getTime()) / 86400000 : -1;
  const named = Number((t.match(/·\s*(\d+)대/) || [])[1] || 0);
  out.push({ tab: t.split(' ')[0], when, days, ours, other, all: ours + other, noMoney, noMoneySellable, canJudge });
  if (!canJudge) console.log(`  ⚠ 「${t}」 — 요금 열을 못 찾아 «금액 빠진 차»를 못 셌다. «없다»가 아니라 «모름»이다.`);
  if (named && named !== ours + other) {
    console.log(`  ⚠ 「${t}」 — 탭 이름은 ${named}대인데 줄을 세면 ${ours + other}대다. 찍은 뒤 사람이 손댔다는 뜻이다.`);
  }
}

console.log(`  ${pad('탭', 12)}${pad('찍은 때', 13)}${pad('우리 시트', 11)}${pad('아닌 시트', 11)}${pad('총', 7)}금액 빠진 차`);
console.log(`  ${'─'.repeat(70)}`);
for (const r of out) {
  const stale = r.days > STALE_DAYS ? `  ← ${Math.floor(r.days)}일 낡음` : '';
  console.log(`  ${pad(r.tab, 12)}${pad(r.when, 13)}${pad(`${r.ours}대`, 11)}${pad(`${r.other}대`, 11)}${pad(`${r.all}대`, 7)}`
    + `${!r.canJudge ? '못 셈' : (r.noMoney ? `${r.noMoney}대${r.noMoneySellable ? ` (팔 수 있는데 ${r.noMoneySellable})` : ''}` : '없음')}${stale}`);
}
const sum = out.reduce((a, r) => ({ ours: a.ours + r.ours, other: a.other + r.other, all: a.all + r.all,
  noMoney: a.noMoney + (r.canJudge ? r.noMoney : 0), sell: a.sell + (r.canJudge ? r.noMoneySellable : 0),
  unknown: a.unknown + (r.canJudge ? 0 : r.all) }), { ours: 0, other: 0, all: 0, noMoney: 0, sell: 0, unknown: 0 });
console.log(`  ${'─'.repeat(70)}`);
console.log(`  ${pad('판매시트 전체', 25)}${pad(`${sum.ours}대`, 11)}${pad(`${sum.other}대`, 11)}${pad(`${sum.all}대`, 7)}${sum.noMoney}대${sum.sell ? ` (팔 수 있는데 ${sum.sell})` : ''}${sum.unknown ? ` · 못 센 차 ${sum.unknown}대` : ''}`);
console.log(`  서로 다른 차량번호 ${allPlates.size}대 — 탭끼리 겹치는 차가 ${sum.all - allPlates.size}대 있다는 뜻이다`);

console.log(`
  ${'─'.repeat(70)}
  ★**왜 숫자가 여러 개로 보이나** — 세는 대상이 다르다. 전부 맞는 숫자다.

     ${out.find((r) => r.tab === '상품리스트')?.all ?? '?'}대   「상품리스트」 한 탭만. 내가 «영업자 표»라고 할 때 보통 이 숫자다.
     ${sum.all}대   판매시트 재고 탭 넷을 다 더한 것(오플·손오공 구독은 요금 구조가 달라 탭이 따로다).
     ${allPlates.size}대   그중 서로 다른 차량번호.

  ⚠ 탭 이름에 적힌 대수는 **찍을 때 박은 글자**다. 그 뒤에 사람이 줄을 더하거나 지우면
     이름과 실제가 어긋난다. 이 도구는 늘 «줄»을 직접 센다.
`);
