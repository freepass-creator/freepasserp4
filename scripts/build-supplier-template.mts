/**
 * 공급사 **제공시트 표준양식**을 시트에 찍는다. 기본 dry-run, 실제 쓰기는 --apply.
 *
 * 표 정의는 `lib/domain/supplier-template-sheet.ts` 하나만 쓴다.
 *
 * ★안전 계약 — 이 스크립트가 절대 넘으면 안 되는 선
 *   · **운영 공급사 시트에는 쓰지 않는다.** 대상 시트 ID 가 어느 파트너의 `sheet_url` 과
 *     같으면 즉시 중단한다. 공급사 시트는 재고의 «정본»이고 이 스크립트는 표를 갈아엎는다.
 *   · 새 탭을 만들 뿐, 기존 탭은 --gid/--tab 을 명시하지 않는 한 건드리지 않는다.
 *   · RTDB 는 읽기만 한다(파트너 sheet_url 대조용).
 *
 *   npx tsx scripts/build-supplier-template.mts --sheet=<ID>
 *   npx tsx scripts/build-supplier-template.mts --sheet=<ID> --apply
 *   npx tsx scripts/build-supplier-template.mts --sheet=<ID> --tab=표준양식 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  ROW_HEADER, TEMPLATE_COLUMNS, buildNumberFormats, buildTableRequest,
  buildTemplateFormat, buildTemplateValues, yearOptions,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;

/** 시트 URL 에서 스프레드시트 ID 만 뽑는다 — 파트너 시트와 대조하려면 같은 축이어야 한다. */
const sheetIdOf = (url: string) => (/\/d\/([a-zA-Z0-9-_]+)/.exec(url) || [])[1] || '';

async function main() {
  const sheetId = arg('sheet', S(process.env.SUPPLIER_TEMPLATE_SHEET_ID));
  const apply = process.argv.includes('--apply');
  const tabName = arg('tab', '공급사 표준양식');
  if (!sheetId) throw new Error('--sheet=<스프레드시트ID> 가 필요합니다.');

  const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));

  console.log(`\n══ 공급사 제공시트 표준양식 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);

  // ── 안전장치: 대상이 공급사 정본이면 즉시 중단 ──────────────────────────
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const readDb = async (node: string) => {
    const res = await fetch(`${DB_URL}/${node}.json?access_token=${token}`);
    if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
  };
  const [live, over] = await Promise.all([readDb('partners'), readDb('v4/partners')]);
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) {
    partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  }
  const owner = Object.entries(partners).find(([, p]) => sheetIdOf(S(p.sheet_url)) === sheetId);
  if (owner) {
    const [key, p] = owner;
    throw new Error(
      `중단 — 이 시트는 «${S(p.partner_name) || S(p.company_name) || S(p.name) || key}» 의 정본 재고시트입니다.\n` +
      `        표준양식은 별도 시트에 만들어 배포하세요. 정본을 덮으면 원본이 사라집니다.`,
    );
  }
  console.log(`  대상 시트 ${sheetId} — 공급사 정본 아님 ✓ (대조 ${Object.keys(partners).length}곳)`);

  // 드롭다운 선택지는 ERP SSOT 에서 온다 — 제조사는 차종마스터, 나머지는 상수(색상·연료·상태·분류).
  const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
  const masterEntries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
  const makers = [...HANDLED_MAKER_OPTIONS];   // 취급 브랜드만 · 짧은 표기 · 흔한 순서
  const dropdownExtras = { 제조사: makers, 연식: yearOptions(new Date().getFullYear()) };

  const values = buildTemplateValues();
  console.log(`  표: 열 ${TEMPLATE_COLUMNS.length} · 행 ${values.length} (헤더 1줄 — 아래는 바로 상품)`);
  console.log(`  드롭다운: 제조사 ${makers.length}종 · 연식 ${dropdownExtras.연식.length}종 · 상태/분류/연료/외부색상/내부색상`);
  console.log(`  필수 열: ${TEMPLATE_COLUMNS.filter((c) => c.required).map((c) => c.name).join(' · ')}`);
  console.log(`\n  헤더 → ${TEMPLATE_COLUMNS.map((c) => c.name).join(' | ')}`);

  if (!apply) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); return; }

  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: head });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 403) throw new Error(`시트 권한 없음 — ${sa.client_email} 를 편집자로 공유하세요.`);
      throw new Error(`Sheets ${res.status} ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : {};
  };

  const meta = await call(`${api}?fields=${encodeURIComponent('sheets.properties')}`) as
    { sheets: { properties: { title: string; sheetId: number } }[] };
  const existing = (meta.sheets || []).map((s) => s.properties.title);

  const gidArg = arg('gid');
  let gid: number; let title: string;
  if (gidArg) {
    const found = (meta.sheets || []).find((s) => String(s.properties.sheetId) === gidArg);
    if (!found) throw new Error(`gid ${gidArg} 탭이 없습니다.`);
    gid = found.properties.sheetId; title = found.properties.title;
    await call(`${api}/values/${encodeURIComponent(title)}!A:BZ:clear`, { method: 'POST', body: '{}' });
  } else {
    title = tabName;
    for (let i = 2; existing.includes(title); i++) title = `${tabName} (${i})`;
    const out = await call(`${api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 0 } } }] }),
    }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    gid = out.replies[0].addSheet.properties.sheetId;
  }

  await call(`${api}/values/${encodeURIComponent(title)}!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
  await call(`${api}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: buildTemplateFormat(gid, TEMPLATE_COLUMNS, dropdownExtras, { asTable: true }) }),
  });

  // 표(Table)로 만들어야 드롭다운이 칩으로 뜬다. 순서를 지켜야 한다 —
  // 필터가 남아 있으면 변환이 거부되고, 표를 만든 뒤에야 필터·정렬을 걸 수 있다.
  const ROWS = 300;
  await call(`${api}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      { clearBasicFilter: { sheetId: gid } },
      buildTableRequest(gid, TEMPLATE_COLUMNS, dropdownExtras, ROWS),
      { setBasicFilter: { filter: { range: {
        sheetId: gid, startRowIndex: ROW_HEADER, endRowIndex: ROWS,
        startColumnIndex: 0, endColumnIndex: TEMPLATE_COLUMNS.length,
      } } } },
    ] }),
  });
  await call(`${api}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: buildNumberFormats(gid, TEMPLATE_COLUMNS, ROWS) }),
  });
  console.log('  표(Table) 적용 — 칩 + 머리행 필터 + 우측정렬');

  console.log(`\n  탭 「${title}」(gid ${gid}) 생성·반영 완료`);
  console.log(`  https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}\n`);
}

main().catch((e) => { console.error(`\n${String(e?.message || e)}\n`); process.exit(1); });
