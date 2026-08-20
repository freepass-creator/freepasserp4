/**
 * **입고일자 자동 도장** — 공급사 시트 재고 탭의 「입고일자」가 비어 있으면 «그 차량번호가 우리 시트에 처음 찍힌 날»을 적는다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「공급사 시트에 입고일자는 새로 올라온 날짜야… 얼마나 입력했는지 보려고 하는 거야. 그래서 차량번호가 처음 찍힌 날짜를 입고일자로 한다」
 *   · 처음 본 날 원장 = `data/plate-first-seen.json` { "공급사코드|차량번호": "YYYY-MM-DD" }. 매일(run-daily ①′) 21곳을 훑어 새 차량번호는 오늘(KST)로 적고, 그 날짜를 빈 입고일자에 쓴다.
 *   · 옛 줄(원장에 없고 시트에도 날짜가 없는 차)은 ERP 최초 등록 시각(v4/products created_at, 같은 공급사+차번)으로 소급한다 — 그것도 없으면 오늘. «근사값»이다.
 *   · 공급사가 직접 적은 입고일자는 안 덮는다(원장에는 그 값을 처음 본 날로 기록). 정제시트(미러)는 미러가 새 줄에 오늘을 찍으므로 여기서는 빈 칸만 보충한다.
 *   · 정확도: 하루 1회 돌리면 하루 안 오차. 더 촘촘히 보려면 이 스크립트를 자주 돌리면 된다(멱등).
 *
 *   npx tsx scripts/stamp-arrival-dates.mts
 *   npx tsx scripts/stamp-arrival-dates.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { HUB_CODE_SHEET_ID } from '../lib/domain/legacy-sheets';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const LEDGER = 'data/plate-first-seen.json';
const kstDate = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const today = kstDate(Date.now());
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const idOf = (url: string) => (String(url).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
const isDate = (v: string) => /^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(v) || /^\d{2}[-./]\d{1,2}[-./]\d{1,2}/.test(v);

// ── 원장
const ledger: Record<string, string> = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const ledgerBefore = Object.keys(ledger).length;

// ── 문패: 시트 → 공급사코드
const hub = ((await call(`${SH}/${HUB_CODE_SHEET_ID}/values/A1:Z200`)).values || []) as string[][];
const hi = hub.findIndex((r) => r.some((c) => /공급사코드|코드/.test(S(c))) && r.some((c) => /시트주소|주소|URL/i.test(S(c))));
const hh = (hub[hi] || []).map(S); const ci = hh.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hh.findIndex((c) => /시트주소|주소|URL/i.test(c));
const codeBySheet = new Map<string, string>(); for (const r of hub.slice(hi + 1)) { const id = idOf(S(r[ui])); if (id && S(r[ci])) codeBySheet.set(id, S(r[ci])); }

// ── ERP 최초 등록 시각(공급사코드|차번 → 날짜) — 소급용
const erpFirst = new Map<string, string>();
try {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  const v4 = ((await getDatabase().ref('v4/products').get()).val() || {}) as Record<string, Rec>;
  for (const p of Object.values(v4)) {
    const code = S(p.partner_code || p.provider_company_code); const plate = norm(p.car_number); if (!code || !plate) continue;
    const ms = Number(p.created_at || p.createdAt || p._snap_at || 0); if (!ms) continue;
    const key = `${code}|${plate}`; const d = kstDate(ms);
    if (!erpFirst.has(key) || d < erpFirst.get(key)!) erpFirst.set(key, d);
  }
  console.log(`  ERP 최초 등록 시각 ${erpFirst.size}대(소급용)`);
} catch (e) { console.log(`  (ERP 못 읽음 — 소급 없이 오늘로: ${String((e as Error).message).slice(0, 80)})`); }

// ── 21곳
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
console.log(`■ 입고일자 도장 ${APPLY ? '반영' : '미리보기'} — ${suppliers.length}곳 · 오늘 ${today} · 원장 ${ledgerBefore}건`);
let newSeen = 0, stamped = 0, kept = 0, backfilled = 0;
const stampedList: string[] = [];
for (const t of suppliers) {
  const code = codeBySheet.get(t.id) || t.name;
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const title = S(sh.properties?.title); if (sh.properties?.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const h = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (h < 0) continue;
    const hdr = rows[h]; const pi = hdr.indexOf('차량번호'); const di = hdr.findIndex((c) => norm(c) === '입고일자'); if (di < 0) continue;
    const updates: { range: string; values: string[][] }[] = [];
    rows.slice(h + 1).forEach((r, k) => {
      const plate = norm(r[pi]); if (!plate || plate === '미정') return;
      const key = `${code}|${plate}`; const cur = S(r[di]);
      if (!ledger[key]) {
        if (cur && isDate(cur)) { ledger[key] = cur.slice(0, 10).replace(/[./]/g, '-'); }   // 공급사가 적은 날짜를 처음 본 날로 기록
        else if (erpFirst.has(key)) { ledger[key] = erpFirst.get(key)!; backfilled++; }
        else { ledger[key] = today; newSeen++; }
      }
      if (!cur) { updates.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(di)}${h + 2 + k}`, values: [[ledger[key]]] }); stamped++; if (stampedList.length < 12) stampedList.push(`${t.name} ${plate} ← ${ledger[key]}`); }
      else kept++;
    });
    if (updates.length && APPLY) { await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) }); await sleep(400); }
  }
}
console.log(`  새로 본 차량번호(오늘) ${newSeen} · ERP 시각으로 소급 ${backfilled} · 빈 입고일자에 도장 ${stamped} · 이미 적힘 ${kept}`);
for (const l of stampedList) console.log(`     ${l}`);
if (APPLY) { writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 0)}\n`); console.log(`  ✓ 원장 ${Object.keys(ledger).length}건 저장 — ${LEDGER}`); }
else console.log('※ dry-run. 반영은 --apply(시트에 도장 + 원장 저장)');
