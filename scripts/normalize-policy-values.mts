/**
 * **정책 탭 표기 통일** — 20곳 「○○ 프리패스 재고」의 「정책」 탭 값을 `policy-value-spec` 규격으로 맞춘다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-18 — 「규격 통일 좀 하고 매뉴얼 만들면 되잖아」 · 「어디는 70만 달랑이고」 ·
 *   「어떤 건 만21세 어떤 건 만71세 이상」 · 「추가운전자 … 추가운전이라고 하고 가능 여부만 · 요금은 1인까지 / 1인당 얼마」)
 *
 * 하는 일(한 시트마다)
 *   ① 머리글 이름 바꾸기 — 「추가운전자」→「추가운전」 · 「추가운전자 요금」→「추가운전 요금」(POLICY_FIELD_RENAMES)
 *   ② 값 정규화 — 뜻이 하나로 정해지는 표기 차이만 고친다(normalizePolicyValue). 「추가운전 요금」은 옛 두 칸(인원+요금)을 합쳐 만든다.
 *      뜻이 갈리는 값은 안 건드리고 «검토»로 화면에 남긴다.
 *   ③ 서식 다시 입힘 — 드롭다운(규격 허용값)·머리글 메모(«왜 채우나» + 표기 규격)·블록색.
 *
 * 안전
 *   · 쓰기 전 그 탭 전체를 `tmp/policy-normalize-backup-<이름>-<때>.json` 에 뜬다.
 *   · 바뀐 칸만 쓴다(값 그대로인 칸은 안 건드린다). 쓴 뒤 되읽어 칸 단위로 대조한다.
 *   · 재고 탭·다른 탭은 손대지 않는다. 두 번 돌려도 안전하다(이미 규격이면 0칸).
 *
 *   npx tsx scripts/normalize-policy-values.mts
 *   npx tsx scripts/normalize-policy-values.mts --apply
 *   npx tsx scripts/normalize-policy-values.mts --apply --sheet=<ID>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { POLICY_KEY_COLUMNS, POLICY_SHEET_FIELDS, USE_COLOR, USE_LABEL, policyBlocks, policySheetHeader } from '../lib/domain/policy-sheet-layout';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import {
  POLICY_FIELD_RENAMES, POLICY_VALUE_RULE_BY_NAME, normalizePolicyValue,
} from '../lib/domain/policy-value-spec';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
import { policyTabTitle } from '../lib/domain/supplier-template-sheet';
import { policyRowLive } from '../lib/domain/supplier-policy-read';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colName = (i: number) => { let n = i + 1, out = ''; while (n) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); } return out; };
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });

const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(f.name) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
console.log(`\n■ 정책 탭 표기 통일 ${APPLY ? '(반영)' : '(dry-run)'} · 대상 ${targets.length}곳\n`);

const totals = { renamed: 0, fixed: 0, review: 0, sheets: 0 };
const reviewLines: string[] = [];
const fixLines = new Map<string, number>();
mkdirSync('tmp', { recursive: true });

for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties`);
  const TAB = policyTabTitle((meta.sheets || []).map((x: Rec) => S(x.properties?.title))) || '';
  const sheet = (meta.sheets || []).map((x: Rec) => x.properties).find((p: Rec) => S(p.title) === TAB);
  if (!sheet) { console.log(`  · ${t.name.padEnd(10)} 정책 탭 없음 — 건너뜀`); continue; }
  const gid = sheet.sheetId;
  const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'`)}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  if (!rows.length) { console.log(`  · ${t.name.padEnd(10)} 정책 탭 비어 있음 — 건너뜀`); continue; }
  const header = rows[0];
  // ★이름으로 본다 — 자리로 보지 않는다(2026-08-21 「정책UID」가 앞에 생겨 정책코드가 밀렸다).
  if (!header.some((h) => h === '정책코드')) { console.log(`  · ${t.name.padEnd(10)} 가로 규격 아님(「정책코드」 열 없음 · 있는 열: ${header.filter(Boolean).slice(0, 8).join('·')}) — 건너뜀. transpose-policy-tab 먼저`); continue; }

  const updates: { range: string; values: string[][] }[] = [];
  const before: Rec[] = [];
  let renamed = 0, fixed = 0, review = 0;

  // ① 머리글 이름
  const newHeader = header.map((h) => POLICY_FIELD_RENAMES[h] || h);
  header.forEach((h, i) => { if (newHeader[i] !== h) { renamed++; updates.push({ range: `'${TAB}'!${colName(i)}1`, values: [[newHeader[i]]] }); before.push({ cell: `${colName(i)}1`, from: h, to: newHeader[i] }); } });
  const idx = (name: string) => newHeader.indexOf(name);

  // ② 값
  const liveRows = rows.slice(1).filter((row) => policyRowLive(newHeader, row)).length; // 체크 열의 FALSE 만 있는 줄은 정책이 아니다
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!policyRowLive(newHeader, row)) continue;
    const code = S(row[0]);
    for (let c = POLICY_KEY_COLUMNS.length; c < newHeader.length; c++) {
      const name = newHeader[c];
      if (!name || !POLICY_VALUE_RULE_BY_NAME[name]) continue;
      const raw = S(row[c]);
      let value = raw; let status: string = 'same'; let note = '';
      // 2026-08-19 — 「추가운전 요금」은 이제 «1인당 월 정액/정률» 한 값이다(인원은 「추가운전 인원」). 옛 합성(「N인까지 · …」)은
      //   transpose 가 두 칸으로 가르므로 여기서는 합성하지 않는다. 합성값이 남아 있으면 규격기가 검토로 남긴다.
      const res = normalizePolicyValue(name, raw);
      value = res.value; status = res.status; note = res.note || '';
      if (status === 'fixed' && value !== raw) {
        fixed++; fixLines.set(name, (fixLines.get(name) || 0) + 1);
        updates.push({ range: `'${TAB}'!${colName(c)}${r + 1}`, values: [[value]] });
        before.push({ cell: `${colName(c)}${r + 1}`, code, name, from: raw, to: value });
      } else if (status === 'review') {
        review++; reviewLines.push(`${t.name} · ${code || '(기본)'} · ${name}: 「${raw}」 — ${note}`);
      }
    }
  }
  totals.renamed += renamed; totals.fixed += fixed; totals.review += review; totals.sheets++;
  console.log(`  ${t.name.padEnd(10)} 머리글 ${renamed} · 고침 ${fixed}칸 · 검토 ${review}`);
  if (!APPLY) continue;

  // 백업 → 쓰기 → 되읽어 대조 → 서식
  const backup = `tmp/policy-normalize-backup-${t.name}-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ id: t.id, tab: TAB, rows, changes: before }, null, 1), 'utf8');
  if (updates.length) {
    await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
    const back = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'`)}`) as { values?: string[][] };
    const got = ((back.values || []) as string[][]).map((r) => r.map(S));
    const bad = updates.filter((u) => { const m = u.range.match(/!([A-Z]+)(\d+)$/)!; const c = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; return S(got[Number(m[2]) - 1]?.[c]) !== u.values[0][0]; });
    if (bad.length) throw new Error(`${t.name}: 되읽기 불일치 ${bad.length}칸 — ${bad.slice(0, 3).map((b) => b.range).join(', ')} · 백업 ${backup}`);
  }
  // ③ 서식 — 드롭다운은 규격 허용값으로, 머리글 메모는 «왜 채우나 + 표기 규격».
  const fmt: Rec[] = [];
  // ★열이 늘고 줄고 자리가 바뀌면 옛 드롭다운·머리 메모가 «그 자리»에 남는다(2026-08-19 손오공: 전용계좌 칸에 탁송비 목록이 떴다).
  //   먼저 탭 전체의 데이터 검증과 머리행 메모를 지우고 새 규격을 입힌다.
  fmt.push({ setDataValidation: { range: { sheetId: gid } } });
  fmt.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { note: '' }, fields: 'note' } });
  const std = policySheetHeader();
  for (const b of policyBlocks()) fmt.push({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: b.from, endColumnIndex: b.to },
    cell: { userEnteredFormat: { backgroundColor: rgb(b.color), textFormat: { bold: true, fontSize: 9 }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
  } });
  newHeader.forEach((name, i) => {
    const f = POLICY_SHEET_FIELDS.find((x) => x.name === name);
    const rule = POLICY_VALUE_RULE_BY_NAME[name];
    if (f || rule) fmt.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { note: [f ? `[${USE_LABEL[f.use]}] ${f.note}` : '', rule ? `표기: ${rule.format}` : '', rule?.examples?.length ? `예: ${rule.examples.join(' · ')}` : ''].filter(Boolean).join('\n') }, fields: 'note',
    } });
    // 체크박스는 빈칸을 FALSE 로 채워 버린다 → 정책 줄 + 10줄까지만, 그 아래 FALSE 는 지운다(transpose 와 같은 규칙).
    if (rule?.kind === 'check') {
      fmt.push({ updateCells: { range: { sheetId: gid, startRowIndex: liveRows + 1, startColumnIndex: i, endColumnIndex: i + 1 }, fields: 'userEnteredValue' } });
      fmt.push({ setDataValidation: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: liveRows + 11, startColumnIndex: i, endColumnIndex: i + 1 },
        rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true, strict: false },
      } });
    }
    else if (rule?.allowed.length) fmt.push({ setDataValidation: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: Math.max(200, rows.length + 20), startColumnIndex: i, endColumnIndex: i + 1 },
      rule: { condition: { type: 'ONE_OF_LIST', values: rule.allowed.map((x) => ({ userEnteredValue: x })) }, showCustomUi: true, strict: false },
    } });
    else if (rule) fmt.push({ setDataValidation: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: Math.max(200, rows.length + 20), startColumnIndex: i, endColumnIndex: i + 1 } } });
  });
  if (newHeader.length !== std.length || newHeader.some((h, i) => h !== std[i])) console.log(`     ⚠ 머리글이 규격 차례와 다르다 — 값은 이름으로 맞췄으니 발행엔 문제 없다. 차례를 맞추려면 transpose-policy-tab`);
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt }) });
  console.log(`     ✓ 반영 · 백업 ${backup}`);
}

console.log(`\n  합계 — 시트 ${totals.sheets} · 머리글 ${totals.renamed} · 고침 ${totals.fixed}칸 · 검토 ${totals.review}`);
if (fixLines.size) console.log(`  항목별 고침: ${[...fixLines.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
if (reviewLines.length) { console.log(`\n  ▲ 검토(안 고침) ${reviewLines.length}`); for (const l of reviewLines) console.log(`     ${l}`); }
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
