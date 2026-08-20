/**
 * **자체시트 공급사의 원본 → 우리 규격화시트 갱신.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14)
 *   「아이카 것도 어차피 번호만 같으면 만들어 둘 수 있고, 대여료 변동만 우리 시트에 가져와서
 *    작업을 하면 되니까」 · 「그럼 결국 영업자 시트는 다 동일한 걸 갖고 온다는 거고」
 *
 *   아이카·오플·이안카는 자기 시트를 쓴다. 그쪽에 우리 양식을 강요하지 않는다.
 *   대신 **우리 규격화시트**를 하나 두고, 원본이 바뀌면 차량번호를 열쇠로 갱신한다.
 *   그러면 공급사가 어떻게 적든 영업자·ERP 가 받는 모양은 한 벌이 된다.
 *
 * ★**통째로 덮어쓰지 않는다.**
 *   정제칸 11개와 정책코드는 «우리가 써 넣은 것»이라 매번 덮으면 그 작업이 통째로 날아간다.
 *   그 밖(요금·보증금·상태·주행거리·색·차명…)은 공급사 것이라 늘 원본을 따른다.
 * ★**행을 지우지 않는다.**
 *   원본에서 사라진 차는 상태만 「출고불가」로 바꾸고 줄은 남긴다 —
 *   지우면 그 차에 해 둔 정제 작업이 같이 사라지고, 다시 들어오면 처음부터 해야 한다.
 * ★새 차번은 맨 아래에 더한다. 정제칸은 비어 있고 그게 «해야 할 일»의 목록이 된다.
 *
 * ⚠ 번호판이 없는 신차(선출고)는 열쇠가 없어 못 맞춘다. 그런 줄은 세어서 보여만 준다.
 * ⚠ 원본에서 차명이 바뀌면 정제칸이 낡은 값이 된다 — 바뀐 차를 목록으로 찍는다.
 *
 *   npx tsx scripts/sync-mirror-sheet.mts --from=<원본ID> --to=<우리시트ID> --code=RP0xx
 *   npx tsx scripts/sync-mirror-sheet.mts --from=… --to=… --code=… --apply
 *   npx tsx scripts/sync-mirror-sheet.mts --source=iron --to=<우리시트ID> --code=RP006   # 아이언 = ironrentcar.com
 *   npx tsx scripts/sync-mirror-sheet.mts --from=… --to=… --code=RP023 --refresh-once [--apply]   # 정제시트를 «공급사 원문 그대로 + 모델명만 규격» 규칙으로 다시 세움(2026-08-19)
 *
 * ★2026-08-19 사장님 「공급사가 올린 정보 그대로 쓸 거고 모델명만 제대로 · 제조사·모델명만 검색되면 되고 연료·연식·배기량은 있는 대로」 —
 *   정제시트에 「모델명」 열이 있으면: 차명(세부모델+트림)=원본 모델명(트림풀명) 그대로(합치지 않음) · 모델명=원본 차종에서 제조사 말·연료 꼬리를 뗀 뒤 차종마스터 모델 이름(알면) · 제조사=원본 또는 차종에서 뗀 말.
 *   「모델명」 열이 없는 정제시트(아이카·이안카·아이언)는 예전 그대로(차종+차명 합침) — 열을 넣으면 같은 규칙이 켜진다.
 *
 * ★2026-08-18 — **열 이름이 달라도 옮긴다**(`mirror-sheet-mapping.projectSourceRow`).
 *   아이카 「배차상태·트림·외장·Km·소비자가격」, 오토플러스 「차종+모델명·판매상태」, 이안카 「차종분류+세부모델+트림」이
 *   우리 규격 「상태·차명(세부모델+트림)·외부색상·주행거리·차량가격」으로 온다. 상태·분류·연료만 규격값(ERP 와 같은 판정), 나머지는 원문.
 *   별칭에 없는 열은 같은 이름일 때만 옮겨진다 — 오토플러스 「12개월2만·18개월3만」은 정제시트 머리행에 같은 이름을 둔다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { AI_TAIL_COLUMNS, columnOwner, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { projectSourceRow, splitMakerModel, unmappedSourceColumns } from '../lib/domain/mirror-sheet-mapping';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { HANDOVER_TAB, findLogEnd, nowKST } from '../lib/domain/supplier-handover-log';
import { countPlatesByUrl, driveIdOf, isPhotoUrl, judgePhotoLink } from '../lib/domain/photo-link-guard';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const FROM = arg('from');
const TO = arg('to');
const CODE = arg('code', 'RP000');
/** 원본이 시트가 아닌 공급사 — `iron`(ironrentcar.com 홈페이지 수집). */
const SOURCE = arg('source', 'sheet');
/**
 * ★--refresh-once — «한 번만 옮기는 칸»(차명 원문·옵션·색·연식·주행거리·연료·배기량·최초등록일·차량가격)을 이번 한 번 원본으로 다시 맞춘다.
 *   사장님 2026-08-19 「공급사가 올린 정보 그대로 쓸 거고 모델명만 제대로」 — 정제시트를 그 규칙으로 다시 세울 때 쓴다. 평소엔 안 준다(우리 기록 보호).
 *   정제칸(ours)·정책코드는 이 플래그로도 안 건드린다.
 */
