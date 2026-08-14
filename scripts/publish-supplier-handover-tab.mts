/**
 * **공급사 제공시트마다 숨긴 「AI 인계」 탭을 둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「각 시트마다 탭을 숨겨서 거기서 뭔가 코드? 매뉴얼? 소통을 할 수 있게끔」)
 *   시트를 열었을 때 «이 시트가 무엇이고, 누가 어느 칸을 채우고, 마지막으로 언제 돌았는지»를
 *   그 자리에서 알 수 있어야 한다. 지금은 그걸 아는 곳이 사람 기억뿐이다.
 *
 * ★탭 구성
 *   0~3 절  기계가 찍는다 — 규격·누가 채우나·규칙·그 공급사 특이사항
 *   @메모    **사람이 적는 자리.** 다시 돌려도 지우지 않는다
 *   @이력    기계가 한 줄씩 덧붙인다 — 동기·발행이 언제 몇 대로 돌았나
 *
 * ⚠ **@메모와 @이력은 보존한다.** 판매시트 「AI 인계」는 통째로 지우고 다시 쓰는데,
 *   그 탓에 시트에서 손으로 고친 규칙이 명령 한 번에 되돌아간다(실측 2026-08-14).
 *   여기서는 같은 실수를 안 한다 — 쓰기 전에 읽어 두 블록을 되살린다.
 * ⚠ 숨긴 탭이다. 공급사에게 보이라고 만든 게 아니라 **우리와 다음 사람**을 위한 자리다.
 *
 *   npx tsx scripts/publish-supplier-handover-tab.mts
 *   npx tsx scripts/publish-supplier-handover-tab.mts --apply
 *   npx tsx scripts/publish-supplier-handover-tab.mts --apply --sheet=<ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const NAME = arg('name', '프리패스 재고');
const TAB = 'AI 인계';
const MARK = '차명(트림)';

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
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/** 그 공급사만의 이야기. 코드가 모르는 것은 여기 적어 둔다. */
const NOTES: Record<string, string[]> = {
  아이카: ['자체시트를 쓰는 곳이다. 이 시트는 그 원본을 우리 규격으로 옮겨 담은 «규격화시트»다.',
    '원본 1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w · 「월렌트」·「수수료」 탭은 싣지 않는다.',
    '갱신은 sync-mirror-sheet 가 차량번호를 열쇠로 한다. 원본에서 사라진 차는 지우지 않고 상태만 출고불가.'],
  빌린카: ['여백 칸(기타기간①)의 제목을 「6개월」로 바꿔 쓰고 있다. 그 자리 요금은 6개월 요금이다.'],
  제이앤제이렌트카: ['여백 칸(기타기간①)의 제목을 「6개월」로 바꿔 쓰고 있다.'],
  손오공: ['탭이 둘이다 — 「렌트재고」와 「구독재고」. 구독은 인수형·반납형 두 벌이고 반납형이 기본이다.',
    '반납형 보증금은 「연수×대여료」라고 글자로 적는다. 숫자로 계산해 넣지 마라.',
    '인수형은 36개월부터만 판다. 12·24개월이 비어 있는 것이 정상이다.'],
  웰릭스: ['제공시트 양식의 «표본»이다. 양식을 견줄 때 이 시트를 기준으로 삼는다.'],
};

const stamp = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

const targets: string[] = [];
if (ONE) targets.push(ONE);
else {
  const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of (r.files || []) as Rec[]) targets.push(S(f.id));
}
console.log(`■ 제공시트 숨긴 탭 「${TAB}」 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳\n`);

