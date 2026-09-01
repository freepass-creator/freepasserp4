/**
 * **「수수료표」 탭에 «박태윤 입력» 구역을 깐다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「일단 태윤이한테 수수료칸에 박태윤입력으로 그 밑으로 구성하라고했음」.
 *
 * ★**빈 표를 주지 않는다.** 기존 실적 791칸을 역산한 결과를 **초안으로 깔아** 둔다 —
 *   사람은 «채우는» 게 아니라 «고치는» 일만 하면 되고, 건수가 옆에 있어 근거가 보인다.
 *   (역산 도구 `scripts/derive-fee-rules.mts`)
 * ★건수가 적거나 요율이 갈리는 줄은 **비워 두고 「확인 필요」**라고 적는다 —
 *   짐작한 값을 깔면 그게 그대로 청구액이 된다.
 *
 *   npx tsx scripts/publish-fee-input-block.mts
 *   npx tsx scripts/publish-fee-input-block.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const TAB = '수수료표';
const MARK = '★ 박태윤 입력';
const TOL = 2;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(15_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

// ── 실적에서 역산 ────────────────────────────────────────────────
type Hit = { sup: string; prod: string; term: number; rate: number; side: 0 | 1 };
const hits: Hit[] = [];
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    if (!S(r[at('차량번호')])) continue;
    const sup = S(r[at('공급사')]), prod = S(r[at('상품구분')]), term = N(r[at('계약기간')]);
    const rent = N(r[at('렌탈료')]), price = N(r[at('차량가액')]);
    for (const [side, rc, fc] of [[0, '공급사수수료율', '판매수수료'], [1, '에이전시수수료율', '출고수수료']] as const) {
      const rate = N(r[at(rc)]), fee = N(r[at(fc)]);
      if (!rate || !fee) continue;
      // ★적힌 요율이 «그 산식으로» 맞아떨어질 때만 근거로 센다. 안 맞으면 규칙이 아니다.
      const ok = rate >= 1 ? Math.abs(rate - fee) <= TOL
        : (rent && term && Math.abs(rent * term * rate - fee) <= TOL) || (price && Math.abs(price * rate - fee) <= TOL);
      if (ok) hits.push({ sup, prod, term, rate, side: side as 0 | 1 });
    }
  }
}

const baseOf = (prod: string, rate: number) => (rate >= 1 ? '고정' : /선출고|견적출고/.test(prod) ? '차량가액' : '대여료×기간');
/**
 * ★**표준은 «기준 × 기간»이 정하고, 공급사는 예외만 적는다.**
 *   공급사별로 쪼개면 한 줄에 두세 건뿐이라 근거가 얇아진다(실측 73줄 중 37줄이 그랬다).
 *   실제로는 48개월 3.25% 가 115건처럼 «기간»이 요율을 정하고, 몇몇 공급사만 다르다.
 */
const slotOf = (h: Hit) => { const b = baseOf(h.prod, h.rate); return `${b}|${b === '대여료×기간' ? `${h.term}개월` : h.prod || '(빈칸)'}`; };
const top = (m: Map<number, number>) => [...m].sort((a, b) => b[1] - a[1])[0];
const pct = (v: number) => (v >= 1 ? v.toLocaleString('ko-KR') : `${Number((v * 100).toFixed(3))}%`);

/** 표준 — 슬롯마다 «제일 많이 쓴 요율». */
const std = new Map<string, [Map<number, number>, Map<number, number>]>();
for (const h of hits) {
  const k = slotOf(h);
  if (!std.has(k)) std.set(k, [new Map(), new Map()]);
  const m = std.get(k)![h.side];
  m.set(h.rate, (m.get(h.rate) || 0) + 1);
}
/** 공급사 예외 — 그 슬롯의 표준과 «다른 요율»을 쓴 곳만. */
const ex = new Map<string, [Map<number, number>, Map<number, number>]>();
for (const h of hits) {
  const k = slotOf(h);
  const t = std.get(k)![h.side].size ? top(std.get(k)![h.side])[0] : null;
  if (t !== null && Math.abs(t - h.rate) < 1e-9) continue;   // 표준과 같으면 예외가 아니다
  const ek = `${h.sup || '(빈칸)'}|${k}`;
  if (!ex.has(ek)) ex.set(ek, [new Map(), new Map()]);
  const m = ex.get(ek)![h.side];
  m.set(h.rate, (m.get(h.rate) || 0) + 1);
}

