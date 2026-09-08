/**
 * **달 탭마다 합계 아래에 «빠진 건 적는 자리» 열 줄을 보장한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「누락된 거 입력하는 필드를 **아래쪽에 10개씩** 만들자」
 *   (2026-09-03 「정산서 밑에 여백을 열 줄 놓아 두면 추가하라고 빠진 거 있으면 추가해 달라고」)
 *
 * ★★**발행기는 «자기가 찍는 달»만 손댄다.** 그래서 지난 달 탭에는 자리가 안 생긴다 —
 *   실측 2026-09-08, 하허호 1~7월 탭이 예비줄 «세 줄»뿐이었다.
 *   그런데 빠진 건은 지난 달에 더 많다. 자리가 없으면 적을 데가 없어 카톡으로 오게 되고,
 *   그러면 우리 표와 맞대는 길이 끊긴다.
 *
 * ★**표는 안 건드린다.** 합계 줄 «아래»에만 줄을 끼운다(`insertDimension`).
 *   위 표는 한 칸도 안 움직이고, 꼬리 안내만 아래로 밀린다.
 *
 * ⚠ 이미 적어 둔 줄은 «세지 않는다» — 빈 줄만 센다. 열 줄을 채우되 적어 둔 것은 그대로 둔다.
 * ⚠ 예비줄에는 체크박스를 걷는다 — 지난 달 본표였던 자리라 데이터 확인이 남아 있다.
 *
 * ```
 * npx tsx scripts/ensure-spare-rows.mts
 * npx tsx scripts/ensure-spare-rows.mts --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');
const WANT = 10;
/**
 * 꼬리 안내 — 여기서부터는 여백이 아니다.
 * ⚠ **「빠진 건이 있으면…」은 꼬리가 아니다** — 그건 예비줄 «첫 줄»에 우리가 놓은 안내다.
 *   그걸 꼬리로 세면 자리가 이미 있는 탭이 「0줄」로 잡혀 열 줄을 «또» 끼운다.
 *   실측 2026-09-08 — dry-run 이 아니었으면 20줄짜리 여백이 될 뻔했다.
 */
const FOOT = /맞으면 「확인」|아직 마감 전입니다|지급 예정일은|입금 부탁드립니다|프리패스 매니저|세금계산서|한 달간/;
const HINT = '빠진 건이 있으면 이 줄부터 적어 주세요 — 차량번호·임차인과 «공급가액»까지 적어 주시면 그대로 반영합니다';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const call = async (u: string, m?: string, b?: unknown): Promise<Record<string, unknown> | null> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(u, { method: m || 'GET', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    if (r.ok) return r.json().catch(() => ({})) as Promise<Record<string, unknown>>;
    if (r.status === 429 || r.status >= 500) { await nap(15_000); continue; }
    console.log(`      ✕ ${r.status} ${(await r.text()).slice(0, 120)}`); return null;
  }
  return null;
};

const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("(name contains '프리패스 재고' or name contains '프리패스 정산') and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] } | null)?.files || [];
console.log(`\n■ 달 탭마다 «빠진 건 적는 자리» ${WANT}줄 ${APPLY ? '(반영)' : '(대조만)'}\n`);

let fixed = 0;
for (const f of files.filter((x) => /사용중/.test(x.name))) {
  const name = f.name.replace(/^\[[^\]]+\]\s*/, '');
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`) as {
    sheets?: { properties: { sheetId: number; title: string; gridProperties: { columnCount: number } } }[] } | null;
  for (const p of (meta?.sheets || []).map((s) => s.properties)) {
    if (!/^\d{2}년\d{2}월 정산/.test(p.title) || /예시|샘플|견본/.test(p.title)) continue;
    const g = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(`'${p.title}'!A1:AZ400`)}`)) as { values?: unknown[][] } | null)?.values || [];
    let sum = -1;
    for (let i = 0; i < g.length; i++) if (S((g[i] || [])[1]).replace(/\s/g, '') === '합계') { sum = i; break; }
    if (sum < 0) { console.log(`   ? ${pad(name, 24)} 「${p.title}」 합계 줄이 없습니다 — 넘어갑니다`); continue; }
    /**
     * ★**«빈 줄»만 센다.** 합계 아래에 우리가 쓴 안내(「지난 기록입니다」 등)가 끼어 있으면
     *   그 줄은 적을 자리가 아니다 — 실측 2026-09-08 하허호 7월 탭은 여백이 열 줄처럼 보였지만
     *   안내 두 줄이 가운데 끼어 실제로 적을 수 있는 것은 일곱 줄이었다.
     * ⚠ 「빠진 건이 있으면…」 안내는 우리가 놓은 «이정표»라 빈 줄로 친다 — 상대가 그 위에 덮어 적는다.
     */
    let gap = 0;
    for (let i = sum + 1; i < g.length; i++) {
      const txt = (g[i] || []).map(S).filter(Boolean).join(' ');
      if (FOOT.test(txt)) break;
      if (!txt || txt.startsWith('빠진 건이 있으면')) gap++;
    }
    if (gap >= WANT) { console.log(`   ✓ ${pad(name, 24)} 「${p.title}」 ${gap}줄`); continue; }
    const need = WANT - gap;
    fixed++;
    console.log(`   ${APPLY ? '+' : '·'} ${pad(name, 24)} 「${p.title}」 ${gap}줄 → ${WANT}줄  (${need}줄 끼운다 · 합계 ${sum + 1}행 아래)`);
    if (!APPLY) continue;
    const cc = p.gridProperties.columnCount;
    /** ★끼우는 자리는 «꼬리 바로 앞»이다 — 빈 줄만 셌으므로 gap 으로는 자리를 못 잡는다. */
    let at = sum + 1;
    for (let i = sum + 1; i < g.length; i++) {
      const txt = (g[i] || []).map(S).filter(Boolean).join(' ');
      if (FOOT.test(txt)) { at = i; break; }
      at = i + 1;
    }
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}:batchUpdate`, 'POST', {
      requests: [
        { insertDimension: { range: { sheetId: p.sheetId, dimension: 'ROWS', startIndex: at, endIndex: at + need }, inheritFromBefore: false } },
        /** ★흐린 회색 · 표와 같은 줄 높이. 기울임은 안 쓴다(사장님 2026-09-08). */
        { repeatCell: { range: { sheetId: p.sheetId, startRowIndex: sum + 1, endRowIndex: sum + 1 + WANT, startColumnIndex: 0, endColumnIndex: cc },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { italic: false, fontSize: 10, foregroundColor: { red: 0.62, green: 0.65, blue: 0.70 } } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
        { updateDimensionProperties: { range: { sheetId: p.sheetId, dimension: 'ROWS', startIndex: sum + 1, endIndex: sum + 1 + WANT }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
        /** ★지난 달 본표였던 자리라 체크박스가 남아 있다 — 걷는다. */
        { setDataValidation: { range: { sheetId: p.sheetId, startRowIndex: sum + 1, endRowIndex: sum + 1 + WANT, startColumnIndex: 0, endColumnIndex: cc } } },
      ],
    });
    /** ★적어 둔 줄이 하나도 없을 때만 안내문을 놓는다 — 있으면 그 줄을 덮으면 안 된다. */
    if (!gap) {
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(`'${p.title}'!A${sum + 2}`)}?valueInputOption=RAW`,
        'PUT', { values: [[HINT]] });
    }
  }
}
console.log(`\n   자리를 낸 탭 ${fixed}개`);
if (!APPLY && fixed) console.log('\n※ dry-run — 아무것도 안 넣었습니다. --apply 로 자리를 냅니다.\n');
else console.log('');
process.exit(0);