let done = 0;
for (const id of targets) {
  let meta: Rec;
  try { meta = await call(`${SH}/${id}?fields=properties.title,sheets.properties(sheetId,title,hidden)`); }
  catch (e) { console.log(`  ✗ ${id} — 못 읽음 ${(e as Error).message.slice(0, 60)}`); continue; }
  const book = S(meta.properties?.title);
  const who = book.replace(' 프리패스 재고', '');
  const sheets = (meta.sheets || []) as Rec[];

  // 재고 탭들을 훑어 규격을 «재서» 적는다. 손으로 적으면 시트가 바뀌어도 문서가 안 따라간다.
  const specs: string[][] = [];
  for (const s of sheets) {
    if (s.properties.hidden || S(s.properties.title) === TAB) continue;
    const t = S(s.properties.title);
    let v: { values?: string[][] };
    try { v = await call(`${SH}/${id}/values/${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`) as { values?: string[][] }; } catch { continue; }
    const rows = (v.values || []) as string[][];
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm(MARK)));
    if (hi < 0) continue;
    const hdr = rows[hi].map(S).filter(Boolean);
    const pi = rows[hi].map(S).findIndex((h) => norm(h) === '차량번호');
    const cars = rows.slice(hi + 1).filter((r) => S(r[pi])).length;
    const ai = AI_TAIL_COLUMNS.filter((c) => hdr.some((h) => norm(h) === norm(c.name)));
    const filled = ai.length ? ai.filter((c) => {
      const i = rows[hi].map(S).findIndex((h) => norm(h) === norm(c.name));
      return rows.slice(hi + 1).some((r) => S(r[i]));
    }).length : 0;
    specs.push([t, `${hdr.length}열 · ${cars}대`, `정제칸 ${ai.length}개 중 값이 든 칸 ${filled}개`]);
  }
  if (!specs.length) { console.log(`  ⏭ ${book} — 우리 양식이 아니다`); continue; }

  // 이미 있는 탭이면 @메모·@이력을 살려 둔다.
  let keepMemo: string[][] = [];
  let keepLog: string[][] = [];
  const found = sheets.find((s) => S(s.properties.title) === TAB);
  if (found) {
    try {
      const old = await call(`${SH}/${id}/values/${encodeURIComponent(`'${TAB}'!A1:C400`)}`) as { values?: string[][] };
      const rows = (old.values || []) as string[][];
      const grab = (from: string, to: string) => {
        const a = rows.findIndex((r) => S(r[0]) === from);
        if (a < 0) return [] as string[][];
        const out: string[][] = [];
        for (const r of rows.slice(a + 1)) { if (S(r[0]) === to) break; if (r.some((c) => S(c))) out.push([S(r[0]), S(r[1]), S(r[2])]); }
        return out;
      };
      keepMemo = grab('@메모', '@메모끝');
      keepLog = grab('@이력', '@이력끝');
    } catch { /* 처음 만드는 경우 */ }
  }

  const ROWS: string[][] = [
    [`${who} 프리패스 재고 — AI 인계`, '', `찍은 때 ${stamp()}`],
    ['', '', ''],
    ['0. 이 시트는 무엇인가', '쓰는 사람', '공급사가 재고와 요금을 적는다. 프리패스가 차종을 정제해 영업자 시트로 실어 간다.'],
    ['', '정본 매뉴얼', '리포 docs/영업자시트-매뉴얼.md — 규칙·금지목록·사고이력이 전부 거기 있다.'],
    ['', '이 탭', '숨긴 탭이다. 공급사에게 보이라고 만든 게 아니라 우리와 다음 사람을 위한 자리다.'],
    ['', '', ''],
    ['1. 지금 규격', '탭', ''],
    ...specs.map((s) => ['', s[0], `${s[1]} · ${s[2]}`]),
    ['', '', ''],
    ['2. 누가 어느 칸을 채우나', '★공급사', '차 이름은 세 칸만 — 제조사 · 차명(트림) · 옵션. 그 밖에 상태·색·연식·연료·주행·요금·보증금.'],
    ['', '★프리패스', AI_TAIL_COLUMNS.map((c) => c.name).join(' · ')],
    ['', '한 번만', '정제칸은 차량번호마다 한 번만 채운다. 값이 있는 칸은 기계가 다시 안 덮는다.'],
    ['', '고치려면', '그 칸을 비우고 다시 돌리거나 손으로 바로 고친다. 비워 두면 기계가 다시 넣는다.'],
    ['', '', ''],
    ['3. 규칙', '6개월은 없다', '6개월은 운영하지 않는다. 판다면 여백 칸(기타기간)의 «제목»을 바꿔 쓴다.'],
    ['', '여백 칸', '기타기간①②③은 제목을 바꿔 쓰는 칸이다. 「18개월」로 갈아 쓰면 그대로 읽는다. 비우면 무시된다.'],
    ['', '⚠ 여백 칸 보증금', '여백 칸은 장기보증 블록 오른쪽이라 장기보증이 관할한다.'],
    ['', '숨긴 행', '숨긴 행은 «출고불가»로 본다. 파는 차를 숨기지 마라.'],
    ['', '표기가 아닌 값', '「무보증」·「-」는 지우지 마라. 「무보증」은 보증금이 없다는 뜻이고 빈칸(=모름)과 다르다.'],
    ['', '돈', '대여료·보증금은 적힌 글자 그대로 실어 간다. 우리가 계산해 넣지 않는다.'],
    ['', '', ''],
    ...(NOTES[who]?.length
      ? [['4. 이 공급사 특이사항', '', ''] as string[], ...NOTES[who].map((n) => ['', '', n]), ['', '', '']]
      : []),
    ['@메모', '사람이 적는 자리 — 다시 돌려도 안 지운다', '무엇이든 적어 두세요. 다음 사람이 읽습니다.'],
    ...keepMemo,
    ['@메모끝', '', ''],
    ['', '', ''],
    ['@이력', '언제', '무엇'],
    ...keepLog.slice(-40),
    ['@이력끝', '', ''],
  ];

  console.log(`  → ${book} — ${specs.length}탭 · ${ROWS.length}줄${keepMemo.length ? ` · 메모 ${keepMemo.length}줄 보존` : ''}${keepLog.length ? ` · 이력 ${keepLog.length}줄 보존` : ''}`);
  done++;
  if (!APPLY) continue;

  let gid = found?.properties?.sheetId as number | undefined;
  if (gid == null) {
    const made = await call(`${SH}/${id}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, hidden: true } } }] }),
    });
    gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
  }
  await call(`${SH}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      { updateSheetProperties: { properties: { sheetId: gid, hidden: true }, fields: 'hidden' } },
      { updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 210 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 760 }, fields: 'pixelSize' } },
    ] }),
  });
  await call(`${SH}/${id}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: ROWS }),
  });
}
console.log(`\n  ${APPLY ? '반영' : '대상'} ${done}곳`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
