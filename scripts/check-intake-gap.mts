/**
 * **접수가 «빠진» 계약을 찾는다 — 원천에는 있는데 정산원장에 없는 차.**
 *
 * ★★★사장님 2026-09-04 「그냥 최 팀장이 이게 크로스 체크니까 **우리 쪽이 아예 접수 자체가 누락이 됐나 보네**」
 *
 * ★**무슨 일이 있었나.** 하허호가 8월 정산 탭 아래에 일곱 대를 「누락」이라고 적어 줬다.
 *   찾아보니 다섯 대는 우리 정산원장에 **접수 줄 자체가 없었다.** 그중 `05수5243`(이지현)은
 *   태윤 매니저 「프리패스 현황」에 **8/13 접수로 다 적혀 있었다** — 원본엔 있고 우리가 안 옮긴 것이다.
 *
 * ★★**그래서 «채널이 알려 줄 때까지» 기다리지 않는다.** 채널이 알려 주는 것은 정산 뒤고,
 *   그때는 이미 그 달 청구가 나간 뒤다. 마감 «전»에 원천과 원장을 맞대야 한다.
 *
 * 원천 셋을 본다 — 하나라도 있으면 계약이 있었다는 뜻이다.
 * ```
 * 프리패스 현황  「종합 (고객정보)」   태윤 매니저가 적는 접수 원본
 * 계약이력 정본  「계약이력」          계약서에서 확인된 계약
 * 채널 시트     합계 아래 「누락」 줄   상대가 「이건 빠졌다」고 적어 준 것(v4/sheet_edits)
 * ```
 *
 * ⚠⚠ **주민번호·연락처는 읽지도 찍지도 않는다.** 계약이력 정본에 그 칸이 있지만 이 검사는
 *   차량번호·이름·공급사·날짜만 본다. 누락을 찾는 데 그 이상은 필요 없다.
 *
 *   npx tsx scripts/check-intake-gap.mts            최근 석 달
 *   npx tsx scripts/check-intake-gap.mts 2026-08    그 달만
 *   npx tsx scripts/check-intake-gap.mts --보기      찾기만 하고 멈추지 않는다(exit 0)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const S = (v: unknown) => String(v ?? '').trim();
/** 차번은 가운데 빈칸이 섞여 온다 — 「133하 5131」과 「133하5131」은 같은 차다. */
const P = (v: unknown) => { const t = S(v).replace(/\s+/g, ''); return /^\d{2,3}[가-힣]\d{4}$/.test(t) ? t : ''; };
const nm = (v: unknown) => S(v).replace(/[\s()·]/g, '');
/** 「2026. 8. 13」 · 「2026-08-13」 · 엑셀 날짜 → 「2026-08」. */
const ym = (v: unknown): string => {
  const s = S(v);
  const m = /^(\d{4})[.\-/\s]+(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return '';
};
const ymAdd = (v: string, n: number) => { const y = Number(v.slice(0, 4)); const m = Number(v.slice(5)) + n;
  return `${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12 + 12) % 12 + 1).padStart(2, '0')}`; };

const MONTH = S(process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)));
const LOOK = process.argv.includes('--보기');
const now = new Date();
const THIS = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
/** 달을 안 주면 «최근 석 달» — 그보다 오래된 것은 이미 다른 데서 걸렸거나 손으로 정리된 것이다. */
const FROM = MONTH || ymAdd(THIS, -2);
const TO = MONTH || THIS;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const grid = async (id: string, tab: string, range = 'A1:BZ4000'): Promise<unknown[][]> =>
  (((await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!${range}`)}`,
    { headers: { Authorization: `Bearer ${await tok()}` } })).json()) as { values?: unknown[][] }).values) || [];

const LEDGER = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';   // [F04] 프리패스 정산원장
const STATUS = '1AF3XBsnfZ4MahYWWnZa1AOsbuIcQ07NJ5pUOCMpQceg';   // 프리패스 현황 (태윤 매니저 접수 원본)
const HISTORY = '1twPcUSbJkBs-8TF3AL_f7pSpj3iGBfSboI1fUFY_n4M';  // [A02] 계약이력 정본

// ── 원장에 «있는 것» ────────────────────────────────────────
/**
 * ★열쇠는 «차번 + 이름»이다. 차번만으로는 안 된다 — 한 차가 손님을 갈아 탄다
 *   (실측 `116하2308` 은 최진우·이정민·남보석 셋을 태웠다). 차번만 보면 새 계약을 「이미 있다」로 넘긴다.
 */
const mine = new Set<string>(); const minePlates = new Set<string>();
for (const r of Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Record<string, unknown>[]) {
  const p = P(r.plate); if (!p) continue;
  minePlates.add(p); mine.add(`${p}|${nm(r.customer)}`);
}

// ── 원천에서 «있었던 것» ────────────────────────────────────
type Cand = { plate: string; who: string; sup: string; when: string; from: string; note: string };
const found: Cand[] = [];
const inWindow = (v: string) => !v || (v >= FROM && v <= TO);

