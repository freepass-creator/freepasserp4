/**
 * **원본 월별 탭 → 정산원장 규격으로 옮긴다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「원본을 이제 백업으로 갖고 있고 그 데이터를 다 갖고와서 데이터화해야하는거고」
 *   「그러면 기존거 두고 현재 기준으로만」 → 기본 범위 **26/1 이후**. 그 앞은 원본에 백업으로 둔다.
 *   「접수월 기준으로 당월 실적으로 봐야하고 접수기준으로 가야할거 같음」
 *
 * ★**실적의 축은 접수월이다.** 탭(정산월)이 아니다 —
 *   실측 2026-08: 8월 탭 40건 중 8월 접수는 26건뿐이고, 8월 접수 32건은 9·10월 탭에도 흩어져 있다.
 *   그래서 **탭을 월로 나누지 않고** 한 표에 쌓고 「접수월」 열로 거른다.
 *
 * ★한 줄 = **한 계약**이다. 같은 차가 여러 달 탭에 실려 있으므로
 *   **차번+접수일**로 접는다(재렌트라 같은 차가 다시 계약될 수 있어 접수일까지 봐야 한다).
 *   겹치면 **뒤 탭(더 최신)** 것을 남긴다 — 상태·금액이 나중 것이 맞다.
 *
 * ★**자리로 옮기면 반드시 깨진다**(실측 2026-08-25).
 *   원본 37탭이 51·50·43·42열 네 모양이고, **자리가 흔들리는 열이 28개**다.
 *   「추가 인센티브」는 25·26·27·35·36·39·40 일곱 자리에 나온다.
 *
 * ★**이름만으로도 못 가른다.** 같은 이름이 두 번 나온다 —
 *   「추가 인센티브」·「수수료 합계」·「부가세」가 **공급사 구간과 에이전시 구간에 각각** 있다.
 *   그래서 머리행 위(2행)의 구간 이름(「공급사(렌터카) 구간」·「에이전시 구간」)으로
 *   **경계를 먼저 잡고**, 그 경계 왼쪽이면 공급사·오른쪽이면 에이전시로 읽는다.
 *   경계를 못 찾으면 그 탭은 **건너뛴다.** 짐작해서 옮기면 공급사 부가세가 에이전시 부가세가 된다.
 *
 * ★날짜는 「12/3」처럼 연도가 없다 — 그 줄이 실린 **탭의 연월**로 연도를 정한다.
 *
 *   npx tsx scripts/import-settlement-source.mts
 *   npx tsx scripts/import-settlement-source.mts --since=26/1
 *   npx tsx scripts/import-settlement-source.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER, SETTLEMENT_CURRENT_TAB } from '../lib/domain/settlement-ledger';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s|\n/g, '');
const key = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SINCE = arg('since', '26/1');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 원장 규격. 원본 열 이름 → 이 이름. 구간이 필요한 것은 `side` 로 가른다. */
const MAP: { to: string; from: string[]; side?: '공급사' | '에이전시' }[] = [
  { to: '계약번호', from: ['계약번호'] },
  { to: '상태', from: ['상태 표기', '상태'] },
  { to: '접수일', from: ['접수일'] },
  { to: '인도일', from: ['인도일'] },
  { to: '렌트구분', from: ['렌트구분'] },
  { to: '상품구분', from: ['상품구분'] },
  { to: '차량번호', from: ['차량번호'] },
  { to: '모델명', from: ['모델명'] },
  { to: '고객명', from: ['고객명'] },
  { to: '연령', from: ['연령'] },
  { to: '고객연락처', from: ['고객연락처'] },
  { to: '계약기간', from: ['계약기간'] },
  { to: '보증금', from: ['보증금'] },
  { to: '분납여부', from: ['분납여부'] },
  { to: '계약형태', from: ['계약형태'] },
  { to: '렌탈료', from: ['렌탈료'] },
  { to: '계약대여료', from: ['계약대여료'] },
  { to: '업셀링금액', from: ['업셀링 금액'] },
  { to: '차량가액', from: ['차량가액'] },
  { to: '공급사', from: ['업체명', '공급사'] },
  { to: '공급사수수료율', from: ['수수료율 (공급사)'], side: '공급사' },
  { to: '판매수수료', from: ['판매 수수료'], side: '공급사' },
  { to: '공급사인센티브', from: ['추가 인센티브'], side: '공급사' },
  { to: '출고지역', from: ['출고지역'], side: '공급사' },
  { to: '공급사부가세', from: ['부가세'], side: '공급사' },
  { to: '청구금액', from: ['청구 금액'], side: '공급사' },
  { to: '영업채널', from: ['에이전시', '영업채널'] },
  { to: '영업담당자', from: ['영업자', '영업담당자'] },
  { to: '에이전시수수료율', from: ['수수료율 (에이전시)'], side: '에이전시' },
  { to: '출고수수료', from: ['출고수수료'], side: '에이전시' },
  { to: '에이전시인센티브', from: ['추가 인센티브'], side: '에이전시' },
  { to: '계약서대행료', from: ['계약서 대행료'], side: '에이전시' },
  { to: '에이전시부가세', from: ['부가세'], side: '에이전시' },
  { to: '지급액', from: ['지급액'], side: '에이전시' },
  { to: '계약서작성담당', from: ['계약서 작성 담당자'] },
  { to: '비고', from: ['비고'] },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

const ymOf = (t: string) => { const m = /(\d{2})\s*\/\s*(\d{1,2})/.exec(t); return m ? { y: 2000 + Number(m[1]), m: Number(m[2]) } : null; };
const ymNum = (t: string) => { const x = ymOf(t); return x ? x.y * 100 + x.m : 0; };
/**
 * ★날짜가 **두 꼴로 온다.** `UNFORMATTED_VALUE` 로 읽으면 진짜 날짜는 **일련번호**(45658)로,
 *   글자로 적힌 것은 「12/3」 처럼 온다. 둘 다 받아야 한다 —
 *   실측 2026-08-25: 일련번호를 못 읽어 **접수월이 427줄 전부 빈칸**이 됐다.
 *   구글 일련번호는 1899-12-30 부터 센 날수다.
 */
const SERIAL0 = Date.UTC(1899, 11, 30);
const dateText = (raw: string, tab: string): string => {
  const t = ymOf(tab); const v = S(raw); if (!v) return v;
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})$/.exec(v);
  if (!m || !t) return v;
  const mm = Number(m[1]), dd = Number(m[2]);
  const y = mm > t.m + 1 ? t.y - 1 : t.y;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

