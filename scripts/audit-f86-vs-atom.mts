/**
 * **하허호 F86 ↔ 원자 — 칸 단위 대조 · 신선도 · 첫 번째 관문.** 읽기 전용 · 어긋나면 종료코드 1.
 *
 * ★사장님 2026-09-16 「그중 하허호 시트는 제일 중요하게 관리해야 한다고」 → 「F86 대조를 첫 번째 관문으로」 · 「F86 신선도 감시」.
 *
 * 판매시트 F01 을 거치지 않는다 — 발행기와 «같은 계획»(`buildF86Plan`)을 같은 스냅샷으로 다시 만들어,
 * 시트에 서 있는 것과 한 칸씩 맞댄다. 그래서 F01 발행이 실패한 회차에도 F86 이 옳은지 따로 판정한다.
 *
 *   ① 탭 — 이름(회사·이번 회차 시각·대수)·차례가 계획과 같은가 (공지사항·안내는 뺀다)
 *   ② 신선도 — F86 탭 시각이 `--max-age-min`(기본 120분)보다 오래 멈춰 있지 않은가
 *   ③ 칸 — 탭마다 머리글 · 줄 수 · 차번 차례 · «모든 칸 값»이 계획과 같은가
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-f86-vs-atom.mts --snapshot=<고정 스냅샷> [--시트=<미리보기 사본 id>] [--max-age-min=120]
 */
import { JWT } from 'google-auth-library';
import nextEnv from '@next/env';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { readSalesPublishSnapshot, salesPublishTabMark } from '../lib/server/sales-publish-snapshot';
import { buildF86Plan } from '../lib/server/channel-f86-plan';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const snapshotPath = arg('snapshot');
if (!snapshotPath) throw new Error('F86 감사에는 --snapshot=<이번 회차 고정 스냅샷>이 반드시 필요하다.');
const sheetId = S(arg('시트')) || HAHUHO_PRODUCT_SHEET_ID;
const maxAgeMin = Number(arg('max-age-min') || 120);

const snap = readSalesPublishSnapshot(snapshotPath);
const mark = salesPublishTabMark(snap);
const plan = await buildF86Plan({ snapshot: snap, mark });