const REFRESH_ONCE = process.argv.includes('--refresh-once');
/** 차종마스터(모델 이름 규격) — 정제시트 「모델명」을 마스터 모델 이름으로 맞출 때만 쓴다(확신 high·medium). */
const MASTER_ENTRIES = ((): MasterEntry[] => { try { const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')); return (Array.isArray(raw) ? raw : raw.entries) || []; } catch { return []; } })();
/**
 * ★「모델명」 = 검색되는 모델 이름(사장님 2026-08-19 「제조사·모델명만 검색되면 되고 · 차명은 공급사가 올려준 것 그대로」).
 *   원본 차종에서 제조사 말·연료 꼬리를 뗀 뒤(splitMakerModel), 차종마스터가 그 이름을 알아보면 마스터 모델 이름으로(「120i」→「1시리즈」·「C클래스」→「C-클래스」), 모르면 뗀 글자 그대로.
 */
const modelNameOf = (m: Map<string, string>): { maker: string; model: string } => {
  const rawModel = S(m.get('모델명')); const rawName = S(m.get('차명원문')) || S(m.get('차명(세부모델+트림)'));
  const sp = splitMakerModel(rawModel || rawName);
  let maker = canonMakerDisplay(S(m.get('제조사')) || sp.maker); let model = sp.model;
  // 수입차 숫자 표기 → 차종마스터 모델 이름(최소 규칙): BMW 120i/220i/320d/520i/730d → 1·2·3·5·7시리즈 · 벤츠 C220/E300/S350 → C-/E-/S-클래스 · 「C클래스」→「C-클래스」
  if (maker === 'BMW') { const b = /^([1-8])\d{2}[a-z]{0,2}$/i.exec(model); if (b) model = `${b[1]}시리즈`; }
  if (maker === '벤츠') { const c = /^([ABCES])\s?\d{3}/i.exec(model); if (c) model = `${c[1].toUpperCase()}-클래스`; const k = /^([ABCES])[\s-]?클래스$/i.exec(model); if (k) model = `${k[1].toUpperCase()}-클래스`; }
  if (MASTER_ENTRIES.length && (model || rawName)) {
    const snap = snapToMaster({ maker, model, sub_model: rawName, fuel_type: S(m.get('연료')) } as EntityRecord, MASTER_ENTRIES);
    if (snap && (snap.confidence === 'high' || snap.confidence === 'medium') && S(snap.model)) { model = S(snap.model); if (!maker && S(snap.maker)) maker = canonMakerDisplay(snap.maker); }
  }
  return { maker, model };
};
/** 원본에 없어 늘 비는 칸의 기본값(mirror-sources.defaults) — once 칸이 비어 있을 때만 넣는다. */
const DEFAULTS: Record<string, string> = (MIRROR_SOURCES.find((m) => m.code === CODE)?.defaults) || {};
if (!TO || (SOURCE === 'sheet' && !FROM)) throw new Error('--from=<원본ID> --to=<우리시트ID> (또는 --source=iron --to=…) 가 필요하다');

/**
 * ★★**칸마다 누가 정본인지는 `columnOwner` 하나가 정한다**(사장님 2026-08-15 —
 *   「공급사시트에서는 배차상태만 확인해서 우리시트와 차량상태를 확인한다 /
 *    대여료 변동이 있다면 그 변동에 따라 변경한다」).
 *
 *   · live — 매번 공급사를 따라간다(상태·기간 대여료·보증금)
 *   · ours — 우리가 정한다(정제칸·정책코드). 공급사가 못 덮는다
 *   · once — **처음 한 번만** 옮겨 온다. 그 뒤로는 우리 것이다(차명 원문·색·연식·옵션·차량가격…)
 *
 * ⚠ 예전엔 «우리 칸만 지키고 나머지 전부를 매번 덮었다.» 그래서 한 번 정리해 둔
 *   차명·색·연식이 다음 동기화에 원문으로 되돌아갔다. 그게 「우리만의 시트로 변환한다」와 어긋난다.
 */
const OURS = new Set<string>([...AI_TAIL_COLUMNS.map((c) => c.name), '정책코드'].map(norm));
/** 「처음 한 번」 칸이라 원문으로 안 되돌린 칸 수 — 우리 기록이 지켜진 자리다. */
let onceKept = 0;

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
/** 숫자로 같은가 — 콤마·공백을 떼고 견준다. 둘 다 숫자일 때만 «같다»로 본다. */
const sameNumber = (a: string, b: string) => {
  const n = (v: string) => (/^[\d,\s]+$/.test(v) && /\d/.test(v) ? v.replace(/[,\s]/g, '') : null);
  const x = n(a);
  const y = n(b);
  return x !== null && y !== null && x === y;
};
const colA1 = (i: number) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

console.log(`■ 규격화시트 갱신 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);

// ── ① 원본을 읽는다. 시트면 숨긴 행·숨긴 탭·어댑터는 readSupplierSheet 가 가려 준다.
/** 원본 차번 → (우리 규격 열이름(공백 없이) → 값). 같은 차가 여러 탭에 있으면 먼저 나온 쪽. */
const src = new Map<string, Map<string, string>>();
/** 우리 규격 어디로도 못 옮긴 원본 열 — 버린 것을 보여 준다(정책 성격이면 정책 탭으로 갈 것). */
const dropped = new Map<string, number>();
if (SOURCE === 'iron') {
  const { rowsFromIronCatalog } = await import('../lib/domain/mirror-iron-source');
  const got = await rowsFromIronCatalog();
  for (const [plate, m] of got.rows) if (!src.has(plate)) src.set(plate, m);
  console.log(`  원본 ironrentcar.com — 목록 ${got.listings} · 활성 ${got.active} · 판매완료 ${got.sold} · 상세 실패 ${got.errors}${got.oddPeriods.length ? ` · 표준 밖 기간 ${got.oddPeriods.join(' · ')}` : ''}`);
  if (!got.complete) throw new Error('홈페이지 상세를 하나라도 못 읽었다 — 전체 반영 중단(공급사 데이터 매뉴얼 규칙)');
} else {
  const grid = await call(`${SH}/${FROM}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
  const read = readSupplierSheet(grid as never, { partner_code: CODE } as EntityRecord);
  for (const t of read.tabs) {
    const hdr = (t.table[0] || []).map(S);
    const pi = hdr.findIndex((h) => /^차량번호$|^차번$/.test(norm(h)));
    if (pi < 0) continue;
    for (const r of t.table.slice(1)) {
      const plate = norm(r[pi]);
      if (!plate || src.has(plate)) continue;
      const raw = new Map<string, string>();
      hdr.forEach((h, i) => { if (S(h)) raw.set(norm(h), S(r[i])); });
      const m = projectSourceRow(raw);
      // 차량번호 칸의 링크(사진)는 readSupplierSheet 가 뽑아 준다.
      const photo = S((t as Rec).photoByPlate?.[plate] || (t as Rec).photoByPlate?.[S(r[pi])]);
      if (photo && !m.get('사진링크')) m.set('사진링크', photo);
      src.set(plate, m);
    }
  }
  console.log(`  원본 ${read.tabs.length}탭 · 차 ${src.size}대${read.failures.length ? ` · 못 읽은 탭 ${read.failures.length}` : ''}`);
  // 버려지는 원본 열 — 우리 시트 머리행을 아직 안 읽었으니 아래 ②에서 다시 센다.
  for (const t of read.tabs) for (const h of (t.table[0] || []).map(S)) if (h) dropped.set(h, (dropped.get(h) || 0) + 1);
}

/**
 * ── ①′ **사진링크 문지기 — 그 차 사진이 아니면 원본에서 가져오지 않는다**
 *   (사장님 2026-08-20 「없으면 매칭을 안 해야 한다」).
 *   ⚠ 여기가 빠지면 떼어도 소용이 없다 — 실측 2026-08-20: 아이카에서 뗀 남의 차 링크가
 *     한 시간 뒤 원본에서 그대로 다시 들어왔다. 미러 공급사는 이 칸이 매시간 원본을 따라간다.
 *   판정은 `publish-plate-links`·`unlink-wrong-photo-links` 와 **같은 규칙**을 쓴다
 *   (lib/domain/photo-link-guard). 규칙이 갈리면 한쪽이 떼고 다른 쪽이 다시 건다.
 */
{
  const shared = countPlatesByUrl([...src].map(([plate, m]) => ({ plate, urls: [m.get('사진링크')] })));
  const asked = new Map<string, { name: string; ok: boolean }>();
  const notFit: string[] = [];
  for (const [plate, m] of src) {
    const url = S(m.get('사진링크'));
    if (!isPhotoUrl(url)) continue;
    const id = driveIdOf(url);
    if (id && !asked.has(id)) {
      try {
        const f = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,trashed&includeItemsFromAllDrives=true&supportsAllDrives=true`);
        asked.set(id, { name: S(f.name), ok: f.trashed !== true });
      } catch { asked.set(id, { name: '', ok: false }); }
    }
    const verdict = judgePhotoLink(plate, url, id ? asked.get(id)! : { name: '', ok: true }, shared.get(url) || 1);
    if (verdict.fit) continue;
    m.delete('사진링크');   // 우리 시트의 기존 값은 그대로 둔다 — 원본 값을 «안 가져올» 뿐이다
    notFit.push(`${plate} ${verdict.why}`);
  }
  if (notFit.length) console.log(`  사진링크 안 가져옴 ${notFit.length} — ${notFit.slice(0, 5).join(' · ')}${notFit.length > 5 ? ' …' : ''}`);
}

// ── ② 우리 시트를 읽는다. **탭이 여럿일 수 있다**(손오공 = 렌트재고 + 구독재고).
const meta = await call(`${SH}/${TO}?fields=properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
const book = S(meta.properties?.title);
const visible = ((meta.sheets || []) as Rec[]).map((s) => s.properties)
  .filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));

type Tab = { title: string; rows: string[][]; hi: number; hdr: string[]; pi: number; si: number; ti: number; mi: number };
const tabs: Tab[] = [];
for (const p of visible) {
  const title = S(p.title);
  let v: { values?: string[][] };
  try { v = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] }; } catch { continue; }
  const rows = (v.values || []) as string[][];
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm('차명(세부모델+트림)')));
  if (hi < 0) continue;
  const hdr = rows[hi].map(S);
  const pi = hdr.findIndex((h) => norm(h) === '차량번호');
  /**
   * ⚠ **차량번호 열이 없으면 멈춘다.** 없으면 «기존 줄이 하나도 없다»로 읽혀 원본 전량이
   *   «새 차»가 되고 머리행 바로 아래부터 통째로 덮어쓴다 — 122줄이 한 번에 갈린다.
   */
  if (pi < 0) throw new Error(`「${title}」 에 차량번호 열이 없다 — 덮어쓰면 기존 줄이 통째로 갈린다`);
  tabs.push({ title, rows, hdr, hi, pi, si: hdr.findIndex((h) => norm(h) === '상태'), ti: hdr.findIndex((h) => norm(h) === norm('차명(세부모델+트림)')), mi: hdr.findIndex((h) => norm(h) === '모델명') });
}
if (!tabs.length) throw new Error('우리 시트에서 재고 탭을 못 찾았다');
console.log(`  우리 시트 「${book}」 ${tabs.map((t) => `「${t.title}」 ${t.rows.length - t.hi - 1}줄`).join(' · ')}
`);
if (dropped.size) {
  const lost = unmappedSourceColumns([...dropped.keys()], tabs.flatMap((t) => t.hdr));
  if (lost.length) console.log(`  ▲ 우리 규격에 자리가 없어 안 옮기는 원본 열 ${lost.length}: ${lost.join(' · ').slice(0, 300)}
     (조건·계좌 같은 정책 성격은 「정책」 탭에 적는다 — 줄마다 옮기지 않는다)
`);
}

// ── ③ 줄마다 «공급사 것»만 갱신한다. 차번은 시트 전체에서 하나뿐이라고 본다.
const data: { range: string; values: string[][] }[] = [];
let touched = 0, cells = 0, gone = 0, renamed = 0;
const renamedList: string[] = [];
/** 열마다 무엇이 무엇으로 바뀌는지 — «늘 갱신되는 열»을 잡아내는 눈이다. */
const byCol = new Map<string, string[]>();
/** 값이 아니라 «잡음»이라 안 옮긴 것 — 무엇을 걸렀는지 보여 준다. */
const junk: string[] = [];
const seen = new Set<string>();
for (const t of tabs) {
  t.rows.slice(t.hi + 1).forEach((r, k) => {
    const plate = norm(r[t.pi]);
    if (!plate) return;
    const rowAt = t.hi + 2 + k;
    const from = src.get(plate);
    if (!from) {
      // 원본에서 사라진 차 — 줄은 남기고 상태만 내린다.
      if (t.si >= 0 && S(r[t.si]) !== '출고불가') { gone++; data.push({ range: `'${t.title}'!${colA1(t.si)}${rowAt}`, values: [['출고불가']] }); }
      return;
    }
    seen.add(plate);
    let hit = false;
    // ★「모델명」 열이 있는 정제시트 — 차명(세부모델+트림)=공급사 원문 그대로(합치지 않음), 모델명=검색되는 모델 이름, 제조사=원본 또는 차종에서 뗀 말.
    if (t.mi >= 0) {
      const mm = modelNameOf(from);
      if (from.get('차명원문')) from.set(norm('차명(세부모델+트림)'), from.get('차명원문')!);
      if (mm.model) from.set('모델명', mm.model);
      if (mm.maker && !S(from.get('제조사'))) from.set('제조사', mm.maker);
    }
    // 원본에 없는 칸 — 기본값(mirror-sources.defaults) · 제조사가 비면 정제칸 「제조사(정제)」를 앞칸에도 둔다(오토플러스는 원본에 제조사·구분이 없다).
    const makerAi = t.hdr.findIndex((h) => norm(h) === '제조사(정제)');
    // ★앞칸이 비고 정제칸이 있으면 정제칸 값을 앞칸에도 둔다(사장님 2026-08-18 「빈 칸 다 보라고」) — 제조사·배기량·연료.
    const aiOf = (n: string) => { const j = t.hdr.findIndex((h) => norm(h) === n); return j >= 0 ? S(r[j]) : ''; };
    const FROM_AI: Record<string, string> = { 제조사: makerAi >= 0 ? S(r[makerAi]) : '', 배기량: aiOf('배기량(정제)'), 연료: aiOf('연료(정제)') };
    t.hdr.forEach((name, i) => {
      if (!S(name) || S(r[i])) return;
      const dv = DEFAULTS[S(name)] || FROM_AI[norm(name)] || '';
      if (!dv || from.get(norm(name))) return;
      data.push({ range: `'${t.title}'!${colA1(i)}${rowAt}`, values: [[dv]] }); cells++; hit = true;
      if (!byCol.has(name)) byCol.set(name, []);
      byCol.get(name)!.push(`「(빈칸)」→「${dv}」(기본값)`);
    });
    t.hdr.forEach((name, i) => {
      if (!S(name)) return;
      const owner = columnOwner(name);
      if (owner === 'ours') return;                          // 우리 칸은 안 건드린다
      const now = S(r[i]);
      const next = from.get(norm(name));
      if (next === undefined || next === now) return;
      if (!next && now) return;                              // 원본이 비었다고 우리 값을 지우지 않는다
      /**
       * ★**한 번만 옮기는 칸은 «비어 있을 때만» 채운다.**
       *   차명 원문·색·연식·옵션은 우리 시트로 옮겨 오면 그 뒤로 우리 기록이다.
       *   매번 원문으로 되돌리면 정리한 값이 사라지고, 사람이 고쳐도 다음날 없어진다.
       */
      // ★배기량은 «원본이 값을 줄 때만» 덮는다 — 옛 값이 마스터 스냅에서 온 틀린 값일 수 있다(아이언 G80 2.5T 인데 3,300).
      if (owner === 'once' && now && !REFRESH_ONCE && norm(name) !== '배기량') { onceKept++; return; }
      if (owner === 'once' && now && !REFRESH_ONCE && norm(name) === '배기량' && !next) { onceKept++; return; }
      // ★사진링크가 이미 우리 드라이브(drive.google.com)면 원본의 외부 주소로 되돌리지 않는다(사장님 2026-08-19 「구글드라이브가 아닌 건 우리 거로 받아와서 링크」).
      if (norm(name) === '사진링크' && /drive\.google\.com/.test(now)) { onceKept++; return; }
      /**
       * ⚠ **숫자로 같으면 안 건드린다.** 「93,000」과 「93000」은 같은 값이다.
       *   표기만 되돌리면 그 칸이 매번 «갱신 대상»으로 떠서, 진짜 바뀐 값이 그 속에 묻힌다.
       *   실측 2026-08-14 손오공 주행거리 한 칸이 그랬다.
       */
      if (sameNumber(now, next)) return;
      /**
       * ⚠ **날짜 칸에 날짜 아닌 값을 넣지 않는다.**
       *   이안카 원본은 「입고일자」 칸에 상태(「재고확인」)를 복사해 뒀다(실측 2026-08-14 · 77대).
       *   그대로 옮기면 재고일수 계산이 통째로 깨진다 — 그 칸으로 «며칠째 안 나가는지»를 센다.
       * ⚠ 「배기량 0」도 안 받는다. 전기차라 배기량이 없는 것이지 0cc 인 차는 없다.
       */
      if (/입고일자|최초등록/.test(name) && next && !/\d/.test(next)) { junk.push(`${name}「${next}」`); return; }
      if (/배기량/.test(name) && /^0+$/.test(next)) { junk.push(`${name}「0」`); return; }
      /**
       * ⚠ **돈 칸에 문장을 넣지 않는다.** 우리캐피탈 구버전은 「1개월」 칸에 「(공동임차인 등재 또는 소득증빙조건 : 보증금 130만원)」을 적었다 —
       *   사장님 지시로 그 글은 장기보증 메모로 옮겼다(2026-08-18). 미러가 다시 돈 칸에 되돌리면 그 작업이 날아간다. 「무보증」 같은 짧은 말은 둔다.
       */
      if (columnOwner(name) === 'live' && /개월|보증/.test(name) && next.length > 12 && !/^[\d,.\s원~-]+$/.test(next)) { junk.push(`${name}「문장」`); return; }
      data.push({ range: `'${t.title}'!${colA1(i)}${rowAt}`, values: [[next]] });
      cells++; hit = true;
      if (!byCol.has(name)) byCol.set(name, []);
      byCol.get(name)!.push(`「${now || '(빈칸)'}」→「${next}」`);
      if (i === t.ti) { renamed++; renamedList.push(`${S(r[t.pi])} 「${now}」 → 「${next}」`); }
    });
    if (hit) touched++;
  });
}

/**
 * ── ④ 원본에만 있는 새 차.
 * ★탭이 **하나면** 맨 아래에 더한다.
 * ⚠ 탭이 **여럿이면 더하지 않는다.** 어느 탭에 넣을지는 짐작할 일이 아니다 —
 *   손오공은 렌트인지 구독인지에 따라 탭이 갈리고, 잘못 넣으면 요금 규격이 다른 표에 선다.
 *   목록으로 보여 주고 사람이 넣게 한다.
 */
const fresh = [...src.keys()].filter((p) => !seen.has(p));
const one = tabs.length === 1 ? tabs[0] : null;
const newRows: string[][] = one
  ? fresh.map((plate) => {
    const from = src.get(plate)!;
    if (one.mi >= 0) { const mm = modelNameOf(from); if (from.get('차명원문')) from.set(norm('차명(세부모델+트림)'), from.get('차명원문')!); if (mm.model) from.set('모델명', mm.model); if (mm.maker && !S(from.get('제조사'))) from.set('제조사', mm.maker); }
    // 새 차는 통째로 옮겨 온다 — 「처음 한 번」이 바로 이 자리다. 우리 칸은 기본값(정책코드 등)만.
    // ★입고일자가 원본에 없으면 «우리 시트에 처음 선 날»(오늘 KST) — 재고일수의 기준이 그 뜻이다(사장님 2026-08-18 「빈 칸 다 보라고」).
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return one.hdr.map((name) => (columnOwner(name) === 'ours' ? (DEFAULTS[S(name)] || '') : (S(from.get(norm(name))) || DEFAULTS[S(name)] || (norm(name) === '입고일자' ? today : ''))));
  })
  : [];

console.log(`  갱신할 차 ${touched}대 · 칸 ${cells}${onceKept ? ` · 우리 기록이라 안 되돌린 칸 ${onceKept}` : ''}`);
if (byCol.size) {
  console.log('');
  console.log('어느 열이 갱신되나 — 여기서 «늘 갱신되는 열»이 보이면 우리 정규화를 되돌리는 중이다');
  for (const [name, list] of [...byCol].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${name.padEnd(12)} ${String(list.length).padStart(3)}칸  ${list.slice(0, 2).join(' · ').slice(0, 90)}`);
  }
}
console.log(`  새 차 ${fresh.length}대 · 원본에서 사라진 차 ${gone}대(상태만 출고불가)`);
if (junk.length) {
  const tally = new Map<string, number>();
  for (const j of junk) tally.set(j, (tally.get(j) || 0) + 1);
  console.log('');
  console.log(`  ▲ 값이 아니라 «잡음»이라 안 옮긴 칸 ${junk.length}`);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${k} × ${n}`);
  console.log('     공급사 원본이 그 칸을 다른 뜻으로 쓰고 있다 — 공급사에 물어볼 일이다.');
}
if (fresh.length && !one) {
  console.log('');
  console.log(`  ▲ 탭이 ${tabs.length}개라 새 차는 «자동으로 안 넣는다» — 어느 탭인지는 짐작할 일이 아니다`);
  console.log(`     ${fresh.slice(0, 20).map((p) => S(src.get(p)!.get('차량번호')) || p).join(' · ')}${fresh.length > 20 ? ` … 모두 ${fresh.length}` : ''}`);
  console.log(`     탭: ${tabs.map((t) => t.title).join(' · ')} — 손으로 넣고 다시 돌리면 그때부터 갱신된다`);
}
if (renamed) {
  console.log(``);
  console.log(`⚠ 차명이 바뀐 차 ${renamed} — 정제칸이 낡았을 수 있다`);
  for (const x of renamedList.slice(0, 10)) console.log(`     ${x}`);
}
if (!APPLY) {
  console.log('');
  console.log('※ dry-run. 실제 반영은 --apply');
  process.exit(0);
}

for (let i = 0; i < data.length; i += 500) {
  await call(`${SH}/${TO}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 500) }),
  });
}
if (newRows.length && one) {
  /**
   * ★붙일 자리는 «값이 있는 마지막 줄» 다음이다.
   * ⚠ 예전엔 «차번이 있는 줄 수»로 셌다. 사람이 중간에 빈 줄이나 구분줄을 하나만 넣어도
   *   그만큼 위에서부터 덮어써 기존 줄이 갈렸다. 줄 수가 아니라 «마지막 자리»로 센다.
   */
  let last = one.hi;
  one.rows.forEach((r, i) => { if (i > one.hi && r.some((c) => S(c))) last = i; });
  const at = last + 1;
  // ⚠ 쓰기 직전에 그 자리가 정말 비었는지 되읽는다. 안 비었으면 멈춘다.
  const guard = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${one.title}'!A${at + 1}:A${at + newRows.length}`)}`) as { values?: string[][] };
  const busy = ((guard.values || []) as string[][]).filter((r) => S(r[0])).length;
  if (busy) throw new Error(`새 차를 붙일 자리(${at + 1}행부터 ${newRows.length}줄)에 이미 ${busy}줄이 있다 — 덮어쓰지 않는다`);
  await call(`${SH}/${TO}/values/${encodeURIComponent(`'${one.title}'!A${at + 1}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: newRows }),
  });
}
/**
 * ★숨긴 탭 「AI 인계」의 @이력에 한 줄 남긴다.
 *   동기화가 멈춘 채 영업자가 옛 값을 보는 것이 이 구조의 유일한 «조용한» 실패다.
 *   기록이 있어야 발행기가 「며칠째 안 돌았다」를 알린다.
 */
try {
  const logRange = `'${HANDOVER_TAB}'!A1:C400`;
  const cur = await call(`${SH}/${TO}/values/${encodeURIComponent(logRange)}`) as { values?: string[][] };
  const lines = (cur.values || []) as string[][];
  const endAt = findLogEnd(lines);
  if (endAt < 0) {
    console.log(`  ⚠ 「${HANDOVER_TAB}」에 @이력 자리가 없다 — publish-supplier-handover-tab 을 먼저 돌려라`);
  } else {
    await call(`${SH}/${TO}/values/${encodeURIComponent(`'${HANDOVER_TAB}'!A${endAt + 1}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [
        ['', nowKST(), `동기 — 원본 ${src.size}대 · 갱신 ${cells}칸 · 새 차 ${newRows.length}${fresh.length && !one ? `(수동 ${fresh.length})` : ''} · 사라진 차 ${gone}`],
        ['@이력끝', '', ''],
      ] }),
    });
  }
} catch (e) { console.log(`  ⚠ 이력을 못 남겼다 — ${(e as Error).message.slice(0, 80)}`); }
console.log(``);
console.log(`반영 완료 — 갱신 ${cells}칸 · 새 줄 ${newRows.length}
`);