const meta = await api(`${SH}/${SRC}?fields=sheets.properties.title`);
const tabs = (meta.sheets || []).map((s: any) => S(s.properties.title)).filter((t: string) => ymNum(t) >= ymNum(SINCE));

type Out = Record<string, string>;
const out: Out[] = [];
const skipped: string[] = [];
const report: string[] = [];

for (const tab of tabs) {
  let g: string[][];
  try { g = ((await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${tab}'!A1:CZ1400`)}?valueRenderOption=UNFORMATTED_VALUE`)).values || []).map((r: any[]) => (r || []).map(S)); } catch { skipped.push(`${tab} — 못 읽음`); continue; }
  const hi = g.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
  if (hi < 0) { skipped.push(`${tab} — 「차량번호」 없음`); continue; }
  const head = g[hi];

  /**
   * ★구간 경계 — 머리행 **위쪽 아무 행**에서 「에이전시 구간」이 적힌 칸을 찾는다.
   *   그 왼쪽이 공급사, 오른쪽이 에이전시다. 못 찾으면 이 탭은 건너뛴다.
   */
  let border = -1;
  for (let r = 0; r < hi; r++) for (const [i, c] of (g[r] || []).entries()) if (/에이전시\s*구간/.test(S(c))) border = i;
  if (border < 0) { skipped.push(`${tab} — 「에이전시 구간」 경계를 못 찾음(짐작해서 안 옮긴다)`); continue; }

  const findCol = (m: typeof MAP[number]) => {
    const cands = head.map((c, i) => ({ c: norm(c), i })).filter((x) => m.from.some((f) => norm(f) === x.c));
    if (!cands.length) return -1;
    if (!m.side) return cands[0].i;
    const want = m.side === '공급사' ? cands.filter((x) => x.i < border) : cands.filter((x) => x.i >= border);
    return want.length ? want[0].i : -1;
  };
  const col = new Map<string, number>();
  const missing: string[] = [];
  for (const m of MAP) { const i = findCol(m); if (i >= 0) col.set(m.to, i); else missing.push(m.to); }

  const ip = col.get('차량번호')!;
  let n = 0;
  for (const r of g.slice(hi + 1)) {
    if (!key(r[ip])) continue;
    const o: Out = { 정산월: `${ymOf(tab)!.y}-${String(ymOf(tab)!.m).padStart(2, '0')}`, 원본탭: tab, 접수월: '' };
    for (const [to, i] of col) o[to] = /일$/.test(to) ? dateText(r[i], tab) : S(r[i]);
    out.push(o); n++;
  }
  report.push(`   ${tab.padEnd(15)} 경계 ${border + 1}번째 · ${n}줄${missing.length ? `  ▲ 못 찾은 열 ${missing.length}: ${missing.slice(0, 6).join('·')}` : ''}`);
}

/**
 * ★**차번+접수일로 접는다.** 같은 계약이 여러 달 탭에 실린다 —
 *   접지 않으면 8월 접수 32건이 60건으로 부풀고 실적이 거짓이 된다.
 *   같은 열쇠가 겹치면 뒤(더 최신) 것을 남긴다.
 */
const folded = new Map<string, Out>();
for (const o of out) {
  o['접수월'] = /^\d{4}-\d{2}/.test(S(o['접수일'])) ? S(o['접수일']).slice(0, 7) : '';
  folded.set(`${key(o['차량번호'])}|${S(o['접수일'])}`, o);
}
const rowsOut = [...folded.values()].sort((a, b) => S(a['접수일']).localeCompare(S(b['접수일'])));

console.log(`\n■ 원본 → 정산원장 규격 — ${SINCE} 이후 ${tabs.length}탭 · **${out.length}줄** ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const r of report) console.log(r);
if (skipped.length) { console.log(`\n  ⚠ 건너뛴 탭 ${skipped.length}`); for (const s of skipped) console.log(`     ${s}`); }

console.log(`  접기 전 ${out.length}줄 → 접은 뒤 **${rowsOut.length}줄** (차번+접수일 기준)`);
const byRecv = new Map<string, number>();
for (const o of rowsOut) byRecv.set(S(o['접수월']) || '(접수일 없음)', (byRecv.get(S(o['접수월']) || '(접수일 없음)') || 0) + 1);
console.log('\n  ── 접수월별 실적');
for (const [k, n] of [...byRecv].sort()) console.log(`     ${k.padEnd(16)} ${String(n).padStart(4)}건`);
console.log('\n  ── 옮긴 뒤 첫 3줄');
for (const o of rowsOut.slice(0, 3)) console.log(`     ${o['정산월']} ${key(o['차량번호']).padEnd(11)} ${S(o['상태']).padEnd(10)} ${S(o['공급사']).padEnd(8)} ${S(o['영업채널']).padEnd(8)} 공급사부가세 ${S(o['공급사부가세'])} · 에이전시부가세 ${S(o['에이전시부가세'])}`);

writeFileSync('tmp/settlement-import.json', JSON.stringify(rowsOut, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 썼다. 목록 tmp/settlement-import.json\n`); process.exit(0); }
/**
 * ★새 탭 「실적」에 쓴다. **당월실적·기존실적은 안 건드린다** — 사장님이 정할 때까지 둔다.
 *   통째로 지우고 다시 쓴다(줄이 줄면 옛 줄이 남는다).
 */
const TAB = '실적';
const COLS = ['접수월', '정산월', '상태', '접수일', '인도일', '차량번호', '모델명', '고객명', '공급사', '영업채널', '영업담당자',
  '렌트구분', '상품구분', '계약기간', '보증금', '분납여부', '렌탈료', '차량가액',
  '공급사수수료율', '판매수수료', '공급사인센티브', '공급사부가세', '청구금액',
  '에이전시수수료율', '출고수수료', '에이전시인센티브', '계약서대행료', '에이전시부가세', '지급액',
  '계약번호', '계약형태', '연령', '고객연락처', '계약대여료', '업셀링금액', '출고지역', '계약서작성담당', '비고', '원본탭'];
const lmeta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
let sheetId = (lmeta.sheets || []).find((x: any) => S(x.properties.title) === TAB)?.properties?.sheetId;
if (sheetId === undefined) {
  const made = await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    addSheet: { properties: { title: TAB, index: 1, gridProperties: { rowCount: Math.max(600, rowsOut.length + 50), columnCount: COLS.length, frozenRowCount: 1 } } },
  }] }) });
  sheetId = made.replies[0].addSheet.properties.sheetId;
}
sheetId = Number(sheetId);
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1:AZ3000`)}:clear`, { method: 'POST', body: '{}' });
const values = [COLS, ...rowsOut.map((o) => COLS.map((c) => S(o[c])))];
await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values }) });
const FONT = 'Noto Sans KR';
await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
  { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: COLS.length } } } },
] }) });
console.log(`\n■ 끝 — 「${TAB}」 ${rowsOut.length}줄. 당월실적·기존실적은 안 건드렸다.`);
console.log(`   https://docs.google.com/spreadsheets/d/${LEDGER}/edit#gid=${sheetId}\n`);
