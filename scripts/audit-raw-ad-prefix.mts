/**
 * **원문에 없는 `디 올 뉴`가 정제칸에 붙어 있으면 실패.** 읽기 전용.
 *
 * 정본: `docs/차종명명-정제-매뉴얼.md` §1-0.
 *   세대 = 라이브 행 멤버십. 철자 = 지금 왼쪽 원문. 상품마스터 차번은 이름 입력이 아님.
 *
 *   npm run audit:raw-ad-prefix           # 렌트존 + 181허5305 게이트
 *   npm run audit:raw-ad-prefix -- --all  # 공급사 시트 전수
 *
 * exit 1 = 게이트 차 세부모델이 싼타페 MX5 가 아니거나, 원문에 디올뉴가 없는데 정제칸에 있음.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { RAW_AD_PREFIX_SENTINEL, rawHasDiAllNew } from '../lib/domain/live-master-name-copy';
import {
  isOurNonInventoryTab,
  LEGACY_SHEET_PREFIX,
  SHEET_NAME_MATCH,
  supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const ALL = process.argv.includes('--all');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
let gT = '';
const tok = async () => { gT = (await jwt.getAccessToken()).token || ''; return gT; };
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    await tok();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const j = await r.json().catch(() => ({})) as Rec;
    if (r.ok) return j;
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await sleep(Math.min(60_000, 5_000 * 2 ** n));
      continue;
    }
    throw new Error(S((j as { error?: { message?: string } }).error?.message) || `HTTP ${r.status}`);
  }
};

type Hit = { who: string; plate: string; raw: string; sub: string; refined: string };
const hits: Hit[] = [];
let sentinel: { plate: string; sub: string; refined: string; raw: string } | undefined;

const scan = (who: string, grid: string[][]) => {
  const hi = grid.findIndex((row) => row.includes('차량번호') && (row.includes('세부모델') || row.includes('차명(정제)')));
  if (hi < 0) return;
  const h = grid[hi].map(S);
  const at = (n: string) => h.indexOf(n);
  const pi = at('차량번호'), si = at('세부모델'), ni = at('차명(정제)');
  const rawI = at('차명(세부모델+트림)') >= 0 ? at('차명(세부모델+트림)') : at('차명');
  const kindI = at('차종') >= 0 ? at('차종') : at('모델명');
  for (const row of grid.slice(hi + 1)) {
    const plate = S(row[pi]);
    if (!plate) continue;
    const raw = [S(row[kindI]), S(row[rawI])].filter(Boolean).join(' ').trim();
    const sub = si >= 0 ? S(row[si]) : '';
    const refined = ni >= 0 ? S(row[ni]) : '';
    if (plate.replace(/\s/g, '') === RAW_AD_PREFIX_SENTINEL.plate) {
      sentinel = { plate, sub, refined, raw };
    }
    if (rawHasDiAllNew(raw)) continue;
    if (rawHasDiAllNew(sub) || rawHasDiAllNew(refined)) hits.push({ who, plate, raw, sub, refined });
  }
};

const targets: { name: string; id: string }[] = [{ name: RAW_AD_PREFIX_SENTINEL.who, id: RAW_AD_PREFIX_SENTINEL.sheetId }];
if (ALL) {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((found.files || []) as Rec[])) {
    const nm = S(f.name);
    const id = S(f.id);
    const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
    if (nm.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(nm) || isLegacySheetId(id)) continue;
    if (targets.some((t) => t.id === id)) continue;
    if (![...supplierNameKeys(who)].length && !who) continue;
    targets.push({ name: who, id });
  }
}

for (const t of targets) {
  await sleep(200);
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(title,hidden)')}`);
  const titles = ((meta.sheets || []) as Rec[])
    .filter((s) => !(s as { properties?: { hidden?: boolean } }).properties?.hidden)
    .map((s) => S((s as { properties?: { title?: string } }).properties?.title))
    .filter((title) => title && !isOurNonInventoryTab(title));
  for (const title of titles) {
    const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`);
    scan(t.name, (((got as { values?: string[][] }).values || []) as string[][]).map((row) => (row || []).map(S)));
  }
}

const sentOk = !!sentinel
  && sentinel.sub === RAW_AD_PREFIX_SENTINEL.wantSub
  && !rawHasDiAllNew(sentinel.sub)
  && !rawHasDiAllNew(sentinel.refined);
const fail = !sentOk || hits.length > 0;
const out = {
  sentinel: sentinel || null,
  sentinelOk: sentOk,
  wantSub: RAW_AD_PREFIX_SENTINEL.wantSub,
  adPrefixHits: hits.length,
  sample: hits.slice(0, 12).map((h) => `${h.who} ${h.plate} 원문「${h.raw.slice(0, 40)}」 세부모델「${h.sub}」 차명(정제)「${h.refined}」`),
  scope: ALL ? 'all' : '렌트존',
  note: '원문에 디올뉴가 없는데 정제칸에 있으면 실패. 게이트=181허5305 세부모델 싼타페 MX5.',
};
console.log(JSON.stringify(out, null, 2));
if (sentOk && !hits.length) console.log('게이트 ok — 원문 없는 디올뉴 0');
if (!sentOk) {
  console.error(`게이트 실패: ${RAW_AD_PREFIX_SENTINEL.plate} 세부모델 「${sentinel?.sub || '(없음)'}」 ≠ ${RAW_AD_PREFIX_SENTINEL.wantSub}`);
}
if (hits.length) console.error(`게이트 실패: 원문 없는 디올뉴 ${hits.length}대`);
if (fail) process.exit(1);
