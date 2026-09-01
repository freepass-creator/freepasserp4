/**
 * **접수 날짜 규칙 — 두 모양이 같은 날을 가리키나.** 순수 계산 + 원장 실측. 읽기만.
 *
 * ★사장님 2026-08-26 「접수년 접수월 접수일 그냥 숫자만 / 한칸에 하나씩 하면 필터 잡기도 편하고」.
 *
 * ★★**이관은 «값이 안 바뀌는 것»이 전부다.** 431줄을 옛 모양으로 읽은 날짜와
 *   새 모양(년·월·일)으로 다시 읽은 날짜가 한 줄이라도 다르면 이관하면 안 된다.
 *
 *   npx tsx scripts/check-settlement-date.mts          규칙만
 *   npx tsx scripts/check-settlement-date.mts --live   원장 431줄까지
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { receivedDate, fullYear, ymdText, isoText, splitCells, billMonthOf, billCells, isSplitShape } from '../lib/domain/settlement-date';

const fail: string[] = [];
const ok = (why: string, cond: boolean) => { console.log(`  ${cond ? '○' : '✕'} ${why}`); if (!cond) fail.push(why); };
const S = (v: unknown) => String(v ?? '').trim();

console.log('\n■ 접수 날짜 규칙\n');

console.log('[두 자리 연도]');
ok('26 → 2026', fullYear(26) === 2026);
ok('2026 → 2026', fullYear(2026) === 2026);
ok('★1926 으로 안 읽는다', fullYear(26) !== 1926);

console.log('\n[새 모양 — 년·월·일 숫자 셋]');
ok('26 · 8 · 23 → 2026-08-23', isoText(receivedDate(26, 8, 23)) === '2026-08-23');
ok('2026 · 8 · 23 도 같다', isoText(receivedDate(2026, 8, 23)) === '2026-08-23');
ok('조합 칸은 26-08-23', ymdText(receivedDate(26, 8, 23)) === '26-08-23');
ok('★2월 30일은 «모른다» (3월 2일로 넘기지 않는다)', receivedDate(26, 2, 30) === null);
ok('13월은 모른다', receivedDate(26, 13, 1) === null);
ok('빈칸은 모른다', receivedDate('', '', '') === null);

console.log('\n[옛 모양 — 시리얼 한 칸]');
// ★기대값을 손으로 세지 않는다 — 46092 를 3월 4일로 잘못 적어 한 번 헛짚었다(2026-08-26).
//   시리얼 0일(1899-12-30)에서 세어 나온 날과 맞대면 된다.
const serial = (n: number) => { const u = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`; };
ok('시리얼 46092 를 그대로 읽는다', isoText(receivedDate('', '', 46092)) === serial(46092));
ok('   (46092 = ' + serial(46092) + ')', true);
ok('년·월이 비어 있어도 시리얼이면 읽는다', receivedDate('', '', 45943) !== null);
ok('문자 날짜도 읽는다', isoText(receivedDate('', '', '2026-07-23')) === '2026-07-23');

console.log('\n[모양 가르기]');
ok('23 은 새 모양', isSplitShape(23));
ok('46092 는 새 모양이 아니다', !isSplitShape(46092));
ok('0 은 새 모양이 아니다', !isSplitShape(0));

console.log('\n[되돌리기]');
const d = receivedDate(26, 8, 23)!;
const c = splitCells(d);
ok('날짜 → 칸 셋 → 날짜 가 제자리', isoText(receivedDate(c.y, c.m, c.d)) === isoText(d));

console.log('\n[청구 — 년·월만]');
ok('26 · 8 → 2026-08', billMonthOf(26, 8) === '2026-08');
ok('2026-08 → 년 26 · 월 8', billCells('2026-08').y === 26 && billCells('2026-08').m === 8);
ok('월이 없으면 빈 값', billMonthOf(26, '') === '');

// ── 원장 실측 ──────────────────────────────────────────────
if (process.argv.includes('--live')) {
  console.log('\n■ 원장 431줄 — 옛 모양과 새 모양이 같은 날인가\n');
  const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const api = async (u: string) => {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
    return JSON.parse(x) as { values?: unknown[][] };
  };

  let rows = 0; let same = 0; const diff: string[] = []; const none: string[] = [];
  const keys = new Set<string>(); let dup = 0;
  for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
    const g = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
    const all = ((g.values || []) as unknown[][]).map((r) => (r || []).map(S));
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const h = all[hi]; const at = (n: string) => h.indexOf(n);
    for (const r of all.slice(hi + 1)) {
      const plate = S(r[at('차량번호')]); if (!plate) continue;
      rows++;
      const old = receivedDate('', '', r[at('접수일')]);        // 지금 모양
      if (!old) { none.push(`${tab} ${plate}`); continue; }
      // 이관 뒤 모양으로 다시 읽는다
      const c2 = splitCells(old);
      const now = receivedDate(c2.y, c2.m, c2.d);
      if (isoText(now) === isoText(old)) same++;
      else diff.push(`${tab} ${plate} — 옛 ${isoText(old)} / 새 ${isoText(now)}`);
      // ★줄 열쇠가 그대로 유일한가
      const k = `${plate}|${isoText(old)}`;
      if (keys.has(k)) dup++; else keys.add(k);
    }
  }
  console.log(`  줄 ${rows} · 날짜가 같음 ${same} · 다름 ${diff.length} · 접수일이 없음 ${none.length}`);
  for (const x of diff.slice(0, 10)) console.log(`     ${x}`);
  for (const x of none.slice(0, 5)) console.log(`     접수일 없음 — ${x}`);
  ok('★431줄 전부 같은 날을 가리킨다', diff.length === 0);
  ok('★줄 열쇠(차번+접수일)가 그대로 유일하다', dup === 0);
  console.log(`     (접수일이 없는 ${none.length}줄은 이관해도 그대로 비어 있다 — 사람이 채워야 한다)`);
}

console.log(fail.length ? `\n✕ ${fail.length}건 어긋남 — ${fail.join(' / ')}\n` : '\n○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
