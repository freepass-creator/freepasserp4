/**
 * **공급사들이 «상태»를 어떤 말로 쓰고 있나 — 원문 어휘를 그대로 센다. 쓰기 없음.**
 *
 * 우리 상태는 즉시출고·출고가능·출고협의·계약중·출고불가 다섯이다. 공급사 시트는 제각각이라
 * 「예약중」「상담후」「입고예정」처럼 애매한 말이 온다. 그걸 무엇으로 접었는지 모르면
 * 「출고가능이 아닌 애매한 것」이 조용히 출고가능으로 올라가거나 통째로 빠진다.
 *
 * 그래서 «원문 → 우리 상태» 를 공급사별로 세어 낸다. 어느 말이 어디로 접히는지가 한눈에 보이고,
 * 접힘이 틀린 말은 여기 표에서 바로 짚을 수 있다.
 *
 * 함께 낸다: 차번이 형식에 안 맞아 무효로 빠지는 행의 «원문» — 무효는 커밋을 통째로 막는다.
 *
 *   npx tsx scripts/audit-sheet-status-words.mts
 *   npx tsx scripts/audit-sheet-status-words.mts --code=RP031 --rows
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { canonSheetVehicleStatus, isSheetExcluded } from '../lib/domain/sheet-import';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { isExactRealPlate } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const SHOW_ROWS = process.argv.includes('--rows');

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

const FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue)),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

const STATUS_HEADER = /배차상태|판매상태|^상태$|재고상태|출고상태|진행상태|계약상태/;
const PLATE_HEADER = /차량번호|차번|번호판|등록번호/;

async function main() {
  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  const dead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';
  /** 전체 어휘 — 같은 말을 여러 공급사가 쓰는지 보려고 합쳐서도 센다. */
  const global = new Map<string, { n: number; canon: string; excluded: boolean; who: Set<string> }>();

  console.log('\n══ 공급사 시트의 «상태» 원문 어휘 (쓰기 없음) ══\n');

  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (ONLY && code !== ONLY) continue;
    if (!S(p.sheet_url) || dead(p)) continue;
    const label = S(p.name || p.partner_name) || code;
    let o;
    try { o = partnerSheetOpts(p as EntityRecord); } catch { continue; }
    const sheetId = (o.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!sheetId) continue;
    const adapter = resolveAdapter(p as EntityRecord);

    const meta = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json() as SheetsGridResponse & { error?: { message?: string } };
    if (meta.error) { console.log(`❌ ${code} ${label} — ${meta.error.message}`); continue; }

    const tabs = o.gids.length ? o.gids : (meta.sheets || []).map((s) => String(s.properties?.sheetId ?? ''));
    const local = new Map<string, { n: number; canon: string; excluded: boolean }>();
    const badPlates: string[] = [];
    let rowsSeen = 0, hidden = 0;

    for (const gid of tabs) {
      const target = meta.sheets?.find((s) => s.properties?.sheetId === Number(gid));
      if (!target?.properties) continue;
      // 두 벌로 읽어 «숨김행이 몇 개인지»도 같이 센다 — 숨김과 상태값은 다른 축이다.
      let rows: string[][] = [];
      try {
        const a1 = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(FIELDS)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await res.json() as SheetsGridResponse & { error?: { message?: string } };
        if (!res.ok) throw new Error(body.error?.message || `Sheets ${res.status}`);
        const grid = visibleRowsFromGridResponse(body, String(gid));
        hidden += grid.hiddenRowCount || 0;
        // 원문 어휘는 «숨김 포함» 전체를 봐야 한다 — 숨긴 행이 어떤 말을 쓰는지가 궁금한 것이다.
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        rows = csv.ok ? parseCsv(await csv.text()) : grid.rows;
      } catch { continue; }

      let table: string[][];
      try { table = adapter.prepareTable(rows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;
      const header = table[0].map(S);
      const iS = header.findIndex((h) => STATUS_HEADER.test(h.replace(/\s/g, '')));
      const iP = header.findIndex((h) => PLATE_HEADER.test(h.replace(/\s/g, '')));
      for (const row of table.slice(1)) {
        if (row.every((c) => !S(c))) continue;
        rowsSeen++;
        if (iP >= 0) {
          const plate = S(row[iP]).replace(/\s/g, '');
          if (plate && !isExactRealPlate(plate)) badPlates.push(`${plate.slice(0, 24)}`);
        }
        if (iS < 0) continue;
        const raw = S(row[iS]) || '(빈칸)';
        const canon = canonSheetVehicleStatus(row[iS]);
        const cur = local.get(raw) || { n: 0, canon, excluded: isSheetExcluded(canon) };
        cur.n++;
        local.set(raw, cur);
        const g = global.get(raw) || { n: 0, canon, excluded: isSheetExcluded(canon), who: new Set<string>() };
        g.n++; g.who.add(code);
        global.set(raw, g);
      }
    }

    if (!local.size && !badPlates.length) continue;
    console.log(`  ${code.padEnd(9)} ${label.padEnd(18).slice(0, 18)} 행 ${rowsSeen}${hidden ? ` · 숨김 ${hidden}` : ''}`);
    for (const [raw, v] of [...local.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const mark = v.excluded ? '⛔올리지 않음' : '✅올림';
      console.log(`       ${String(v.n).padStart(4)}  「${raw}」 → ${v.canon || '(판정 없음)'} ${mark}`);
    }
    if (badPlates.length) {
      console.log(`       ⚠ 차번 형식 아님 ${badPlates.length}행 — 커밋을 막는다. 예: ${[...new Set(badPlates)].slice(0, 6).join(' / ')}`);
      if (SHOW_ROWS) for (const b of [...new Set(badPlates)].slice(0, 40)) console.log(`            ${b}`);
    }
    console.log('');
  }

  if (!ONLY) {
    console.log('── 전체 어휘(여러 곳이 쓰는 말) ──');
    for (const [raw, v] of [...global.entries()].sort((a, b) => b[1].n - a[1].n)) {
      if (v.who.size < 2) continue;
      console.log(`   ${String(v.n).padStart(4)}  「${raw}」 → ${v.canon || '(판정 없음)'} ${v.excluded ? '⛔' : '✅'}  ${[...v.who].join(',')}`);
    }
    console.log('');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
