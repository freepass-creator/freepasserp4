/**
 * 시트 셀 링크에서 사진이 오나 — 하이퍼링크·스마트칩 실측. 읽기 전용.
 *
 * 시트에는 사진 «열»이 없다. 공급사는 차량번호 셀에 링크를 건다
 * (아이카=상세페이지 하이퍼링크, 오플=드라이브 폴더 스마트칩). erp3 는 그걸 읽었고
 * v4 는 셀 «값»만 읽어 통째로 놓쳤다 — v3 208대에 있던 사진이 v4 에 0건이었던 이유다.
 *
 * 이 스크립트는 그 링크가 실제로 오는지 공급사·탭별로 센다.
 *
 *   npx tsx scripts/audit-sheet-photo-links.mts
 *   npx tsx scripts/audit-sheet-photo-links.mts --code=RP004
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { photoUrlFromCell, type SheetGridCell } from '../lib/domain/sheet-visible-grid';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
  const db = getDatabase();
  const live = ((await db.ref('partners').get()).val() || {}) as Record<string, Rec>;
  const over = ((await db.ref('v4/partners').get()).val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
  const FIELDS = 'sheets(properties(sheetId,title),data(startRow,rowData(values(formattedValue,hyperlink,chipRuns(chip(richLinkProperties(uri)))))))';

  console.log('\n══ 시트 셀 링크에서 사진이 오나 ══\n');
  let total = 0, withLink = 0;

  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const code = S(p.partner_code);
    if (only && code !== only) continue;
    const name = S(p.partner_name || p.company_name);
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets(properties(sheetId,title))`); } catch { continue; }
    const tabs = meta.sheets.map((s: any) => s.properties.title as string);

    const perTab: string[] = [];
    let coFound = 0, coRows = 0;
    for (const tab of tabs) {
      const a1 = `'${tab.replace(/'/g, "''")}'`;
      let body: any;
      try { body = await api(`${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(FIELDS)}`); } catch { continue; }
      const grid = body.sheets?.[0]?.data?.[0] || {};
      let found = 0, rows = 0;
      let sample = '';
      for (const rd of (grid.rowData || []) as Array<{ values?: SheetGridCell[] }>) {
        const cells = rd.values || [];
        if (!cells.some((c) => S(c?.formattedValue))) continue;
        rows++;
        for (const c of cells) {
          const url = photoUrlFromCell(c);
          if (url) { found++; if (!sample) sample = url; break; }
        }
      }
      coRows += rows; coFound += found;
      if (found) perTab.push(`${tab} ${found}/${rows}${sample ? ` — ${sample.slice(0, 60)}` : ''}`);
    }
    total += coRows; withLink += coFound;
    console.log(`${coFound ? '✅' : '❌'} ${code.padEnd(9)} ${name.padEnd(18).slice(0, 18)} 사진링크 ${coFound}/${coRows}`);
    for (const t of perTab.slice(0, 4)) console.log(`      ${t}`);
  }

  console.log(`\n  합계 ${withLink}/${total} 행에 사진 링크\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
