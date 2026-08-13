/**
 * 웰릭스 대여료 반영 — 권종원 팀장 수정본(시트1)을 **「재고」 탭**으로 옮긴다.
 * 기본 dry-run, 반영은 --apply.
 *
 * ★왜 옮겨야 하나
 *   팀장은 웰릭스 내부 양식인 「시트1」에서 값을 고쳤는데, 우리가 읽는 것은 「재고」 탭이다.
 *   그대로 두면 인하가 반영되지 않아 영업자는 계속 옛 가격으로 판다(최대 32만원 차이).
 *
 * ★시트1 의 «값»만 가져온다. 표기는 재고 탭 것을 그대로 둔다.
 *   시트1 은 연식이 엑셀 시리얼(45271)로 들어가 있고 차명 표기도 거칠다
 *   (「쏘나타DN8 런칭 자가용 …」). 가격 외에는 손대지 않는다.
 *
 * ★예외 1건 — 271루7538 은 사장님 지시로 570,000.
 *   옵션 5개(BOSE·파노라마썬루프·18인치휠)인데 팀장가 500,000 이면
 *   옵션 1~2개짜리 KH 쏘나타(510,000)보다 싸진다. 옵션값을 못 받는 값이다.
 *
 *   npx tsx scripts/apply-welrix-rent.mts
 *   npx tsx scripts/apply-welrix-rent.mts --apply
 */
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();
const N = (v: any) => { const n = Number(S(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => (n ? n.toLocaleString('ko-KR') : '－');
const SRC = 'tmp/welrix-cmp/welrix-new.xlsx';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * 보정 — 팀장 수정본을 그대로 옮기면 **기간이 길수록 비싸지는 값**이 생긴다.
 * 재고 488대 중 기간 역전은 지금 한 건도 없다. 그 규칙을 깨지 않는다.
 *
 *   271루7538  48개월을 570,000 으로 올리라는 지시(옵션 5개인데 옵션 1~2개짜리보다 쌌다).
 *              그러면 팀장가 36개월 550,000 을 넘어서므로 36개월도 590,000 으로 올린다.
 *   142호1068  팀장 수정본의 24개월 650,000 은 36·48(900,000·820,000)보다 낮다.
 *              24개월만 32만원 급락하고 36·48 은 오히려 오른 형태라 오기로 본다.
 *              24개월은 지금 값(970,000)을 유지한다 — 확인 전까지 손대지 않는 편이 안전하다.
 */
const OVERRIDE: Record<string, Record<string, number>> = {
  '271루7538': { '48': 570000, '36': 590000 },
  '142호1068': { '24': 970000 },
};

async function main() {
  const apply = process.argv.includes('--apply');

  // ── 팀장 수정본(시트1)에서 «값»만 읽는다 ──
  const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' });
  const s1 = wb.Sheets['시트1'];
  const rg = XLSX.utils.decode_range(s1['!ref']!);
  const cl = (r: number, c: number) => s1[XLSX.utils.encode_cell({ r, c })]?.v;
  let hr = -1;
  for (let r = rg.s.r; r <= Math.min(rg.s.r + 6, rg.e.r); r++) {
    for (let c = rg.s.c; c <= rg.e.c; c++) if (S(cl(r, c)) === '차량번호') { hr = r; break; }
    if (hr >= 0) break;
  }
  if (hr < 0) throw new Error('시트1 에서 차량번호 헤더를 찾지 못했다');
  const h1: string[] = []; for (let c = rg.s.c; c <= rg.e.c; c++) h1[c] = S(cl(hr, c));
  const col1 = (n: string) => h1.indexOf(n);
  const iP1 = col1('차량번호');
  const MONTHS = ['24', '36', '48'];
  const want = new Map<string, Record<string, number>>();
  for (let r = hr + 1; r <= rg.e.r; r++) {
    const plate = S(cl(r, iP1)).replace(/\s/g, ''); if (!plate) continue;
    const rec: Record<string, number> = {};
    for (const m of MONTHS) { const i = col1(`${m}개월`); if (i >= 0) { const v = N(cl(r, i)); if (v > 0) rec[m] = v; } }
    if (Object.keys(rec).length) want.set(plate, { ...rec, ...(OVERRIDE[plate] || {}) });
  }

  // ── 우리 운영 시트의 「재고」 탭 ──
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const g = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};
  const [liveP, overP] = await Promise.all([g('partners'), g('v4/partners')]);
  const pm: any = {};
  for (const k of new Set([...Object.keys(liveP), ...Object.keys(overP)])) pm[k] = { ...(liveP[k] || {}), ...(overP[k] || {}), _key: k };
  /**
   * 대상 시트는 **명시로 받는다.** 파트너 `sheet_url` 을 그대로 믿고 썼다가
   * 등록이 낡아 «다른 시트»에 42칸을 쓴 적이 있다(2026-08-12).
   * 쓰기 전에 문서 이름을 찍어 사람이 눈으로 확인할 수 있게 한다.
   */
  const argSheet = (process.argv.find((a) => a.startsWith('--sheet=')) || '').slice(8);
  const partner = Object.values<any>(pm).find((x) => S(x.partner_code) === 'RP013');
  const sheetId = argSheet || S(partner?.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!sheetId) throw new Error('대상 시트를 알 수 없다 — --sheet=<ID> 로 지정한다');
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

  const got = await (await fetch(`${api}/values/${encodeURIComponent("'재고'!A1:AE200")}`, { headers: H })).json() as any;
  const grid = (got.values || []) as string[][];
  if (!grid.length) throw new Error('재고 탭이 비어 있다');
  const head = grid[0].map(S);
  const colOf = (n: string) => head.indexOf(n);
  const iPlate = colOf('차량번호');
  if (iPlate < 0) throw new Error('재고 탭에 차량번호 열이 없다');

  type Edit = { plate: string; a1: string; from: number; to: number; month: string };
  const edits: Edit[] = [];
  const missing: string[] = [];
  for (const [plate, rec] of want) {
    const rowIndex = grid.findIndex((row, i) => i > 0 && S(row[iPlate]).replace(/\s/g, '') === plate);
    if (rowIndex < 0) { missing.push(plate); continue; }
    for (const [m, value] of Object.entries(rec)) {
      const c = colOf(`${m}개월`); if (c < 0) continue;
      const from = N(grid[rowIndex][c]);
      if (from === value) continue;
      edits.push({ plate, a1: `${XLSX.utils.encode_col(c)}${rowIndex + 1}`, from, to: value, month: m });
    }
  }

  console.log(`\n══ 웰릭스 대여료 → 「재고」 탭 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  const docMeta = await (await fetch(`${api}?fields=properties.title`, { headers: H })).json() as any;
  console.log(`  대상 시트 「${docMeta?.properties?.title || '?'}」  ${sheetId}`);
  if (argSheet && partner && !S(partner.sheet_url).includes(argSheet)) {
    console.log('  ⚠ 이 시트는 파트너에 등록된 것과 다르다 — ERP 는 등록된 시트를 읽는다');
  }
  console.log(`  팀장 수정본 ${want.size}대 · 재고 탭 ${grid.length - 1}행 · 고칠 칸 ${edits.length}\n`);
  const byPlate = new Map<string, Edit[]>();
  for (const e of edits) (byPlate.get(e.plate) || byPlate.set(e.plate, []).get(e.plate)!).push(e);
  for (const [plate, list] of byPlate) {
    const mark = OVERRIDE[plate] ? '★' : ' ';
    console.log(`${mark} ${plate.padEnd(11)} ${list.sort((a, b) => Number(a.month) - Number(b.month)).map((e) => `${e.month}개월 ${won(e.from)} → ${won(e.to)}`).join(' · ')}`);
  }
  if (missing.length) console.log(`\n  재고 탭에 없는 차 ${missing.length}대 — ${missing.join(' · ')}`);
  console.log('\n  ★ = 사장님 지시 반영(271루7538 옵션값 보정)');

  if (!apply) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  const data = edits.map((e) => ({ range: `'재고'!${e.a1}`, values: [[e.to]] }));
  const res = await fetch(`${api}/values:batchUpdate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
  if (!res.ok) throw new Error(`쓰기 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  const out = await res.json() as any;
  console.log(`\n  반영 완료 — ${out.totalUpdatedCells ?? edits.length}칸\n`);
  console.log('  다음: 재고관리에서 「검증 → 반영하기」를 눌러 ERP·영업자 시트까지 내린다.\n');
}

main().catch((e) => { console.error('\n실패 —', (e as Error)?.message || e, '\n'); process.exit(1); });
