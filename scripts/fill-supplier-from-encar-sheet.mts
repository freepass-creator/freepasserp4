/**
 * 엔카 작업 시트(차종·제원·배터리)로 공급사 정제칸.
 * 하나로 모일 때만. 라이브 원장·vehicle-master.json 안 씀.
 * 빈 칸은 채운다. 이미 있는데 작업 시트와 다르면 바로잡는다(검수 반영).
 * 후보가 여럿·원문이 안 모이면 그 칸은 안 건드린다.
 *
 *   npx tsx scripts/fill-supplier-from-encar-sheet.mts
 *   npx tsx scripts/fill-supplier-from-encar-sheet.mts --who=손오공
 *   npx tsx scripts/fill-supplier-from-encar-sheet.mts --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { loadEncarWorkSheetGrids } from '../lib/domain/encar-master-sheet';
import { isMirrorSheet } from '../lib/domain/mirror-sources';
import { VEHICLE_CLASS_VALUES } from '../lib/intake/entities';
import { isOurNonInventoryTab, LEGACY_SHEET_PREFIX, supplierSheetLabel, SHEET_NAME_MATCH } from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import {
  ENCAR_FILL_COLUMNS,
  attachFromEncarSheet,
  fold,
  selfCheckEncarMatch,
  workBookFromTabs,
  type Attach,
  type EncarFillColumn,
} from '../lib/domain/encar-work-sheet-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const SKIP_MIRROR = process.argv.includes('--no-mirror');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const grids = await loadEncarWorkSheetGrids(api);
const book = workBookFromTabs(grids);
const checks = selfCheckEncarMatch(book);
if (checks.length) {
  console.error('⛔ 매처 자가검증 실패 (구글 시트 정본)\n' + checks.map((x) => `  ${x}`).join('\n'));
  process.exit(1);
}
console.log(`  엔카 작업 시트 차종 ${book.names.length}행 · 제원 연료 ${book.fuels.size} · cc ${book.ccs.size} · 구동 ${book.drives.size} · 배터리 ${book.batteries.length} · 자가검증 통과`);

const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

const targets: { name: string; id: string }[] = [];
{
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name);
    const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
    if (nm.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(nm) || isLegacySheetId(S(f.id))) continue;
    if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
    if (SKIP_MIRROR && isMirrorSheet(S(f.id))) continue;
    targets.push({ name: who, id: S(f.id) });
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
for (const t of targets) console.log(`  → ${t.name}  ${t.id}${isMirrorSheet(t.id) ? '  (정제시트)' : ''}`);
console.log(`\n■ 엔카 작업 시트 → 정제칸 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'} · 대상 ${targets.length}곳 · 빈 칸 채움 · 잘못이면 바로잡음\n`);

type CellHit = { who: string; plate: string; col: string; now: string; want: string; raw: string };
const would: CellHit[] = [];
const spelling: CellHit[] = [];
const conflict: CellHit[] = [];
const same: CellHit[] = [];
const byColFill: Record<string, number> = {};
const byColSpell: Record<string, number> = {};
const byColConflict: Record<string, number> = {};
const byColSame: Record<string, number> = {};
let totCars = 0;
let noName = 0;
const noTail: string[] = [];
const samplesUnmatched: string[] = [];

const CLASS = new Set(VEHICLE_CLASS_VALUES.map((c) => c.replace(/\s+/g, '').toLowerCase()));

for (const t of targets) {
  let meta: Rec;
  try {
    meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,hidden)')}`);
  } catch (e) { console.log(`  ✗ ${t.name} — 시트를 못 열었다: ${String((e as Error).message).slice(0, 80)}`); continue; }
  const tabTitles = ((meta.sheets || []) as Rec[])
    .filter((s) => !s.properties?.hidden && !isOurNonInventoryTab(S(s.properties?.title)))
    .map((s) => S(s.properties?.title)).filter(Boolean);
  if (!tabTitles.length) continue;
  let got: Rec;
  try {
    const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
    got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  } catch (e) { console.log(`  ✗ ${t.name} — 값을 못 읽었다: ${String((e as Error).message).slice(0, 80)}`); continue; }

  const updates: { range: string; values: string[][] }[] = [];
  let cars = 0, filled = 0, kept = 0, diffs = 0, spelled = 0, sawTail = false;

  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = tabTitles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (grid.length < 2) return;
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const tailAt = new Map(ENCAR_FILL_COLUMNS.map((c) => [c, at.has(c) ? at.get(c)! : -1]));
    if ([...tailAt.values()].every((i) => i < 0)) return;
    sawTail = true;
    const plateAt = at.get('차량번호') ?? -1;
    if (plateAt < 0) return;
    const exact = (row: string[], name: string) => { const i = at.get(name); return i === undefined ? '' : S(row[i]); };

    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const plate = S(row[plateAt]);
      if (!plate) continue;
      cars++;
      const carName = exact(row, '차명(세부모델+트림)') || exact(row, '차명');
      const carKindRaw = exact(row, '차종') || exact(row, '모델명');
      const kindIsClass = CLASS.has(carKindRaw.replace(/\s+/g, '').toLowerCase());
      const carKind = kindIsClass ? '' : carKindRaw;
      if (!carName && !carKind && !exact(row, '제조사')) { noName++; continue; }
      const want = attachFromEncarSheet({
        maker: exact(row, '제조사'),
        kind: carKind,
        carName,
        fuel: exact(row, '연료'),
        cc: exact(row, '배기량'),
        drive: exact(row, '구동'),
        seats: exact(row, '승차인원'),
        year: exact(row, '연식'),
      }, book);
      const attached: Attach = want;
      if (!attached['모델'] && samplesUnmatched.length < 40) {
        samplesUnmatched.push(`${t.name} ${plate} 「${[carKind, carName].filter(Boolean).join(' ').slice(0, 50)}」`);
      }
      const raw = [exact(row, '제조사'), carKind, carName].filter(Boolean).join(' ');
      for (const name of ENCAR_FILL_COLUMNS) {
        const ci = tailAt.get(name as EncarFillColumn) ?? -1;
        if (ci < 0) continue;
        const now = S(row[ci]);
        const v = S(attached[name as EncarFillColumn]);
        if (!v) continue;
        const hit: CellHit = { who: t.name, plate, col: name, now, want: v, raw: raw.slice(0, 60) };
        if (now === v) {
          kept++;
          byColSame[name] = (byColSame[name] || 0) + 1;
          if (same.length < 8) same.push(hit);
          continue;
        }
        if (now && fold(now) === fold(v)) {
          spelled++;
          byColSpell[name] = (byColSpell[name] || 0) + 1;
          if (spelling.length < 80) spelling.push(hit);
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
          continue;
        }
        if (now) {
          diffs++;
          byColConflict[name] = (byColConflict[name] || 0) + 1;
          if (conflict.length < 80) conflict.push(hit);
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
          continue;
        }
        filled++;
        byColFill[name] = (byColFill[name] || 0) + 1;
        if (would.length < 120) would.push(hit);
        updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
      }
    }
  });

  if (!sawTail) { noTail.push(t.name); continue; }
  totCars += cars;
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(`  ${pad(t.name, 14)}${String(cars).padStart(4)}대   채움 ${String(filled).padStart(5)}칸   표기 ${String(spelled).padStart(4)}   같음 ${String(kept).padStart(5)}   바로잡음 ${String(diffs).padStart(5)}`);

  if (APPLY && updates.length) {
    for (let i = 0; i < updates.length; i += 500) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 500) }),
      });
    }
  }
}

const fillSum = Object.values(byColFill).reduce((a, b) => a + b, 0);
const spellSum = Object.values(byColSpell).reduce((a, b) => a + b, 0);
const confSum = Object.values(byColConflict).reduce((a, b) => a + b, 0);
const sameSum = Object.values(byColSame).reduce((a, b) => a + b, 0);

console.log(`\n  ${'─'.repeat(58)}`);
console.log(`  모두 ${totCars}대 · 빈 칸 ${fillSum} · 표기맞춤 ${spellSum} · 이미 같음 ${sameSum} · 바로잡음 ${confSum}`);
console.log('\n  칸별');
for (const c of ENCAR_FILL_COLUMNS) {
  console.log(`    ${c.padEnd(14)} 빈칸 ${String(byColFill[c] || 0).padStart(4)}  · 표기 ${String(byColSpell[c] || 0).padStart(4)}  · 같음 ${String(byColSame[c] || 0).padStart(4)}  · 바로잡음 ${String(byColConflict[c] || 0).padStart(4)}`);
}
if (noTail.length) console.log(`\n  ▲ 정제칸 없는 시트 ${noTail.length} — ${noTail.join(' · ')}`);
if (noName) console.log(`  ▲ 차명·제조사 원문 없음 ${noName}대`);
if (would.length) {
  console.log('\n  빈 칸 채울 예');
  for (const h of would.slice(0, 25)) console.log(`    ${h.who} ${h.plate} ${h.col} ← ${h.want}  「${h.raw}」`);
  if (fillSum > 25) console.log(`    … 그 밖 ${fillSum - 25}칸`);
}
if (spelling.length) {
  console.log('\n  표기맞춤 예 (괄호·공백만 다름)');
  for (const h of spelling.slice(0, 20)) console.log(`    ${h.who} ${h.plate} ${h.col} 「${h.now}」 → 「${h.want}」`);
  if (spellSum > 20) console.log(`    … 그 밖 ${spellSum - 20}칸`);
}
if (conflict.length) {
  console.log('\n  바로잡음 예 (적힌 값 ≠ 작업 시트)');
  for (const h of conflict.slice(0, 25)) console.log(`    ${h.who} ${h.plate} ${h.col} 「${h.now}」 → 「${h.want}」  「${h.raw}」`);
  if (confSum > 25) console.log(`    … 그 밖 ${confSum - 25}칸`);
}
if (samplesUnmatched.length) {
  console.log('\n  모델도 못 붙인 예');
  for (const l of samplesUnmatched.slice(0, 20)) console.log(`    ${l}`);
}

mkdirSync('tmp', { recursive: true });
const report = {
  at: new Date().toISOString(),
  apply: APPLY,
  cars: totCars,
  fill: byColFill,
  spell: byColSpell,
  same: byColSame,
  conflict: byColConflict,
  fillSum, spellSum, sameSum, confSum,
  would: would.slice(0, 200),
  spelling: spelling.slice(0, 200),
  conflictSamples: conflict.slice(0, 200),
  unmatched: samplesUnmatched,
};
writeFileSync('tmp/encar-sheet-fill-dryrun.json', JSON.stringify(report, null, 2), 'utf8');
console.log('\n  저장 tmp/encar-sheet-fill-dryrun.json');
if (!APPLY) console.log('※ dry-run. 반영은 --apply (빈 칸 채움 · 잘못이면 바로잡음 · 안 모이면 그대로)');
else console.log('※ 반영함. 빈 칸 채움 · 잘못이면 바로잡음 · 안 모이면 그대로.');