const HEAD = ['구분', '기준', '기간 · 상품', '공급사', '공급사율', '에이전시율', '건수', '비고 · 확인'];
const body: string[][] = [];
for (const [k, [m0, m1]] of [...std].sort()) {
  const [base, slot] = k.split('|');
  const t0 = m0.size ? top(m0) : null, t1 = m1.size ? top(m1) : null;
  const n = (t0?.[1] ?? 0) + (t1?.[1] ?? 0);
  const shaky = (m0.size > 1 ? '공급사율 갈림 ' : '') + (m1.size > 1 ? '에이전시율 갈림 ' : '');
  const thin = n <= 3 ? '건수 적음 ' : '';
  const risky = !!thin;   // 표준은 «갈림»이 있어도 다수결로 깐다. 얇으면 안 깐다.
  body.push(['표준', base, slot, '', risky ? '' : t0 ? pct(t0[0]) : '', risky ? '' : t1 ? pct(t1[0]) : '', String(n),
    risky ? `확인 필요 — ${thin}(역산: ${t0 ? `공급사 ${pct(t0[0])}` : ''}${t1 ? ` · 에이전시 ${pct(t1[0])}` : ''})`
      : shaky ? `다수결로 깔았음 — ${shaky}있음` : '역산으로 채움 — 다르면 고치세요']);
}
for (const [k, [m0, m1]] of [...ex].sort()) {
  const [sup, base, slot] = k.split('|');
  const t0 = m0.size ? top(m0) : null, t1 = m1.size ? top(m1) : null;
  const n = (t0?.[1] ?? 0) + (t1?.[1] ?? 0);
  body.push(['예외', base, slot, sup, t0 ? pct(t0[0]) : '', t1 ? pct(t1[0]) : '', String(n),
    n <= 2 ? '건수 적음 — 한 번 협의한 건인지 확인' : '이 공급사만 다름']);
}

/**
 * ★**입력 구역에는 값을 깔지 않는다**(사장님 2026-08-25 「박태윤 입력구역에 깔지말고
 *   거기에 박태윤이 채워넣을거라고」). 역산은 «우리가 아는 것»이지 «그가 정할 것»이 아니다.
 *   미리 깔면 그 값을 그대로 두고 넘어가기 쉽다 — 빈 칸이라야 손이 간다.
 *   역산 결과는 시트가 아니라 `docs/수수료-역산.md` 에 남긴다(근거는 남기되 답을 대신 쓰지 않는다).
 */
const ROWS = 40;
const HEAD2 = ['공급사', '상품구분', '계약기간', '기준', '공급사율', '에이전시율', '청구 시점', '비고'];
const blank = Array.from({ length: ROWS }, () => HEAD2.map(() => ''));

