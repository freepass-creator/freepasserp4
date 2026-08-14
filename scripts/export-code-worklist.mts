/**
 * **차종코드를 «사람이 읽고 판단»하도록 일감을 뽑는다.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「붙는 게 아니고… 우리가 그냥 미리 코드를 박아두면 돼 /
 *   니가 학습하고 텍스트 인식해서 코드를 판단해서 박아 / 차량번호에 한번만 코드 박아두면 되잖아」)
 *
 *   규칙으로 «맞추려» 했더니 544대 중 160대(34%)만 붙었다. 안 붙은 이유가
 *   「트림 이름이 다르다」(163대)·「세부모델이 마스터에 없다」(139대)처럼
 *   **글자를 읽으면 사람은 바로 아는** 것들이었다. 규칙을 더 정교하게 만들 일이 아니라
 *   **한 번 읽고 박을** 일이다. 박고 나면 그 차는 다시 판단할 일이 없다.
 *
 * ★그래서 이 도구는 «판단»을 안 한다. 판단에 필요한 것을 한 자리에 모아 줄 뿐이다 —
 *   차마다 ① 공급사가 적은 원문 ② 그 차에 해당할 만한 마스터 후보 줄들.
 * ⚠ 후보를 좁혀 주되 **버리지는 않는다.** 좁히다 정답을 빼면 사람이 그걸 알 길이 없다.
 *   못 좁힌 차는 후보를 통째로 주고 「모름」이라고 적는다.
 *
 *   npx tsx scripts/export-code-worklist.mts                    # tmp/code-worklist.json
 *   npx tsx scripts/export-code-worklist.mts --only-missing     # 코드 없는 차만
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_ALIAS } from '../lib/domain/sales-sheet-mapping';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB, readMasterSheet, type MasterRow } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY_MISSING = process.argv.includes('--only-missing');
const OUT = arg('out', 'tmp/code-worklist.json');
const DOC_NAME = arg('name', '프리패스 재고');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();

const BOOK = readMasterSheet(((await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(a1Tab(MASTER_TAB))}`) as { values?: string[][] }).values || []) as string[][]);
console.log(`  차종마스터 ${BOOK.byCode.size}줄`);

/**
 * 후보 좁히기 — **제조사가 같고, 모델 이름이 서로 안에 들어가는** 줄을 모은다.
 * ⚠ 「제외」는 뺀다. ⚠ 하나도 없으면 제조사 전체를 준다 — 빈손으로 보내면 판단할 수가 없다.
 */
function candidatesFor(maker: string, modelText: string): MasterRow[] {
  const mk = norm(maker), md = norm(modelText);
  const live = BOOK.rows.filter((r) => r.state !== '제외');
  const sameMaker = live.filter((r) => norm(r.maker) === mk);
  const pool = sameMaker.length ? sameMaker : live;
  if (!md) return pool.slice(0, 300);
  const hit = pool.filter((r) => {
    const m = norm(r.model), s = norm(r.subModel);
    return (m && (md.includes(m) || m.includes(md))) || (s && (md.includes(s) || s.includes(md)));
  });
  return (hit.length ? hit : pool).slice(0, 300);
}

/** 우리 제공시트 전부. */
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);

type Job = {
  공급사: string; 차량번호: string; 시트: string; 탭: string; 행: number;
  지금코드: string;
  원문: Record<string, string>;
  후보: { 코드: string; 표기: string; 상태: string }[];
};
const jobs: Job[] = [];
let total = 0, withCode = 0;

for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }

  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    if (!at.has('차종코드')) return;                       // 아직 칸이 없는 시트
    const pAt = at.get('차량번호') ?? -1;
    if (pAt < 0) return;
    /** 공급사가 적은 «원문»만 모은다 — 우리가 채운 정제칸은 판단 근거로 안 준다(돌고 돈다). */
    const RAW = ['제조사', '차명(트림)', '연식', '연료', '배기량', '옵션', '외부색상', '분류'];
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const plate = S(row[pAt]);
      if (!plate) continue;
      total++;
      const 지금코드 = S(row[at.get('차종코드') ?? -1]);
      if (지금코드) withCode++;
      if (ONLY_MISSING && 지금코드) continue;
      const 원문: Record<string, string> = {};
      for (const c of RAW) { const i = at.get(c); if (i !== undefined && S(row[i])) 원문[c] = S(row[i]); }
      // 우리가 이미 알아본 것도 «참고»로 준다 — 정답으로 주지 않는다.
      for (const c of ['모델', '세부모델', '파워트레인', '세부트림']) {
        const i = at.get(c); if (i !== undefined && S(row[i])) 원문[`참고_${c}`] = S(row[i]);
      }
      const maker = S(원문['제조사'] || 원문['참고_모델'] || '');
      const modelText = [원문['참고_세부모델'], 원문['참고_모델'], 원문['차명(트림)']].filter(Boolean).join(' ');
      const cand = candidatesFor(maker, modelText);
      jobs.push({
        공급사: who, 차량번호: plate, 시트: id, 탭: title, 행: r + 1,
        지금코드,
        원문,
        후보: cand.map((c) => ({ 코드: c.code, 표기: `${c.maker} ${c.model} ${c.subModel} · ${c.powertrain} · ${c.trim || '(트림없음)'} · ${c.cc ? `${c.cc}cc` : (c.batteryKwh ? `${c.batteryKwh}kWh` : 'cc없음')}`, 상태: c.state })),
      });
    }
  });
}

writeFileSync(OUT, JSON.stringify(jobs, null, 1), 'utf8');
const noCand = jobs.filter((j) => !j.후보.length).length;
const big = jobs.filter((j) => j.후보.length > 40).length;
console.log(`\n  제공시트 ${total}대 · 코드 있음 ${withCode}대 · 일감 ${jobs.length}대 → ${OUT}`);
console.log(`  후보가 없는 차 ${noCand} · 후보가 40개 넘는 차 ${big}`);
console.log(`  후보 수 중앙값 ${jobs.length ? [...jobs].map((j) => j.후보.length).sort((a, b) => a - b)[Math.floor(jobs.length / 2)] : 0}\n`);
