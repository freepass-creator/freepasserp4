/**
 * **영업자 시트에서 옛 탭을 지운다** — 최신 「상품리스트」·「종합표」 한 벌만 남긴다.
 * 기본 dry-run, 실제 삭제는 `--apply`.
 *
 * 찍을 때마다 새 탭이 생겨 18개까지 쌓였다. 어느 게 최신인지 눈으로 세게 되고,
 * 옛 탭을 열어 놓고 없는 차를 팔려 드는 사고가 난다.
 *
 * ★남기는 것
 *   · 「상품리스트 …」(신버전) 중 **가장 최근 하나**
 *   · 「상품리스트(구버전) …」 중 **가장 최근 하나** (옛 이름 「종합표 …」 포함)
 *   탭 이름에 날짜·시각이 들어 있어 이름을 내림차순으로 세우면 맨 앞이 최신이다.
 *
 * ★지우기 전에 반드시
 *   · 무엇을 지우는지 먼저 보여 준다(dry-run).
 *   · 지운 탭의 **내용을 파일로 남긴다**(`tmp/sales-tab-backup-*.json`). 되돌릴 길이 있어야 한다.
 *   · 남길 탭이 하나도 안 잡히면 **아무것도 지우지 않는다** — 이름 규칙이 바뀐 것일 수 있다.
 *
 *   npx tsx scripts/prune-sales-sheet-tabs.mts
 *   npx tsx scripts/prune-sales-sheet-tabs.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const SHEET = (process.argv.find((a) => a.startsWith('--sheet=')) || '').slice('--sheet='.length)
  || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';   // 「프리패스 상품리스트」

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=properties(title),sheets(properties(sheetId,title,index))`);
const tabs = ((meta.sheets || []) as Rec[]).map((s) => ({
  gid: Number(s.properties?.sheetId ?? 0),
  title: S(s.properties?.title),
  index: Number(s.properties?.index ?? 0),
}));

const pick = (want: (title: string) => boolean) =>
  tabs.filter((t) => want(t.title)).sort((a, b) => b.title.localeCompare(a.title))[0];
// 「상품리스트(구버전)」도 「상품리스트」로 시작한다 — 신버전을 고를 때 구버전을 빼야 한다.
const keepList = [
  pick((t) => t.startsWith('상품리스트') && !t.startsWith('상품리스트(구버전)')),
  pick((t) => t.startsWith('상품리스트(구버전)') || t.startsWith('종합표')),
].filter(Boolean) as typeof tabs;
const keep = new Set(keepList.map((t) => t.gid));

console.log(`■ 옛 탭 정리 ${APPLY ? '(반영)' : '(dry-run)'} — 「${S(meta.properties?.title)}」 탭 ${tabs.length}개\n`);
if (!keepList.length) {
  console.log('  ✗ 남길 탭을 못 찾았다 — 이름 규칙이 바뀐 것 같다. 아무것도 지우지 않는다.\n');
  process.exit(1);
}
console.log('  남길 탭');
for (const t of keepList) console.log(`     ${t.title}`);

const drop = tabs.filter((t) => !keep.has(t.gid));
console.log(`\n  지울 탭 ${drop.length}개`);
for (const t of drop) console.log(`     ${t.title.slice(0, 40).padEnd(42)}gid=${t.gid}`);

if (!APPLY) { console.log('\n※ dry-run. 실제 삭제는 --apply\n'); process.exit(0); }
if (!drop.length) { console.log('\n  지울 것 없음\n'); process.exit(0); }

// ★지우기 전에 내용을 남긴다. 시트 탭 삭제는 휴지통으로 안 간다.
mkdirSync('tmp', { recursive: true });
const ranges = drop.map((t) => `ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'`)}`).join('&');
const dump = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE`);
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/sales-tab-backup-${stamp}.json`;
writeFileSync(backup, JSON.stringify({ sheet: SHEET, tabs: drop, values: dump.valueRanges }, null, 1), 'utf8');
console.log(`\n  되돌리기용 백업: ${backup}`);

await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: drop.map((t) => ({ deleteSheet: { sheetId: t.gid } })) }),
});
console.log(`  지움 ${drop.length}개 · 남은 탭 ${tabs.length - drop.length}개\n`);