console.log(`■ 「${TAB}」 «${MARK}» 구역 — 빈 표 ${ROWS}줄 ${APPLY ? '(반영)' : '(dry-run)'}`);
console.log(`   ${HEAD2.join(' · ')}`);
console.log(`   (참고) 실적 ${hits.length}칸 역산 — 시트에는 안 깐다. docs/수수료-역산.md 로 남긴다.`);
{
  const lines: string[] = ['# 수수료 역산 — 2026-08-25', '', '> 기존 실적을 거꾸로 풀어 «지금 어떻게 계산되고 있나»를 뽑은 것이다.', '> **이것이 기준은 아니다.** 기준은 「수수료표」 탭 «박태윤 입력» 구역에서 사람이 정한다.', '',
    `실적에서 산식이 맞아떨어진 ${hits.length}칸을 셌다.`, '', '## 표준 — 기준 × 기간', '', '| 기준 | 기간·상품 | 공급사율 | 에이전시율 | 건수 |', '|---|---|---:|---:|---:|'];
  for (const [k, [m0, m1]] of [...std].sort()) {
    const [base, slot] = k.split('|');
    const t0 = m0.size ? top(m0) : null, t1 = m1.size ? top(m1) : null;
    lines.push(`| ${base} | ${slot} | ${t0 ? pct(t0[0]) : ''} | ${t1 ? pct(t1[0]) : ''} | ${(t0?.[1] ?? 0) + (t1?.[1] ?? 0)} |`);
  }
  lines.push('', '## 공급사 예외 — 표준과 다른 요율을 쓴 곳', '', '| 공급사 | 기준 | 기간·상품 | 공급사율 | 에이전시율 | 건수 |', '|---|---|---|---:|---:|---:|');
  for (const [k, [m0, m1]] of [...ex].sort()) {
    const [sup, base, slot] = k.split('|');
    const t0 = m0.size ? top(m0) : null, t1 = m1.size ? top(m1) : null;
    lines.push(`| ${sup} | ${base} | ${slot} | ${t0 ? pct(t0[0]) : ''} | ${t1 ? pct(t1[0]) : ''} | ${(t0?.[1] ?? 0) + (t1?.[1] ?? 0)} |`);
  }
  lines.push('', '## 확인이 필요한 것', '',
    '- **「고정 · 장기렌트」 14건** — 장기렌트인데 요율이 아니라 60만·50만 정액이다. 진짜 정액인지 잘못 적은 건지.',
    '- **어느 산식에도 안 맞는 50칸(6.3%)** — 요율은 있는데 수수료가 딴 값이다. 렌탈료를 수수료 칸에 그대로 적은 것으로 보인다.',
    '- **60개월 요율이 2.25% 와 2.75% 로 갈린다** — 손오공·빌린카·엘씨렌트가 2.75%다.');
  writeFileSync('docs/수수료-역산.md', lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  console.log('   ✓ docs/수수료-역산.md');
}
if (!APPLY) { console.log('※ dry-run — 아무것도 안 썼다.'); process.exit(0); }

// ── 쓴다 ─────────────────────────────────────────────────────────
const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1:J200`)}`);
const rows = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
const at = rows.findIndex((r) => r.some((c) => S(c).startsWith(MARK)));
const start = at >= 0 ? at : rows.length + 1;   // 이미 있으면 그 자리에 다시 깐다
const block = [
  [MARK, '박태윤 님이 채웁니다. 공급사·상품·기간마다 «기준」과 «요율»을 적어 주세요 — 여기가 청구액의 근거가 됩니다.', '', '', '', '', '', ''],
  [...HEAD2],
  ...blank,
];
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A${start + 1}:H${start + block.length}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: block }),
});
const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
const gid = Number(((meta.sheets || []) as any[]).map((x) => x.properties).find((x: any) => S(x.title) === TAB)?.sheetId);
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: gid, startRowIndex: start, endRowIndex: start + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 }, backgroundColor: { red: 1, green: 0.94, blue: 0.8 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: start + 1, endRowIndex: start + 2 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  // ★사람이 적는 두 칸은 연노랑 — 「여기만 고치세요」
  { repeatCell: { range: { sheetId: gid, startRowIndex: start + 2, endRowIndex: start + block.length, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.98, blue: 0.88 } } }, fields: 'userEnteredFormat.backgroundColor' } },
  { addConditionalFormatRule: { rule: {
    ranges: [{ sheetId: gid, startRowIndex: start + 2, endRowIndex: start + block.length, startColumnIndex: 0, endColumnIndex: 8 }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND($E${start + 3}="",$F${start + 3}="")` }] }, format: { backgroundColor: { red: 1, green: 0.92, blue: 0.88 } } },
  }, index: 0 } },
] }) });
console.log(`   ✓ ${start + 1}행부터 ${block.length}줄`);
console.log(`\n■ 끝\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
