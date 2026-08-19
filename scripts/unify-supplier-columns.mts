/**
 * **공급사 제공시트 재고탭 열 차례를 표준(웰릭스 기준)으로 다시 세운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「각 공급사 이제 진짜로 통일하자 공급사들 지치겄다」 · 「웰릭스가 표준이잖아 · 웰릭스 기준으로 다 맞추고」
 *   · 「차명 옵션 외부색상 내부색상 연식 주행거리 연료 배기량 대여료~~~ 구간 이렇게 통일좀 하자 제발 제발」
 *
 * 무엇을 하나
 *   · 표준 차례 = `supplier-template-sheet.TEMPLATE_COLUMNS`(앞줄 차례는 사장님 지시대로 옵션·주행거리 위치를 옮겼다) + 정제칸 12.
 *     ⚠ 그중 **웰릭스 재고탭에 실제로 있는 열만** 표준으로 본다(웰릭스가 표준) — 6개월·18개월·72개월 같은 규격 예비열은 표준에서 뺀다.
 *   · 표준 밖 열(6개월·18개월·차종·구독 블록…)은 **지우지 않고** 원래 왼쪽 이웃 뒤에 그대로 붙여 둔다.
 *   · 열을 옮길 뿐이다 — `moveDimension` 이라 값·서식·드롭다운·너비가 열과 함께 간다. 셀을 다시 쓰지 않는다.
 *   · 「차명(트림)」이 머리행에 있는 탭(재고·렌트재고·구독재고·재렌트…)만 대상. 정책·AI 인계는 안 건드린다.
 * 안전
 *   · 쓰기 전 머리행·전체 값을 `tmp/unify-columns-backup-<이름>-<탭>-<때>.json` 에 뜬다.
 *   · 옮긴 뒤 머리행을 되읽어 목표와 같은지 대조한다. 다르면 그 탭 이름을 화면에 찍는다(값은 그대로다 — 열만 움직였다).
 *   · 두 번 돌려도 안전하다(이미 표준이면 0회).
 *
 *   npx tsx scripts/unify-supplier-columns.mts
 *   npx tsx scripts/unify-supplier-columns.mts --apply
 *   npx tsx scripts/unify-supplier-columns.mts --apply --sheet=<ID>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { AI_TAIL_COLUMNS, SHEET_NAME_MATCH, TEMPLATE_COLUMNS, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const BASE = arg('base', '1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI');   // 웰릭스 프리패스 재고
const MARK = '차명(트림)';

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

/** 표준 차례(전체 규격) — 이 중 웰릭스에 있는 것만 표준 순위를 받는다. */
const FULL_ORDER = [...TEMPLATE_COLUMNS.map((c) => c.name), ...AI_TAIL_COLUMNS.map((c) => c.name)];
const findHeader = (rows: string[][]) => rows.findIndex((r) => r.some((c) => S(c) === MARK));
const readTab = async (id: string, title: string) => {
  const v = await call(`${SH}/${id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ8`)}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  const h = findHeader(rows);
  return { headerRow: h, header: h >= 0 ? rows[h] : [] };
};

// 웰릭스 표준 — 실제 있는 열만
const baseMeta = await call(`${SH}/${BASE}?fields=sheets.properties`);
const baseTab = (baseMeta.sheets || []).map((x: Rec) => x.properties).find((p: Rec) => S(p.title) === '재고') || (baseMeta.sheets || [])[0]?.properties;
const base = await readTab(BASE, S(baseTab.title));
const baseNames = new Set(base.header.filter(Boolean));
const STANDARD = FULL_ORDER.filter((n) => baseNames.has(n));
const missingInBase = base.header.filter((n) => n && !FULL_ORDER.includes(n));
console.log(`■ 표준(웰릭스 「${S(baseTab.title)}」 ${base.header.length}열) → 표준 차례 ${STANDARD.length}열${missingInBase.length ? ` · 규격 밖 열 ${missingInBase.join(',')}` : ''}\n   ${STANDARD.join(' | ')}\n`);

