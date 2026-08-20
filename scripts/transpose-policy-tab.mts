/**
 * **정책 탭을 세로 → 가로로 돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「가로로 바꾸는 게 연동하는 데는 더 수월할까」 · 「공급사에 정책 관련
 *   내용 채우라고 하자」)
 *   지금은 행이 항목, 열이 정책이다. 43항목이 한 줄로 늘어서 있어 **공급사가 뭘 왜 채우는지
 *   모른다.** 가로로 돌리고 «어디에 쓰이는가»로 블록을 갈라야 채워 달라고 말할 수 있다.
 *
 * ★안전 계약
 *   · **값은 하나도 안 버린다.** 옛 표에 있던 항목이 새 규격에 없으면 맨 뒤에 열로 붙인다.
 *   · 쓰기 전에 옛 표를 통째로 `tmp/policy-backup-<이름>-<때>.json` 에 뜬다.
 *   · 쓴 뒤 **칸 단위로 되읽어 대조**한다. 하나라도 어긋나면 화면에 찍는다.
 *   · 두 번 돌려도 안전하다 — 이미 가로면 건너뛴다.
 *
 * ⚠ 정책 탭이 없는 시트는 건드리지 않는다.
 * ⚠ 한 곳 먼저 시험하고 확대하라 — `--sheet=<ID>` 로 한 곳만 돌릴 수 있다.
 *
 *   npx tsx scripts/transpose-policy-tab.mts
 *   npx tsx scripts/transpose-policy-tab.mts --apply --sheet=<ID>
 *   npx tsx scripts/transpose-policy-tab.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  POLICY_KEY_COLUMNS, POLICY_PREFILL, POLICY_RETIRED_FIELDS, POLICY_SHEET_FIELDS, USE_LABEL,
  policyBlocks, policySheetHeader,
} from '../lib/domain/policy-sheet-layout';
import { POLICY_VALUE_LISTS } from '../lib/domain/supplier-template-sheet';
import { POLICY_CHECK_FIELD_NAMES, POLICY_FIELD_RENAMES } from '../lib/domain/policy-value-spec';
import { policyCellValue, policyRowLive } from '../lib/domain/supplier-policy-read';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const NAME = arg('name', '프리패스 재고');
import { POLICY_TAB_NAME, isPolicyTabTitle } from '../lib/domain/supplier-template-sheet';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 250)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
/** 0-based 열 번호 → A1 표기(AA 이후도). */
const colA1 = (i: number): string => { let n = i, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const rgb = (h: string) => ({ red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 });
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace(/[:T]/g, '');

const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of (r.files || []) as Rec[]) targets.push({ id: S(f.id), name: S(f.name) });
}
console.log(`■ 정책 탭 세로 → 가로 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳\n`);

const HEADER = policySheetHeader();
let done = 0, already = 0, skipped = 0, bad = 0;

