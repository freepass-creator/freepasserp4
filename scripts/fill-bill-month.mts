/**
 * **정산원장 「접수·분납실적·완납실적」 탭의 «청구년·청구월»을 기계가 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-04 「근데 그 청구월 적힌거를 니가 자동으로 해줘야한다고」.
 *   앞서 「시트에 접수할때 청구월을 바로입력하게 해놨어」 하셨는데, 손으로 적다 보니
 *   «옛 규칙으로 적힌 값»이 섞였다 — 7월 접수 2회분납이 「7」로 적혀 있다(규칙대로면 8월).
 *
 * ★★**규칙**(사장님 2026-09-01 · 09-04)
 * ```
 * 일시납        인도월                      인도되면 바로 전액 청구
 * n회분납       접수월 + (n−1)               접수 때부터 회차가 돈다 — 인도일이 아니다
 * 부러지면       접수월 + (받은 회차 − 1)       그 자리에서 청구하고, 금액은 받은 회차만큼
 *              (3회 중 1회만 받았으면 1/3)
 * ```
 *   ⚠ 부러진 건의 «금액 조정»은 이 도구가 하지 않는다 — 회차가 어디서 끊겼는지는
 *     사람이 아는 일이다. 달만 채우고, 끊긴 건은 표시해 사람에게 넘긴다.
 *
 * ★★★**덮어쓰기 전에 «무엇이 바뀌나»를 보여 준다.** 이미 청구서가 나간 달은 건드리면 안 되고,
 *   사람이 뜻이 있어 적은 값일 수도 있다. dry-run 이 기본인 까닭이다.
 *
 *   npx tsx scripts/fill-bill-month.mts
 *   npx tsx scripts/fill-bill-month.mts --apply
 *   npx tsx scripts/fill-bill-month.mts --only=분납실적 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { dateOf, roundsOf, ymOf } from '../lib/domain/settlement-billing-month';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = S((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]);
const TABS = ['접수', '분납실적', '완납실적'].filter((t) => !ONLY || t === ONLY);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

/** 「26-07-02」·「2026-07-02」 둘 다 받는다 — 시트가 두 꼴을 섞어 쓴다. */
const day = (v: unknown): Date | null => {
  const s = S(v);
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dateOf(s);
};
const addM = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

console.log(`\n■ 청구월 채우기 ${APPLY ? '(반영)' : '(대조만)'} — ${TABS.join(' · ')}`);

let same = 0; let fill = 0; let change = 0; let cannot = 0;
const shown: string[] = [];
for (const tab of TABS) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${tab}'!A1:T2000`)}`,
    { headers: { Authorization: `Bearer ${await tok()}` } });
  const g = ((await r.json()) as { values?: unknown[][] }).values || [];
  const hi = g.findIndex((v) => (v || []).some((c) => /차량\s*번호|차번/.test(S(c))));
  if (hi < 0) { console.log(`   ✕ ${tab} — 머리줄을 못 찾음`); continue; }

  /** S=청구년 · T=청구월 (0-based 18 · 19) */
  const put: { row: number; y: string; m: string }[] = [];
  for (let i = hi + 1; i < g.length; i++) {
    const v = g[i] || [];
    const plate = S(v[1]);
    if (!plate) continue;
    const recv = day(v[0]); const deliv = day(v[17]);
    const n = roundsOf(v[14]);
    const want = n >= 2 ? (recv ? ymOf(addM(recv, n - 1)) : '') : (deliv ? ymOf(deliv) : '');
    const nowY = S(v[18]).replace(/[,\s]/g, ''); const nowM = S(v[19]);
    const now = nowY && nowM ? `${nowY}-${String(Number(nowM)).padStart(2, '0')}` : '';
    /**
     * ★★★**적혀 있으면 «그대로» 둔다** — 사장님 2026-09-04
     *   「청구월 적혀있으면 그거대로 반영하고 없는거는 아까 말한 규칙대로 하면 되고」.
     *   사람이 적은 달은 «뜻이 있어» 적은 것이다 — 부러졌거나, 협의해 옆기거나.
     *   계산이 그걸 덮으면 사람이 한 일이 소리 없이 사라진다. 빈칸만 채운다.
     * ⚠ 다만 «규칙과 다른 값»은 세서 보여 준다 — 고칠지는 사람이 정한다.
     */
    if (!want) { cannot++; continue; }
    if (now) {
      if (now === want) same++;
      else {
        change++;
        if (shown.length < 25) shown.push(`   ${tab.padEnd(6)} ${plate.padEnd(10)} 접수 ${S(v[0]).padEnd(10)} ${S(v[14]).padEnd(6)} 인도 ${(S(v[17]) || '-').padEnd(10)}   적힌 값 ${now} · 규칙 ${want}`);
      }
      continue;
    }
    fill++;
    put.push({ row: i + 1, y: want.slice(0, 4), m: String(Number(want.slice(5))) });
  }

  if (APPLY && put.length) {
    const data = put.map((p) => ({ range: `'${tab}'!S${p.row}:T${p.row}`, values: [[p.y, p.m]] }));
    for (let k = 0; k < data.length; k += 200) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values:batchUpdate`, {
        method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(k, k + 200) }) });
    }
  }
  console.log(`   ${tab.padEnd(6)} 손댈 줄 ${String(put.length).padStart(4)}`);
}

console.log(`\n   그대로 ${same} · 빈칸을 채움 ${fill} · «값이 바뀜» ${change} · 못 셈 ${cannot}`);
if (shown.length) { console.log('\n■ 값이 바뀌는 줄 (앞 25개)'); for (const l of shown) console.log(l); }
console.log(APPLY ? '\n   ✓ 시트에 썼습니다 — 다음 동기(①②)에 원자로 들어갑니다\n'
  : '\n※ dry-run — 시트를 안 건드렸습니다. --apply 로 씁니다.\n');
process.exit(0);
