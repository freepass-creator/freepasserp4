/**
 * 출고가능만. 모델·세부모델·세부트림은 F03에서 가려진 칸만 넣는다.
 * 세부모델이 안 갈려도 모델은 넣고, 트림이 없으면 세부모델(+기본형)까지.
 * 마스터 생산기간과 안 겹치면 세부모델은 비운다.
 * 기본 dry-run. 반영 `--apply`. 백업 tmp/refine-r5-snap.
 *
 *   npx tsx scripts/apply-refine-r5-auto.mts
 *   npx tsx scripts/apply-refine-r5-auto.mts --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isOurNonInventoryTab, isVehicleTab } from '../lib/domain/supplier-template-sheet';
import { fold } from '../lib/domain/encar-work-sheet-match';
import { canonMakerDisplay } from '../lib/domain/maker-display';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const SRC = 'tmp/refine-vs-master.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

const report = JSON.parse(readFileSync(SRC, 'utf8')) as {
  rows: {
    bucket: string; sheetId: string; supplier: string; tab: string; plate: string;
    status?: string;
    raw?: { 차명?: string; 연식?: string };
    round5?: { picked: string; tag: string; model?: string; trim?: string; maker?: string; source?: string; note?: string };
  }[];
};
const SOLD = /출고불가|판매완료|말소/;
const live = report.rows.filter((r) => S(r.plate) && !SOLD.test(S(r.status)));
if (!live.length) throw new Error('대상 0 — 감사기 산출을 먼저 돌려라');

type Want = { plate: string; supplier: string; tab: string; sub: string; model: string; trim: string; maker: string };
const bySheet = new Map<string, Want[]>();
for (const r of live) {
    const picked = S(r.round5?.picked);
    const ok = r.round5?.tag === '원문직접근거' && picked;
    const subOk = ok && r.bucket === '자동후보';
    const rec: Want = {
      plate: r.plate, supplier: r.supplier, tab: r.tab,
      sub: subOk ? picked : '',
      model: S(r.round5?.model),
      trim: subOk ? S(r.round5?.trim) : '',
      maker: S(r.round5?.maker) ? (canonMakerDisplay(r.round5.maker) || r.round5.maker) : '',
    };
  (bySheet.get(r.sheetId) || bySheet.set(r.sheetId, []).get(r.sheetId)!).push(rec);
}

const snapDir = 'tmp/refine-r5-snap';
mkdirSync(snapDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const would: { who: string; plate: string; col: string; now: string; want: string }[] = [];
let wrote = 0;
let same = 0;

console.log(`■ 라운드5 원문→F03 정제칸 ${APPLY ? '반영' : '미리보기'} · ${live.length}대 · 시트 ${bySheet.size}`);

for (const [id, wants] of bySheet) {
  const wantAt = new Map<string, Want>();
  for (const w of wants) wantAt.set(`${w.tab}|${w.plate}`, w);
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,hidden)`);
  const tabTitles = ((meta.sheets || []) as Rec[])
    .map((s) => s.properties as Rec)
    .filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)) && isVehicleTab(S(p.title)))
    .map((p) => S(p.title));
  if (!tabTitles.length) continue;
  const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${qs}&majorDimension=ROWS`);
  const updates: { range: string; values: string[][] }[] = [];
  const snaps: Rec[] = [];
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = tabTitles[ti];
    const grid = ((vr.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hi < 0) return;
    const hdr = grid[hi];
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const plateI = at.get('차량번호');
    const subI = at.get('세부모델');
    const modelI = at.get('모델');
    const trimI = at.get('세부트림');
    const makerI = at.get('제조사(정제)');
    if (plateI == null || subI == null) return;
    for (let r = hi + 1; r < grid.length; r++) {
      const plate = S(grid[r][plateI]);
      const w = wantAt.get(`${title}|${plate}`);
      if (!w) continue;
      const plan: [number | undefined, string, string][] = [
        [subI, '세부모델', w.sub],
        [modelI, '모델', w.model],
        [trimI, '세부트림', w.trim],
        [makerI, '제조사(정제)', w.maker],
      ];
      for (const [col, name, want] of plan) {
        if (col == null) continue;
        if (!want && (name === '모델' || name === '제조사(정제)')) continue;
        const now = S(grid[r][col]);
        if (fold(now) === fold(want)) { same++; continue; }
        would.push({ who: w.supplier, plate, col: name, now, want });
        const a1 = `'${title.replace(/'/g, "''")}'!${colA1(col)}${r + 1}`;
        updates.push({ range: a1, values: [[want]] });
        snaps.push({ plate, col: name, range: a1, prev: now, next: want });
      }
    }
  });
  writeFileSync(`${snapDir}/${wants[0]?.supplier || id}-${stamp}.json`, JSON.stringify({ id, apply: APPLY, cells: snaps }, null, 2));
  console.log(`  ${S(wants[0]?.supplier).padEnd(12)} 쓸 칸 ${updates.length}`);
  if (APPLY && updates.length) {
    for (let i = 0; i < updates.length; i += 400) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 400) }),
      });
    }
    wrote += updates.length;
  }
}

console.log(`  같음 ${same} · 바꿀 칸 ${would.length}${APPLY ? ` · 씀 ${wrote}` : ' · dry-run'}`);
for (const h of would.slice(0, 20)) {
  console.log(`    ${h.who.slice(0, 10).padEnd(11)} ${h.plate.padEnd(10)} ${h.col} 「${h.now || '(빈칸)'}」→「${h.want}」`);
}
if (would.length > 20) console.log(`    … +${would.length - 20}`);
writeFileSync('tmp/refine-r5-would.json', JSON.stringify({ at: new Date().toISOString(), apply: APPLY, would }, null, 2));
const filled = live.filter((r) => r.round5?.tag === '원문직접근거' && S(r.round5.picked));
const empty = live.filter((r) => !(r.round5?.tag === '원문직접근거' && S(r.round5?.picked)));
writeFileSync('tmp/refine-learn-verify.json', JSON.stringify({
  at: new Date().toISOString(),
  apply: APPLY,
  live: live.length,
  filled: filled.length,
  empty: empty.length,
  rows: live.map((r) => ({
    supplier: r.supplier,
    plate: r.plate,
    source: r.round5?.source || r.raw?.차명 || '',
    year: r.raw?.연식 || '',
    picked: S(r.round5?.picked),
    model: S(r.round5?.model),
    trim: S(r.round5?.trim),
    maker: S(r.round5?.maker),
    note: r.round5?.note || r.round5?.tag || '',
    empty: !(r.round5?.tag === '원문직접근거' && S(r.round5?.picked)),
  })),
}, null, 2));
console.log(`  원문대비 검증 tmp/refine-learn-verify.json · 채움 ${filled.length} · 빈칸 ${empty.length}`);
if (!APPLY) console.log('※ dry-run. 반영은 --apply');