/** 현재 머리행 → 목표 차례. 표준 열은 표준 순위로, 표준 밖 열은 원래 왼쪽 이웃 뒤에. */
function targetOrder(header: string[]): string[] {
  const names = header.map(S);
  const anchored = new Map<string, string[]>();   // 표준열 이름(또는 '') → 그 뒤에 붙는 표준 밖 열들
  let anchor = '';
  for (const n of names) {
    if (!n) { anchor = anchor; continue; }
    if (STANDARD.includes(n)) { anchor = n; continue; }
    (anchored.get(anchor) || anchored.set(anchor, []).get(anchor)!).push(n);
  }
  const out: string[] = [...(anchored.get('') || [])];
  for (const n of STANDARD) {
    if (!names.includes(n)) continue;
    out.push(n, ...(anchored.get(n) || []));
  }
  return out;
}

const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(f.name) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
mkdirSync('tmp', { recursive: true });
let tabsSeen = 0, tabsMoved = 0, tabsSame = 0, movesTotal = 0; const failed: string[] = [];
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties`);
  for (const p of (meta.sheets || []).map((x: Rec) => x.properties)) {
    if (p.hidden) continue;
    const title = S(p.title);
    if (['정책', 'AI 인계', 'AI 정제', '정책 작성법'].includes(title)) continue;
    const cur = await readTab(t.id, title);
    if (cur.headerRow < 0) continue;
    tabsSeen++;
    const header = cur.header;
    // 머리행 뒤쪽 빈 이름은 자리만 있는 열 — 이름 있는 열만 다룬다(빈 열은 맨 뒤로 밀린다).
    const named = header.filter(Boolean);
    const target = targetOrder(header);
    if (JSON.stringify(named) === JSON.stringify(target.filter((n) => named.includes(n)))) {
      // 표준 열의 상대 차례가 이미 같고, 빈 열이 사이에 없으면 그대로
      const namedIdx = header.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
      const contiguous = namedIdx.every((v, i) => i === 0 || v === namedIdx[i - 1] + 1);
      if (contiguous) { tabsSame++; console.log(`  ✓ ${t.name.padEnd(10)} 「${title}」 — 이미 표준 차례 (${named.length}열)`); continue; }
    }
    // 이동 계획 — 목표 차례대로 앞에서부터 끌어온다.
    const work = [...header];
    const moves: { from: number; to: number; name: string }[] = [];
    for (let i = 0; i < target.length; i++) {
      const j = work.indexOf(target[i]);
      if (j < 0) throw new Error(`${t.name} 「${title}」 열 없음: ${target[i]}`);
      if (j === i) continue;
      moves.push({ from: j, to: i, name: target[i] });
      const [col] = work.splice(j, 1);
      work.splice(i, 0, col);
    }
    tabsMoved++; movesTotal += moves.length;
    console.log(`  → ${t.name.padEnd(10)} 「${title}」 — 이동 ${moves.length}회 · ${header.filter(Boolean).length}열`);
    console.log(`       지금: ${header.filter(Boolean).slice(0, 14).join(' | ')} …`);
    console.log(`       목표: ${target.slice(0, 14).join(' | ')} …`);
    if (!APPLY) continue;
    // 백업(값 전체) → 이동 → 되읽어 대조
    const full = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
    const backup = `tmp/unify-columns-backup-${t.name}-${title}-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify({ id: t.id, tab: title, sheetId: p.sheetId, header, target, moves, values: full.values || [] }, null, 1), 'utf8');
    const requests = moves.map((m) => ({ moveDimension: {
      source: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: m.from, endIndex: m.from + 1 },
      destinationIndex: m.from > m.to ? m.to : m.to + 1,
    } }));
    try {
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    } catch (e) {
      failed.push(`${t.name} 「${title}」 — ${String((e as Error).message).slice(0, 160)} · 백업 ${backup}`);
      console.log(`       ✗ 이동 실패 — ${String((e as Error).message).slice(0, 120)}`);
      continue;
    }
    const after = await readTab(t.id, title);
    const got = after.header.filter(Boolean);
    const want = target;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failed.push(`${t.name} 「${title}」 — 되읽은 머리행이 목표와 다름 · 백업 ${backup}`);
      console.log(`       ✗ 되읽기 불일치: ${got.slice(0, 14).join(' | ')} …`);
    } else console.log(`       ✓ 반영 · 백업 ${backup}`);
  }
}
console.log(`\n  탭 ${tabsSeen} · 이미 표준 ${tabsSame} · 옮김 ${tabsMoved}(이동 ${movesTotal}회)${failed.length ? `\n  ✗ 실패 ${failed.length}\n     ${failed.join('\n     ')}` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 이동은 --apply\n');
