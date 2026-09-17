/**
 * **공급사 제공시트의 열을 값 그대로 옮긴다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 따로 만들었나
 *   `build-supplier-sheet-set --force` 는 표를 갈아엎으며 **공급사가 채운 값까지 지운다**.
 *   `restyle-supplier-sheets` 는 서식만 다시 입히고 열은 안 옮긴다.
 *   이미 값이 들어찬 시트에서 열 순서만 바꾸려면 `moveDimension` 을 써야 한다 — 값이 따라 움직인다.
 *
 * ★지금 옮기는 것(사장님 2026-08-13 — 「주행거리를 옵션 뒤로 보내주세요」)
 *   「옵션」을 「주행거리」 **바로 앞**으로 보낸다. 결과는 … 연료 │ 옵션 │ 주행거리 │ 배기량 …
 *   ⚠ 주행거리만 앞으로 당기면 표(Table)가 옵션에서 끊겨 색상·연식·연료의 칩이 죽는다.
 *     드롭다운 칸을 왼쪽에 몰아 두는 규칙은 `supplier-template-sheet.tableWidth` 가 지킨다.
 *
 * ⚠ **공급사 소유 시트는 건드리지 않는다.** 우리가 만든 제공시트만 대상이다.
 * ⚠ 이미 제자리면 건너뛴다. 두 번 돌려도 안전하다.
 *
 *   npx tsx scripts/move-supplier-column.mts
 *   npx tsx scripts/move-supplier-column.mts --apply --sheet=<ID>
 *   npx tsx scripts/move-supplier-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
/** 옮길 열 → 어느 열 «바로 앞»에 세울까. */
const MOVE = arg('move', '옵션');
const BEFORE = arg('before', '주행거리');
/** 제공시트 주소가 모여 있는 문패. `restyle-supplier-sheets` 와 같은 곳을 본다. */
const INDEX_SHEET = arg('index', '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const call = async (u: string, init?: RequestInit) => {
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
};
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * 대상 시트 모으기 — 하나만 지정하면 그것만.
 * ★기본은 **드라이브에서 이름으로 찾는다.** 우리 제공시트는 「〈공급사〉 프리패스 재고」다.
 * ⚠ 문패 시트(`INDEX_SHEET`)를 훑지 마라 — 거기 담긴 건 **공급사 소유 시트 주소**다.
 *   그걸로 돌리면 남의 문서를 고치게 된다(실측 2026-08-13 · 16곳 중 우리 것이 1곳뿐이었다).
 */
const NAME = arg('name', '프리패스 재고');
const targets: string[] = [];
if (ONE) targets.push(ONE);
else {
  let page = '';
  do {
    const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
    const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true${page ? `&pageToken=${page}` : ''}`) as Rec;
    for (const f of (r.files || []) as Rec[]) if (!targets.includes(S(f.id))) targets.push(S(f.id));
    page = S(r.nextPageToken);
  } while (page);
}
console.log(`■ 열 옮기기 ${APPLY ? '반영' : '미리보기(dry-run)'} — 「${MOVE}」를 「${BEFORE}」 바로 앞으로\n`);
console.log(`  대상 시트 ${targets.length}개\n`);

/**
 * ★**우리가 만든 제공시트만 손댄다.** 공급사가 자기 시트를 쓰는 곳(손오공 상품화 시트·오플·
 *   아이카·아이언·이안카)은 남의 문서다. 우리가 열을 옮기면 그쪽 업무가 깨진다.
 * ⚠ **소유자로 가르지 마라.** 우리 제공시트도 회사 계정 여럿(`tbag4783@` 등)에 흩어져 있어
 *   `pyh@teamjpk.com` 으로 거르면 우리 것까지 전부 막힌다(실측 2026-08-13 · 16/16 이 막혔다).
 * ★가르는 표식은 **열 이름 「차명(세부모델+트림)」**이다 — 우리 표준 양식에만 있다.
 *   공급사 자기 시트는 「모델명(트림)」·「차종」 같은 제 이름을 쓴다.
 */
const MARK = arg('mark', '차명(세부모델+트림)');

let moved = 0, already = 0, skipped = 0, foreign = 0;
for (const id of targets) {
  let meta: Rec;
  try { meta = await call(`${API}/${id}?fields=properties.title,sheets.properties(sheetId,title,hidden)`); } catch (e) { console.log(`  ✗ ${id} — 못 읽음 ${(e as Error).message.slice(0, 60)}`); continue; }
  const book = S(meta.properties?.title);
  for (const s of (meta.sheets || []) as Rec[]) {
    const tab = S(s.properties.title);
    if (s.properties.hidden) continue;
    let head: { values?: string[][] };
    try { head = await call(`${API}/${id}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] }; } catch { continue; }
    const rows = (head.values || []) as string[][];
    // 머리행은 「주행거리」가 있는 줄이다 — 위에 정책 안내가 몇 줄 붙어 있다.
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm(BEFORE)));
    if (hi < 0) continue;
    const hdr = rows[hi].map(norm);
    // 우리 양식이 아니면 손대지 않는다.
    if (!hdr.includes(norm(MARK))) { foreign++; console.log(`  ⏭ ${book} 「${tab}」 — 우리 양식이 아니다(「${MARK}」 열 없음)`); continue; }
    const from = hdr.indexOf(norm(MOVE));
    const to = hdr.indexOf(norm(BEFORE));
    if (from < 0 || to < 0) continue;
    if (from === to - 1) { already++; console.log(`  = ${book} 「${tab}」 — 이미 제자리`); continue; }
    if (from > to) { skipped++; console.log(`  ⏭ ${book} 「${tab}」 — 「${MOVE}」가 이미 뒤에 있다(${from} > ${to}), 건드리지 않는다`); continue; }
    console.log(`  → ${book} 「${tab}」 — ${MOVE} ${from}열 → ${to}열 앞`);
    moved++;
    if (!APPLY) continue;
    await call(`${API}/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ moveDimension: {
        source: { sheetId: s.properties.sheetId, dimension: 'COLUMNS', startIndex: from, endIndex: from + 1 },
        // 앞으로 옮길 때 최종 자리는 destinationIndex - 1 이다(옮기기 전 좌표 기준).
        destinationIndex: to,
      } }] }),
    });
  }
}
console.log(`\n  옮김 ${moved} · 이미 제자리 ${already}${skipped ? ` · 자리가 뒤라 건너뜀 ${skipped}` : ''}${foreign ? ` · 우리 양식이 아니라 건너뜀 ${foreign}` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 이동은 --apply\n');
