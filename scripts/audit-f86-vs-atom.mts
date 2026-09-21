/**
 * **하허호 F86 ↔ 원자 — 칸 단위 대조 · 신선도 · 첫 번째 관문.** 읽기 전용 · 어긋나면 종료코드 1.
 *
 * ★사장님 2026-09-16 「그중 하허호 시트는 제일 중요하게 관리해야 한다고」 → 「F86 대조를 첫 번째 관문으로」 · 「F86 신선도 감시」.
 *
 * 판매시트 F01 을 거치지 않는다 — 발행기와 «같은 계획»(`buildF86Plan`)을 같은 스냅샷으로 다시 만들어,
 * 시트에 서 있는 것과 한 칸씩 맞댄다. 그래서 F01 발행이 실패한 회차에도 F86 이 옳은지 따로 판정한다.
 *
 *   ① 탭 — 이름(회사·이번 회차 시각·대수)·차례가 계획과 같은가 (공지사항·안내는 뺀다)
 *   ② 신선도 — 회차 시각이 `--max-age-min`(기본 120분)보다 오래 멈춰 있지 않은가.
 *      하허호는 시각이 「상품리스트 MM.DD HH:MM · N대」 하나에만 있고 나머지는 「탭명 · N대」다(초 없음).
 *      판정은 `lib/server/f86-audit-checks.ts` — 반례 시험 `scripts/sim-f86-audit-checks.mts`
 *   ③ 칸 — 탭마다 머리글 · 줄 수 · 차번 차례 · «모든 칸 값»이 계획과 같은가
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-f86-vs-atom.mts --snapshot=<고정 스냅샷> [--시트=<미리보기 사본 id>] [--max-age-min=120]
 */
import { JWT } from 'google-auth-library';
import nextEnv from '@next/env';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { readSalesPublishSnapshot, salesPublishTabMark } from '../lib/server/sales-publish-snapshot';
import { buildF86Plan } from '../lib/server/channel-f86-plan';
import { checkF86TabFreshness, compareF86Cells, compareF86TabTitles } from '../lib/server/f86-audit-checks';
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

console.log(`\n■ 하허호 F86 ↔ 원자 — ${sheetId === HAHUHO_PRODUCT_SHEET_ID ? '운영 F86' : `미리보기 ${sheetId}`}`);
console.log(`  스냅샷 ${snap.snapshotId} · ${snap.capturedAt} · 계획 탭 ${plan.tabs.length}장 · ${plan.order.reduce((n, [, l]) => n + l.length, 0)}대`);
if (plan.layoutViolations.length) fails.push(`굳힌 양식 밖 데이터 ${plan.layoutViolations.length}건 — ${plan.layoutViolations.slice(0, 2).join(' · ')}`);

// ① 탭 이름·차례
const meta = await api(`${SH}/${sheetId}?fields=sheets.properties(title,index)`);
const titles: string[] = (meta.sheets || []).map((s: any) => s.properties).sort((a: any, b: any) => a.index - b.index)
  .map((p: any) => S(p.title)).filter((t: string) => !/공지|안내|이 시트|시트 지도/.test(t));
fails.push(...compareF86TabTitles(titles, plan.tabs.map((t) => t.title)));

// ② 신선도 — 시각을 다는 탭(하허호 = 맨 앞 「상품리스트」 하나, `f86TabCarriesMark`)의 시각(KST · 초 없음). 나머지 「탭명 · N대」는 시각이 없어야 맞다.
{
  const driveMeta = await api(`https://www.googleapis.com/drive/v3/files/${sheetId}?fields=modifiedTime`);
  const fresh = checkF86TabFreshness({ titles, retro: plan.retro, now: Date.now(), maxAgeMin, modifiedAt: S(driveMeta.modifiedTime) });
  fails.push(...fresh.fails);
  console.log(`  신선도 — ${fresh.oldestMin == null ? '읽은 시각 없음' : `「${fresh.oldestTitle}」 ${fresh.oldestMin}분 전`} (허용 ${maxAgeMin}분)`);
}

// ③ 칸 단위
const present = plan.tabs.filter((t) => titles.includes(t.title));
let grids: unknown[][][] = [];
if (present.length) {
  const ranges = present.map((t) => `ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ3000`)}`).join('&');
  const got = await api(`${SH}/${sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  grids = present.map((_, i) => got.valueRanges?.[i]?.values || []);
}
const cells = compareF86Cells(present, grids);
console.log(`  칸 대조 — 탭 ${present.length}장 · 차 ${cells.차수}대 · 칸 ${cells.칸수.toLocaleString()}개 · 어긋남 ${cells.어긋난칸수}`);
for (const [k, e] of [...cells.칸어긋남].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`     ${k} ${e.n} — ${e.표본.join(' · ')}`);
fails.push(...cells.fails);

if (fails.length) {
  console.log('');
  for (const f of fails) console.log(`  ⛔ ${f}`);
  console.log(`\n⛔ 하허호 F86 이 원자대로 «안» 서 있다 — ${fails.length}갈래.\n`);
  process.exit(1);
}
console.log('\n✓ 하허호 F86 = 원자 — 탭·차례·신선도·모든 칸 일치\n');
process.exit(0);
