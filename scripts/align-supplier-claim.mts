/**
 * **공급사가 보내 준 정산서에 우리 원장(F04)을 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-07 「손오공 기준대로 우리거에 맞춰봐」 ·
 *   「손오공은 일단 저거로 하고 다음달에 가감하기로 했어」 · 「메모에 이번달만 이렇게 선지급하는거야」
 *
 * ★★**왜 갈렸나 — 규칙이 다르다.**
 * ```
 * 우리     분납은 «완납했을 때» 청구      (박태윤 매니저 「기본적으로 완납 했을때 정산 들어갑니다」)
 * 손오공   분납 중에도 «조정지급율»로 절반씩 청구 — 이번 달만 선지급
 * ```
 *   그래서 우리 원장에는 줄이 다 있는데 **청구월이 안 박혀** 그 달에 안 실렸다.
 *   ⇒ 이번 달만 손오공 안대로 맞추고, **비고에 그렇게 적어 둔다** — 안 적으면 다음 달에
 *     「왜 이 달만 절반이지」를 아무도 모른다. 다음 달 가감의 근거가 그 한 줄이다.
 *
 * ★★★**지급도 «같은 비율»로 내린다.** 청구만 절반으로 내리고 지급을 그대로 두면
 *   그 차액이 통째로 우리 손해다(실측 네 줄에 −123만). 마진율을 지키려면 같이 내려야 한다.
 *   ⇒ 지급 = 기존 지급 × (공급사 청구 ÷ 기존 청구). 기존 청구가 0이면 셈이 안 되니 사람이 정한다.
 *
 * ⚠ **원장에 없는 줄은 여기서 안 만든다.** 접수부터 들어가야 하는 일이라 조건(대여료·기간·
 *   납입방식)이 필요하다 — 짐작으로 새 계약을 세우지 않는다. 목록만 알린다.
 *
 * ```
 * npx tsx scripts/align-supplier-claim.mts --파일=tmp/sonokong-08.xlsx --탭="26년8월-최종(손)" --월=2026-08
 * npx tsx scripts/align-supplier-claim.mts --파일=... --탭=... --월=2026-08 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩%]/g, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => { const t = S(v).replace(/\s+/g, ''); return /^\d{2,3}[가-힣]\d{4}$/.test(t) ? t : ''; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const FILE = S(arg('파일')); const TAB = S(arg('탭')); const MONTH = S(arg('월'));
const MEMO = S(arg('메모')) || `${MONTH} 한정 — 공급사 선지급분(분납 중 조정지급율). 다음 달 가감`;
const APPLY = process.argv.includes('--apply');
if (!FILE || !TAB || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.log('\n  npx tsx scripts/align-supplier-claim.mts --파일=a.xlsx --탭="26년8월-최종(손)" --월=2026-08 [--apply]\n');
  process.exit(1);
}

/**
 * **공급사 종이의 칸 차례** — 실측 손오공 「최종(손)」.
 * ```
 * 0 계약번호 · 2 고객명 · 3 차량번호 · 4 구분 · 5 납입방식 · 6 기간 · 8 대여료
 * 16 과표 · 18 요율 · 19 100% 소계 · 20 조정지급율 · 21 실청구(공급가액)
 * ```
 * ⚠ 자리로 읽는다 — 머리가 두 줄이라 이름으로 못 찍는다. 다른 공급사 서식이면 여기를 고친다.
 */