const sa = googleSheetsServiceAccount('tmp/firebase-auth/sa.json');
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const api = async (u: string): Promise<any> => {
  for (let n = 1; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await new Promise((k) => setTimeout(k, 2000 * n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const fails: string[] = [];
const J = (v: unknown) => JSON.stringify(v);

console.log(`\n■ 하허호 F86 ↔ 원자 — ${sheetId === HAHUHO_PRODUCT_SHEET_ID ? '운영 F86' : `미리보기 ${sheetId}`}`);
console.log(`  스냅샷 ${snap.snapshotId} · ${snap.capturedAt} · 계획 탭 ${plan.tabs.length}장 · ${plan.order.reduce((n, [, l]) => n + l.length, 0)}대`);
if (plan.layoutViolations.length) fails.push(`굳힌 양식 밖 데이터 ${plan.layoutViolations.length}건 — ${plan.layoutViolations.slice(0, 2).join(' · ')}`);

// ① 탭 이름·차례
const meta = await api(`${SH}/${sheetId}?fields=sheets.properties(title,index)`);
const titles: string[] = (meta.sheets || []).map((s: any) => s.properties).sort((a: any, b: any) => a.index - b.index)
  .map((p: any) => S(p.title)).filter((t: string) => !/공지|안내|이 시트|시트 지도/.test(t));
const 기대제목 = plan.tabs.map((t) => t.title);
if (J(titles) !== J(기대제목)) {
  const 없음 = 기대제목.filter((t) => !titles.includes(t));
  const 남음 = titles.filter((t) => !기대제목.includes(t));
  fails.push(`탭 이름·차례가 이번 회차 계획과 다르다 — 실제 ${titles.length}장 ↔ 기대 ${기대제목.length}장`
    + `${없음.length ? ` · 없는 탭 ${없음.slice(0, 3).join(' | ')}` : ''}${남음.length ? ` · 남은 탭 ${남음.slice(0, 3).join(' | ')}` : ''}`
    + `${!없음.length && !남음.length ? ' · 차례만 다름' : ''}`);
}

// ② 신선도 — 탭 이름의 시각(KST)
{
  const year = new Date(new Date(snap.capturedAt).getTime() + 9 * 3600e3).getUTCFullYear();
  let oldest = 0; let oldestTitle = '';
  for (const t of titles) {
    const m = /(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) · \d+대$/.exec(t);
    if (!m) { fails.push(`탭 이름에 발행 시각이 없다 — 「${t}」`); continue; }
    const at = Date.UTC(year, Number(m[1]) - 1, Number(m[2]), Number(m[3]) - 9, Number(m[4]), Number(m[5]));
    const age = Math.round((Date.now() - at) / 60000);
    if (age > oldest) { oldest = age; oldestTitle = t; }
  }
  if (titles.length && oldest > maxAgeMin) fails.push(`F86 이 ${oldest}분째 멈춰 있다(허용 ${maxAgeMin}분) — 「${oldestTitle}」`);
  console.log(`  신선도 — 가장 오래된 탭 ${oldest}분 전 (허용 ${maxAgeMin}분)`);
}

// ③ 칸 단위
const present = plan.tabs.filter((t) => titles.includes(t.title));
let 칸수 = 0; let 차수 = 0;
const 칸어긋남 = new Map<string, { n: number; 표본: string[] }>();
if (present.length) {
  const ranges = present.map((t) => `ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ3000`)}`).join('&');
  const got = await api(`${SH}/${sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  present.forEach((tab, i) => {
    const grid: unknown[][] = got.valueRanges?.[i]?.values || [];
    const hdr = (grid[0] || []).map(S);
    if (J(hdr) !== J(tab.cols)) { fails.push(`「${tab.company}」 머리글이 계획과 다르다 — 실제 ${hdr.length}칸 ↔ 기대 ${tab.cols.length}칸`); return; }
    const rows = grid.slice(1).filter((r) => (r || []).some((v) => S(v)));
    if (rows.length !== tab.values.length) fails.push(`「${tab.company}」 줄 수 — 실제 ${rows.length} ↔ 기대 ${tab.values.length}`);
    const ci = tab.cols.indexOf('차량번호');
    const 실제차례 = rows.map((r) => S(r[ci]));
    const 기대차례 = tab.values.map((r) => S(r[ci]));
    if (J(실제차례) !== J(기대차례)) fails.push(`「${tab.company}」 줄 차례가 계획과 다르다`);
    const n = Math.min(rows.length, tab.values.length);
    for (let r = 0; r < n; r++) {
      차수++;
      for (let c = 0; c < tab.cols.length; c++) {
        칸수++;
        const want = S(tab.values[r][c]);
        const have = S((rows[r] || [])[c]);
        if (want === have) continue;
        const key = `${tab.company}·${tab.cols[c]}`;
        const e = 칸어긋남.get(key) || { n: 0, 표본: [] };
        e.n++; if (e.표본.length < 2) e.표본.push(`${S(tab.values[r][ci])} 시트「${have || '—'}」↔ 계획「${want || '—'}」`);
        칸어긋남.set(key, e);
      }
    }
  });
}
const 어긋난칸수 = [...칸어긋남.values()].reduce((s, e) => s + e.n, 0);
console.log(`  칸 대조 — 탭 ${present.length}장 · 차 ${차수}대 · 칸 ${칸수.toLocaleString()}개 · 어긋남 ${어긋난칸수}`);
for (const [k, e] of [...칸어긋남].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`     ${k} ${e.n} — ${e.표본.join(' · ')}`);
if (어긋난칸수) fails.push(`F86 칸 값이 원자 계획과 다르다 ${어긋난칸수}칸`);

if (fails.length) {
  console.log('');
  for (const f of fails) console.log(`  ⛔ ${f}`);
  console.log(`\n⛔ 하허호 F86 이 원자대로 «안» 서 있다 — ${fails.length}갈래.\n`);
  process.exit(1);
}
console.log('\n✓ 하허호 F86 = 원자 — 탭·차례·신선도·모든 칸 일치\n');
process.exit(0);