for (const t of targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
  const meta = await call(`${SH}/${t.id}?fields=properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))`);
  const book = S(meta.properties?.title) || t.name;
  /**
   * ★한 문서에 정책 탭이 **여럿**일 수 있다 — 법인이 둘인 곳(빌린카/엘씨 · 경진카/경진렌트 · 스타/스카이)은
   *   「빌린카운영정책 · 엘씨운영정책」처럼 갈라 적는다. 예전엔 「운영정책」 하나만 찾아 그 6개 탭이 통째로 안 돌았다(2026-08-20 실측).
   * ⚠ 「○○운영정책」은 **이름을 바꾸지 않는다** — 둘을 「운영정책」으로 만들면 어느 법인 것인지 사라진다. 옛 이름 「정책」만 표준명으로 바꾼다.
   */
  const policyTabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties).filter((x) => isPolicyTabTitle(S(x?.title)));
  if (!policyTabs.length) { skipped++; console.log(`  ⏭ ${book} — 정책 탭이 없다`); continue; }
  for (const p of policyTabs) {
  const TAB = S(p.title);
  const label = policyTabs.length > 1 ? `${book} 〔${TAB}〕` : book;

  const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${TAB}'`)}`) as { values?: string[][] };
  const rows = (v.values || []) as string[][];
  if (!rows.length) { skipped++; console.log(`  ⏭ ${label} — 정책 탭이 비었다`); continue; }

  /**
   * 이미 가로인가 — 첫 줄이 「정책코드 · 정책명 · …」이면 그렇다.
   * ★열 차례가 규격과 **다르면 다시 눕힌다.** 블록 배치를 고치면 시트도 따라와야 한다
   *   (승계를 계약서 블록에서 영업자 블록으로 옮긴 것처럼).
   */
  const isWide = norm(rows[0]?.[0]) === '정책코드' && norm(rows[0]?.[1]) === '정책명' && !!S(rows[0]?.[2]);
  /** 이미 규격대로면 값은 안 건드리고 서식만 다시 입힌다. */
  let formatOnly = false;
  if (isWide) {
    const now = rows[0].map(S).filter(Boolean);
    const want = policySheetHeader();
    const same = want.every((h, i) => norm(now[i]) === norm(h));
    if (same) {
      /**
       * ★값은 그대로 두고 **서식만** 다시 입힌다 — 드롭다운·블록색·머리글 메모.
       * ⚠ 예전엔 여기서 건너뛰어서, 뒤에 드롭다운을 넣어도 이미 가로인 시트엔 안 붙었다.
       */
      formatOnly = true;
    } else {
      console.log(`  ↻ ${label} — 가로인데 열 차례가 규격과 다르다. 다시 눕힌다`);
    }
  }

  /**
   * 지금 표를 «항목 → (정책자리 → 값)» 으로 읽는다. 세로든 가로든 같은 모양으로 만든다.
   *   세로: A열=항목 · B열=프리패스 기본 · C열부터=정책
   *   가로: 1행=머리 · 2행부터=정책(첫 줄이 프리패스 기본)
   */
  const cols: [number, string][] = [];
  const byField = new Map<string, Map<number, string>>();
  let nameRow: string[] | undefined;
  if (isWide) {
    const hdr = rows[0].map(S);
    // 체크 열의 FALSE 는 값이 아니다(빈 체크박스) — 그것만 있는 줄은 정책이 아니다.
    rows.slice(1).forEach((r, k) => { if (policyRowLive(hdr, r)) cols.push([k, S(r[0]) || '(프리패스 기본)']); });
    hdr.forEach((h, ci) => {
      if (!h || /^정책코드$|^정책명$/.test(norm(h))) return;
      const m = new Map<number, string>();
      cols.forEach(([k]) => { const x = policyCellValue(h, rows[k + 1]?.[ci]); if (x) m.set(k, x); });
      byField.set(h, m);
    });
    nameRow = undefined;
  } else {
    const head = rows.find((r) => norm(r[0]) === '정책코드');
    if (!head) { skipped++; console.log(`  ⏭ ${book} — 「정책코드」 줄이 없다`); continue; }
    nameRow = rows.find((r) => norm(r[0]) === '정책명');
    cols.push([1, '(프리패스 기본)']);
    head.forEach((c, i) => { if (i >= 2 && S(c)) cols.push([i, S(c)]); });
    for (const r of rows) {
      const f = S(r[0]);
      if (!f || /^정책코드$|^정책명$/.test(norm(f))) continue;
      const m = new Map<number, string>();
      for (const [i] of cols) { const x = S(r[i]); if (x) m.set(i, x); }
      byField.set(f, m);
    }
  }

  // ★개명(POLICY_FIELD_RENAMES) — 옛 이름 열의 값은 새 이름 열로 옮긴다(둘 다 있으면 새 이름 값이 이긴다).
  for (const [oldName, newName] of Object.entries(POLICY_FIELD_RENAMES)) {
    const oldKey = [...byField.keys()].find((k) => norm(k) === norm(oldName));
    if (!oldKey) continue;
    const newKey = [...byField.keys()].find((k) => norm(k) === norm(newName)) || newName;
    const merged = new Map(byField.get(oldKey)!);
    for (const [i, v] of byField.get(newKey) || []) if (S(v)) merged.set(i, v);
    byField.set(newKey, merged);
    byField.delete(oldKey);
  }
  // ★폐지 열 「추가주행 방식」 — 「불가」였고 금액이 비었으면 금액 칸에 「불가」를 옮긴다. 그 밖엔 금액 표기가 방식을 말하므로 버린다.
  {
    const modeKey = [...byField.keys()].find((k) => norm(k) === norm('추가주행 방식'));
    const feeKey = [...byField.keys()].find((k) => norm(k) === norm('추가주행 금액'));
    if (modeKey) {
      const modes = byField.get(modeKey)!;
      const fees = byField.get(feeKey || '추가주행 금액') || new Map<number, string>();
      for (const [i, mode] of modes) if (/불가/.test(mode) && !S(fees.get(i))) fees.set(i, '불가');
      byField.set(feeKey || '추가주행 금액', fees);
    }
  }
  // ★「추가운전 요금」 옛 합성값(「1인까지 · 1인당 월 5만원」·「불가」·「제한없음 · …」) → 「추가운전 인원」 + 「추가운전 요금(1인당 월)」 두 칸(사장님 2026-08-19).
  {
    const feeKey = [...byField.keys()].find((k) => norm(k) === norm('추가운전 요금'));
    if (feeKey) {
      const fees = byField.get(feeKey)!;
      const countKey = [...byField.keys()].find((k) => norm(k) === norm('추가운전 인원')) || '추가운전 인원';
      const counts = byField.get(countKey) || new Map<number, string>();
      for (const [i, raw] of [...fees.entries()]) {
        const parts = S(raw).split(/\s*·\s*/);
        const head = S(parts[0]);
        if (/^불가$/.test(head)) { if (!S(counts.get(i))) counts.set(i, '불가'); fees.set(i, '불가'); continue; }
        if (parts.length === 2 && /인까지|제한없음/.test(head)) {
          if (!S(counts.get(i))) counts.set(i, head);
          fees.set(i, S(parts[1]).replace(/^1인당\s*/, '').replace(/^월\s*/, ''));
        }
      }
      byField.set(countKey, counts);
    }
  }
  // ★폐지 「추가운전」(가부) — 「불가」였고 인원이 비었으면 「추가운전 인원」에 「불가」를 옮긴다.
  {
    const gateKey = [...byField.keys()].find((k) => norm(k) === norm('추가운전'));
    if (gateKey) {
      const countKey = [...byField.keys()].find((k) => norm(k) === norm('추가운전 인원')) || '추가운전 인원';
      const counts = byField.get(countKey) || new Map<number, string>();
      for (const [i, v] of byField.get(gateKey)!) if (/불가/.test(v) && !S(counts.get(i))) counts.set(i, '불가');
      byField.set(countKey, counts);
    }
  }
  // 새 규격에 없는 옛 항목은 버리지 않고 뒤에 붙인다 — 폐지 열(POLICY_RETIRED_FIELDS)만 예외.
  const extra = [...byField.keys()].filter((f) => !HEADER.some((h) => norm(h) === norm(f)) && !POLICY_RETIRED_FIELDS.some((r) => norm(r) === norm(f)));
  const header = [...HEADER, ...extra];

  const body = cols.map(([i, code]) => header.map((h) => {
    if (norm(h) === '정책코드') return code === '(프리패스 기본)' ? '(프리패스 기본)' : code;
    if (norm(h) === '정책명') {
      const from = isWide ? S(rows[i + 1]?.[1]) : S(nameRow?.[i]);
      return from || (code === '(프리패스 기본)' ? '프리패스 표준' : '');
    }
    const cur = byField.get([...byField.keys()].find((k) => norm(k) === norm(h)) || '')?.get(i) || '';
    return cur || (code === '(프리패스 기본)' ? (POLICY_PREFILL[h] || '') : '');
  }));

  const filled = body.slice(1).reduce((n, r) => n + r.filter((c, i) => i >= 2 && S(c)).length, 0);
  const total = Math.max(1, (body.length - 1) * (header.length - 2));
  if (formatOnly) {
    already++;
    console.log(`  = ${label} — 이미 가로다. 서식만 다시 입힌다 (정책 ${body.length - 1}개 · 채운 칸 ${Math.round(filled / total * 100)}%)`);
  } else {
    console.log(`  → ${label} — 정책 ${body.length - 1}개 · ${header.length}열${extra.length ? ` (옛 항목 ${extra.length}개 뒤에 붙임: ${extra.join(', ')})` : ''}`);
    console.log(`       공급사가 채운 칸 ${filled}/${total} (${Math.round(filled / total * 100)}%)`);
    done++;
  }
  if (!APPLY) continue;

  // ── 백업 먼저 (값을 다시 쓸 때만)
  if (!formatOnly) mkdirSync('tmp', { recursive: true });
  const backup = `tmp/policy-backup-${label.replace(/[^\w가-힣]+/g, '_')}-${stamp}.json`;
  if (!formatOnly) writeFileSync(backup, JSON.stringify({ book, at: stamp, rows }, null, 1), 'utf8');

  const gid = p.sheetId as number;
  const renameToStandard = TAB === '정책';   // 「○○운영정책」은 법인 구분이라 그대로 둔다
  const reqs: Rec[] = formatOnly ? [] : [
    ...(renameToStandard ? [{ updateSheetProperties: { properties: { sheetId: gid, title: POLICY_TAB_NAME }, fields: 'title' } }] : []),
    { updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue,userEnteredFormat' } },
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
  ];
  if ((Number(p.gridProperties?.columnCount) || 26) < header.length) {
    reqs.push({ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: header.length - (Number(p.gridProperties?.columnCount) || 26) } });
  }
  if (reqs.length) await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  if (!formatOnly) {
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${renameToStandard ? POLICY_TAB_NAME : TAB}'!A1`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values: [header, ...body] }),
    });
  } else {
    /**
     * ★이미 가로라 값을 다시 쓰지 않는 시트에도 «(프리패스 기본) 줄의 빈칸»은 PREFILL 로 채운다(사장님 2026-08-20 심사조건 무심사).
     *   그 줄의 정본은 POLICY_PREFILL 이다 — 항목을 새로 정할 때마다 시트를 손으로 열지 않게.
     *   ⚠ 채운 칸은 건드리지 않는다(공급사가 고친 값을 되돌리면 안 된다). 기본줄 = 코드가 비었거나 「(프리패스 기본)」인 첫 줄.
     */
    const baseRow = rows.findIndex((r, i) => i > 0 && (!S(r[0]) || /프리패스 기본/.test(S(r[0]))) && policyRowLive(header, r));
    if (baseRow > 0) {
      const data = header.flatMap((name, ci) => {
        const want = POLICY_PREFILL[name];
        if (!want || ci < POLICY_KEY_COLUMNS.length) return [];
        if (policyCellValue(name, rows[baseRow]?.[ci])) return [];
        return [{ range: `'${POLICY_TAB_NAME}'!${colA1(ci)}${baseRow + 1}`, values: [[want]] }];
      });
      if (data.length) {
        await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
        console.log(`       기본줄 빈칸 ${data.length}칸을 프리패스 표준값으로 채움`);
      }
    }
  }

  // ── 블록 색과 머리글 메모 — 공급사가 «왜 채우는지» 알아야 채운다
  const fmt: Rec[] = [];
  // ★열이 늘고 줄고 자리가 바뀌면 옛 드롭다운·머리 메모가 «그 자리»에 남는다(2026-08-19 손오공: 전용계좌 칸에 탁송비 목록이 떴다).
  //   먼저 탭 전체의 데이터 검증과 머리행 메모를 지우고 새 규격을 입힌다.
  if (formatOnly && renameToStandard) fmt.push({ updateSheetProperties: { properties: { sheetId: gid, title: POLICY_TAB_NAME }, fields: 'title' } });
  fmt.push({ setDataValidation: { range: { sheetId: gid } } });
  fmt.push({ repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { note: '' }, fields: 'note' } });
  for (const b of policyBlocks()) {
    fmt.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: b.from, endColumnIndex: b.to },
      cell: { userEnteredFormat: { backgroundColor: rgb(b.color), textFormat: { bold: true, fontSize: 9 }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
    } });
  }
  POLICY_SHEET_FIELDS.forEach((f, i) => {
    fmt.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: i + POLICY_KEY_COLUMNS.length, endColumnIndex: i + POLICY_KEY_COLUMNS.length + 1 },
      cell: { note: `[${USE_LABEL[f.use]}] ${f.note}` }, fields: 'note',
    } });
  });
  fmt.push({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2 },
    cell: { userEnteredFormat: { backgroundColor: rgb('F5F5F5'), textFormat: { italic: true } } },
    fields: 'userEnteredFormat(backgroundColor,textFormat)',
  } });
  /**
   * ★**드롭다운** — 골라 넣게 하면 표기가 안 갈린다(사장님 2026-08-14).
   * ⚠ 막지는 않는다(strict=false). 목록에 없는 답이 실제로 있다 — 「2회까지」처럼.
   *   막으면 공급사가 못 적고 그냥 비워 둔다.
   */
  let drops = 0;
  header.forEach((name, i) => {
    // ⑩ 제출서류 — 체크박스(사장님 2026-08-19 「체크하게」).
    //   ⚠ BOOLEAN 검증은 빈칸을 FALSE 로 채워 버린다 → 정책 줄 + 10줄까지만 건다(200줄에 걸면 유령 정책 198개 — 손오공 실측).
    //   그 아래 남은 FALSE 는 지운다. 새 정책 줄은 윗줄을 복사하면 체크박스가 따라온다.
    if (POLICY_CHECK_FIELD_NAMES.includes(name)) {
      drops++;
      fmt.push({ updateCells: { range: { sheetId: gid, startRowIndex: body.length, startColumnIndex: i, endColumnIndex: i + 1 }, fields: 'userEnteredValue' } });
      fmt.push({ setDataValidation: {
        range: { sheetId: gid, startRowIndex: 1, endRowIndex: body.length + 10, startColumnIndex: i, endColumnIndex: i + 1 },
        rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true, strict: false },
      } });
      return;
    }
    const list = POLICY_VALUE_LISTS[name];
    if (!list?.length) return;
    drops++;
    fmt.push({ setDataValidation: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: Math.max(200, body.length + 20), startColumnIndex: i, endColumnIndex: i + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: list.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true,
        strict: false,
      },
    } });
  });
  fmt.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: header.length }, properties: { pixelSize: 118 }, fields: 'pixelSize' } });
  fmt.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } });
  await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt }) });

  // ── 되읽어 칸 단위 대조 (값을 다시 쓴 때만)
  if (formatOnly) { console.log(`       서식 다시 입힘 — 드롭다운 ${drops}칸`); continue; }
  const back = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${renameToStandard ? POLICY_TAB_NAME : TAB}'`)}`) as { values?: string[][] };
  const got = (back.values || []) as string[][];
  const want = [header, ...body];
  let miss = 0;
  const diffs: string[] = [];
  want.forEach((r, ri) => r.forEach((c, ci) => {
    const back = S(got[ri]?.[ci]);
    if (S(c) === back) return;
    // 체크박스 칸(BOOLEAN 검증)은 빈칸을 FALSE 로 돌려준다 — 같은 뜻이라 어긋남이 아니다.
    if (POLICY_CHECK_FIELD_NAMES.includes(header[ci]) && !S(c) && back === 'FALSE') return;
    miss++;
    if (diffs.length < 6) diffs.push(`${header[ci] || ci}[${ri}] 「${S(c)}」→「${back}」`);
  }));
  if (miss) { bad++; console.log(`       ⛔ 되읽으니 ${miss}칸이 다르다 — 백업 ${backup}
         ${diffs.join(' · ')}`); }
  else console.log(`       ✓ ${want.length}줄 × ${header.length}열 그대로 · 드롭다운 ${drops}칸 · 백업 ${backup}`);
  }
}
console.log(`\n  돌림 ${done} · 이미 가로 ${already} · 건너뜀 ${skipped}${bad ? ` · ⛔ 어긋남 ${bad}` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply — 한 곳 먼저 시험하라(--sheet=<ID>)\n');
if (bad) process.exitCode = 1;
