/**
 * **모든 우리 시트에 「이 시트는」 탭 한 장** — 상태(연동중/정본/구버전/외부) · 무엇인가 · 구성(탭·열, 실측) · 바라보는 곳 · 주는 곳 · 주기 · 틀리면 어디를 고치나.
 * 기본 dry-run, 반영은 `--apply`. 한 곳만: `--sheet=<ID>`.
 *
 * ★사장님 2026-08-19 — 「현재 쓰고 있는 시트를 알아볼 수 있게 표기해줘」 · 「시트마다 그 시트가 어떻게 구성됐고 어디를 바라보고 어디한테 데이터를 주고 이런 거 매뉴얼화를 잘 해야 함」
 *   · 글은 `lib/domain/sheet-identity.ts` 가 정본. 여기서는 실측(문패 코드·탭 목록·재고 열 수·편집 권한)만 붙여 찍는다.
 *   · 대상 = 문패가 읽는 공급사 시트 21곳(보이는 탭, 맨 뒤) + 문패·허브·원천대장(보임) + 판매시트(숨김 — 영업자 표는 그대로 둔다).
 *   · 구버전 시트의 첫 탭 「⚠ 구버전 — 안 씀」은 retire-legacy-sheets.mts 가 찍는다(같은 정본 글).
 * ⚠ 이 탭은 기계가 통째로 다시 쓴다(사람 메모는 「AI 인계」에). 재고·정책 탭 값은 건드리지 않는다.
 *
 *   npx tsx scripts/publish-sheet-identity-tab.mts
 *   npx tsx scripts/publish-sheet-identity-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { HUB_CODE_SHEET_ID, LEGACY_SHEETS, SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { CORE_BOOKS, buildSheetIdentityRows, type SheetIdentityInput } from '../lib/domain/sheet-identity';
import { SHEET_IDENTITY_TAB, SHEET_NAME_MATCH, isVehicleTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

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
const DR = 'https://www.googleapis.com/drive/v3/files';
const idOf = (url: string) => (String(url).match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';

// 문패: 공급사코드 → 시트 ID
const hubVals = (await call(`${SH}/${HUB_CODE_SHEET_ID}/values/A1:Z200`)).values as string[][] | undefined;
const hubRows = (hubVals || []).map((r) => r.map(S));
const hi = hubRows.findIndex((r) => r.some((c) => /공급사코드|코드/.test(c)) && r.some((c) => /시트주소|주소|URL/i.test(c)));
const hdr = hubRows[hi] || []; const ci = hdr.findIndex((c) => /공급사코드|코드/.test(c)); const ui = hdr.findIndex((c) => /시트주소|주소|URL/i.test(c)); const ni = hdr.findIndex((c) => /공급사명|이름/.test(c));
const codeBySheet = new Map<string, { code: string; name: string }>();
for (const r of hubRows.slice(hi + 1)) { const id = idOf(r[ui] || ''); if (id && r[ci]) codeBySheet.set(id, { code: S(r[ci]), name: S(r[ni] || '') }); }

// 공급사 시트 21곳(드라이브)
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`${DR}?q=${encodeURIComponent(q)}&fields=files(id,name,owners(emailAddress))&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name), owner: S(f.owners?.[0]?.emailAddress) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const mirrorById = new Map(MIRROR_SOURCES.map((m) => [m.to, m] as const));

type Target = { id: string; name: string; owner: string; kind: SheetIdentityInput['kind']; hidden: boolean; code?: string; label?: string };
let targets: Target[] = [
  ...CORE_BOOKS.map((b) => ({ id: b.id, name: b.name, owner: b.owner, kind: b.kind, hidden: b.id === SALES_SHEET_ID })),
  ...suppliers.map((s) => ({ id: s.id, name: s.name, owner: s.owner, kind: (mirrorById.has(s.id) ? '정제시트' : '제공시트') as SheetIdentityInput['kind'], hidden: false, code: codeBySheet.get(s.id)?.code, label: supplierSheetLabel(s.name) })),
];
if (ONE) targets = targets.filter((t) => t.id === ONE);
const notInHub = targets.filter((t) => (t.kind === '제공시트' || t.kind === '정제시트') && !t.code);
if (notInHub.length) console.log(`  ⚠ 문패에 없는 「프리패스 재고」 시트: ${notInHub.map((t) => t.name).join(' · ')} — 코드 없이 찍는다(문패를 확인할 것)`);
console.log(`■ 「${SHEET_IDENTITY_TAB}」 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳(공급사 ${suppliers.length} · 운영 ${CORE_BOOKS.length})`);

const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
const at = kstNow();
let n = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,index)`);
  const props = ((meta.sheets || []) as Rec[]).map((x) => x.properties as Rec);
  const tabs = props.filter((p) => S(p.title) !== SHEET_IDENTITY_TAB).map((p) => `${p.hidden ? '[숨김] ' : ''}${S(p.title)}`);
  // 재고 탭 열 수(실측): 머리행(차량번호·차명(세부모델+트림))의 비어 있지 않은 칸 수
  let stockColumns: number | undefined;
  const veh = props.find((p) => !p.hidden && isVehicleTab(S(p.title)));
  if (veh) {
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${S(veh.title).replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] };
    const rows = (v.values || []).map((r) => r.map(S));
    const h = rows.find((r) => r.includes('차량번호') && r.some((c) => c.replace(/\s/g, '') === '차명(세부모델+트림)'));
    if (h) stockColumns = h.filter(Boolean).length;
  }
  let editors = '';
  try {
    const perms = ((await call(`${DR}/${t.id}/permissions?fields=permissions(type,role,domain)&supportsAllDrives=true`)).permissions || []) as Rec[];
    const anyone = perms.find((p) => p.type === 'anyone'); const dom = perms.find((p) => p.type === 'domain');
    editors = [anyone ? `링크 가진 누구나 ${anyone.role === 'writer' ? '편집' : '보기'}` : '링크 공개 없음', dom ? `${dom.domain} 도메인 ${dom.role === 'writer' ? '편집' : '보기'}` : '', '서비스계정(pyh 대행) 편집'].filter(Boolean).join(' · ');
  } catch { /* 권한 못 읽으면 비움 */ }
  const input: SheetIdentityInput = {
    id: t.id, name: t.name, kind: t.kind, owner: t.owner, tabs: [...tabs, SHEET_IDENTITY_TAB], stockColumns, editors, generatedAt: at,
    status: t.kind === '제공시트' || t.kind === '정제시트' ? '연동중' : '정본(운영)',
    code: t.code, label: t.label, mirror: mirrorById.get(t.id), legacyOfCode: t.code ? LEGACY_SHEETS.filter((l) => l.code === t.code) : undefined,
  };
  const rows = buildSheetIdentityRows(input);
  console.log(`  ${APPLY ? '✓' : '→'} ${t.name}  (${input.status} · ${t.kind}${t.code ? ` · ${t.code}` : ''} · 탭 ${tabs.length}${stockColumns ? ` · 재고 ${stockColumns}열` : ''}) ${rows.length}줄`);
  if (!APPLY) continue;
  let gid = props.find((p) => S(p.title) === SHEET_IDENTITY_TAB)?.sheetId;
  if (gid === undefined) {
    const added = await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_IDENTITY_TAB, hidden: t.hidden, gridProperties: { rowCount: rows.length + 10, columnCount: 3, frozenRowCount: 1 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${SHEET_IDENTITY_TAB}'!A1:Z200`)}:clear`, { method: 'POST', body: '{}' });
  await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${SHEET_IDENTITY_TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
  const reqs: Rec[] = [
    { updateSheetProperties: { properties: { sheetId: gid, hidden: t.hidden, tabColor: rgb('FFE08A') }, fields: 'hidden,tabColor' } },
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFF4D6'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    ...[150, 640, 360].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
  ];
  // 상태 줄 색: 연동중 초록 · 정본 파랑
  const st = input.status === '연동중' ? 'DFF3E4' : 'D9E7FD';
  reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: rgb(st) } }, fields: 'userEnteredFormat.backgroundColor' } });
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  n++;
}
console.log(APPLY ? `반영 완료 — ${n}곳` : '※ dry-run. 반영은 --apply');