const wb = XLSX.read(readFileSync(FILE));
if (!wb.Sheets[TAB]) { console.log(`\n  ✕ 「${TAB}」 탭이 없습니다 — ${wb.SheetNames.join(' · ')}\n`); process.exit(1); }
const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[TAB], { header: 1, raw: false, defval: '' });
const hi = grid.findIndex((r) => S((r || [])[0]) === '계약번호');
if (hi < 0) { console.log('\n  ✕ 「계약번호」 머리줄을 못 찾았습니다\n'); process.exit(1); }
type Paper = { plate: string; cust: string; kind: string; payKind: string; term: number; rent: number; full: number; ratio: number; net: number };
const paper = new Map<string, Paper>();
for (const r0 of grid.slice(hi + 2)) {
  const r = (r0 || []) as unknown[];
  if (S(r[0]).replace(/\s/g, '') === '합계') break;
  const plate = P(r[3]); if (!plate) continue;
  paper.set(`${plate}|${S(r[2])}`, { plate, cust: S(r[2]), kind: S(r[4]), payKind: S(r[5]),
    term: N(r[6]), rent: N(r[8]), full: N(r[19]), ratio: N(r[20]) / 100, net: N(r[21]) });
}
console.log(`\n■ ${MONTH} — 「${TAB}」 ${paper.size}줄로 F04 를 맞춘다 ${APPLY ? '(반영)' : '(대조만)'}\n`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) { console.log(`\n  ✕ 조회·쓰기 실패 ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r;
};
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

const puts: { range: string; values: (string | number)[][] }[] = [];
const lines: string[] = []; const stuck: string[] = [];
let before = 0; let after = 0;
for (const tab of ['접수', '완납실적', '분납실적']) {
  const g = (((await (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F04}/values/${encodeURIComponent(`'${tab}'!A1:BB800`)}?valueRenderOption=UNFORMATTED_VALUE`)).json()) as { values?: unknown[][] }).values) || [];
  const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호')); if (h0 < 0) continue;
  const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
  for (let i = h0 + 1; i < g.length; i++) {
    const r = g[i] || []; const plate = P(r[ix('차량번호')]); if (!plate) continue;
    const p = paper.get(`${plate}|${S(r[ix('고객명')])}`); if (!p) continue;
    paper.delete(`${plate}|${S(r[ix('고객명')])}`);
    const oc = Math.round(N(r[ix('판매수수료')])); const op = Math.round(N(r[ix('출고수수료')]));
    const inMonth = N(r[ix('청구년')]) === Number(MONTH.slice(0, 4)) && N(r[ix('청구월')]) === Number(MONTH.slice(5));
    if (inMonth) before += oc;
    after += p.net;
    /** ★지급도 «같은 비율»로 — 마진율을 지킨다. 기존 청구가 0이면 셈이 안 된다. */
    const np = oc > 0 ? Math.round(op * (p.net / oc)) : -1;
    const todo: string[] = [];
    if (!inMonth) { todo.push(`청구월 ${MONTH.slice(0, 4)}/${Number(MONTH.slice(5))} 박기`);
      puts.push({ range: `'${tab}'!${A1(ix('청구년'))}${i + 1}`, values: [[Number(MONTH.slice(0, 4))]] });
      puts.push({ range: `'${tab}'!${A1(ix('청구월'))}${i + 1}`, values: [[Number(MONTH.slice(5))]] }); }
    if (oc !== p.net) { todo.push(`청구 ${won(oc)} → ${won(p.net)}`);
      puts.push({ range: `'${tab}'!${A1(ix('판매수수료'))}${i + 1}`, values: [[p.net]] }); }
    if (np >= 0 && np !== op) { todo.push(`지급 ${won(op)} → ${won(np)}`);
      puts.push({ range: `'${tab}'!${A1(ix('출고수수료'))}${i + 1}`, values: [[np]] }); }
    if (np < 0) stuck.push(`  ? ${plate.padEnd(10)} ${p.cust.padEnd(7)} — 기존 청구가 0이라 지급 비율을 못 셉니다. 지급을 사람이 정해 주세요.`);
    /** ★비고에 «왜 이 달만 다른가»를 남긴다 — 다음 달 가감의 근거다. */
    const memoCol = ix('비고');
    if (memoCol >= 0) { const had = S(r[memoCol]);
      if (!had.includes(MEMO)) puts.push({ range: `'${tab}'!${A1(memoCol)}${i + 1}`, values: [[had ? `${had} · ${MEMO}` : MEMO]] }); }
    lines.push(`  ${plate.padEnd(10)} ${p.cust.padEnd(7)} ${tab.padEnd(5)}${String(i + 1).padStart(4)}행  ${todo.join(' · ') || '그대로'}`);
  }
}
lines.forEach((l) => console.log(l));
if (paper.size) {
  console.log('\n  ✕ F04 에 «없는» 줄 — 접수부터 넣어야 합니다(조건이 필요해 여기서 안 만듭니다)');
  for (const p of paper.values()) console.log(`     ${p.plate.padEnd(10)} ${p.cust.padEnd(7)} ${p.kind} ${p.payKind} ${p.term}개월 대여료 ${won(p.rent)} → 청구 ${won(p.net)} (100% ${won(p.full)} × ${Math.round(p.ratio * 100)}%)`);
}
if (stuck.length) { console.log('\n  ★사람이 정할 줄'); stuck.forEach((s) => console.log(s)); }
console.log(`\n   비고에 남길 말 — 「${MEMO}」`);
console.log(`   ${MONTH} 그 공급사 청구  ${won(before)} → ${won(after)}   (고칠 칸 ${puts.length}개)`);
if (!puts.length) { console.log('\n  ✓ 고칠 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 맞춥니다.\n'); process.exit(0); }
await api(`https://sheets.googleapis.com/v4/spreadsheets/${F04}/values:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: puts }) });
console.log(`\n  ✓ ${puts.length}칸을 맞췄습니다.`);
console.log(`  ※ 이어서 — npx tsx scripts/run-settlement-month.mts ${MONTH} --apply\n`);
process.exit(0);