/** ① 프리패스 현황 — 태윤 매니저가 적는 접수 원본. */
{
  const g = await grid(STATUS, '종합 (고객정보)');
  const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
  if (hi >= 0) {
    const h = (g[hi] || []).map(S);
    const at = (n: string) => h.indexOf(n);
    for (const r of g.slice(hi + 1)) {
      const plate = P((r || [])[at('차량번호')]); if (!plate) continue;
      const when = ym((r || [])[at('접수일')]) || ym((r || [])[at('출고일')]);
      if (!inWindow(when)) continue;
      found.push({ plate, who: S((r || [])[at('고객명')]), sup: S((r || [])[at('렌트사')]),
        when, from: '프리패스 현황', note: S((r || [])[at('진행상태')]) });
    }
  }
}

/** ② 계약이력 정본 — 계약서에서 확인된 계약. ⚠ 주민번호·연락처 칸은 손대지 않는다. */
{
  const g = await grid(HISTORY, '계약이력');
  const hi = g.findIndex((r) => S((r || [])[0]) === '차량번호');
  if (hi >= 0) {
    const h = (g[hi] || []).map(S);
    const at = (re: RegExp) => h.findIndex((x) => re.test(x));
    const [cp, cw, cs, cc, cg] = [at(/^차량번호$/), at(/계약자/), at(/계약시작/), at(/^회사$/), at(/^영업자$/)];
    for (const r of g.slice(hi + 1)) {
      const plate = P((r || [])[cp]); if (!plate) continue;
      const when = ym((r || [])[cs]); if (!inWindow(when) || !when) continue;
      /** ★영업채널을 거친 건만 본다 — 스위치·프라임 자체 계약은 이 정산의 몫이 아니다. */
      if (cg < 0 || !S((r || [])[cg])) continue;
      found.push({ plate, who: S((r || [])[cw]), sup: S((r || [])[cc]), when, from: '계약이력 정본', note: '' });
    }
  }
}

/** ③ 채널이 적어 준 「누락」 줄. */
{
  for (const e of Object.values((await db.ref('v4/sheet_edits').get()).val() || {}) as Record<string, unknown>[]) {
    if (S(e.column) !== '누락' || S(e.status) !== '대기') continue;
    const plate = P(e.key); if (!plate) continue;
    if (!inWindow(S(e.month))) continue;
    found.push({ plate, who: S(e.why).replace(/^그쪽이 적음 — /, '').split(' · ')[0], sup: '',
      when: S(e.month), from: `${S(e.channel)} 시트 「누락」`, note: S(e.theirs) });
  }
}

// ── 맞대 보기 ──────────────────────────────────────────────
const seen = new Set<string>();
const gaps = found.filter((c) => {
  if (c.who && mine.has(`${c.plate}|${nm(c.who)}`)) return false;
  /** 이름을 모르는 원천(누락 줄 등)은 차번이 아예 없을 때만 올린다 — 아니면 거짓 경보가 쏟아진다. */
  if (!c.who && minePlates.has(c.plate)) return false;
  const k = `${c.plate}|${nm(c.who)}`;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

console.log(`\n■ 접수 누락 후보 — ${MONTH || `${FROM} ~ ${TO}`}`);
console.log(`   원장에 든 차 ${minePlates.size}대 · 원천에서 본 것 ${found.length}건\n`);

const show = (title: string, rows: Cand[]) => {
  if (!rows.length) return;
  console.log(`  ── ${title} (${rows.length}건)`);
  console.log(`     ${'차량번호'.padEnd(10)} ${'고객'.padEnd(10)} ${'공급사'.padEnd(9)} ${'언제'.padEnd(9)} 어디서`);
  for (const c of rows.sort((a, b) => `${a.when}${a.plate}`.localeCompare(`${b.when}${b.plate}`))) {
    console.log(`     ${c.plate.padEnd(10)} ${(c.who || '-').padEnd(10)} ${(c.sup || '-').padEnd(9)} ${(c.when || '-').padEnd(9)} ${c.from}${c.note ? `  · ${c.note.slice(0, 40)}` : ''}`);
  }
  console.log('');
};
show('원천에 있는데 정산원장에 «없다»', gaps);

if (!gaps.length) { console.log('  ✓ 원천과 원장이 맞습니다 — 빠진 접수가 없습니다.\n'); process.exit(0); }
console.log(`  ${LOOK ? '※' : '✕'} 접수 누락 후보 ${gaps.length}건`);
console.log('     → 정산원장 「접수」 탭에 넣고 `npm run settlement:import` 로 원자에 올립니다.');
console.log('     → 이미 취소·보류된 건이면 원천 쪽에 그렇게 적어 주세요. 안 그러면 매달 또 뜹니다.\n');
process.exit(LOOK || !gaps.length ? 0 : 1);
