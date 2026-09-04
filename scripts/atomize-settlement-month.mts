/**
 * **그 달 정산을 원자로 부어 파이어베이스에 올린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01 「이제 합치고 원자화 해놔 8월 정산건부터」 「파이어베이스 올려서 작업하자」
 * 설계 = `docs/PLAN-정산-원자화-2026-09-01.md`
 *
 * ★★**정본은 원본 시트다** — 「프리패스모빌리티계약현황」 의 월별 탭.
 *   신규 정산원장·ERP 는 아직 그것을 따라가는 쪽이다(실측 2026-09-01).
 *
 * ★★**수식X 가 이긴다 — 이름으로 못 박는다.**
 *   원본은 금액 칸이 둘씩이다. `Y 판매 수수료`(요율 계산) / `Z 판매 수수료 (수식X)`(사람이 적은 실제),
 *   `AL 출고수수료`(계산) / `AM 출고 수수료 (수식X)`(실제).
 *   ⚠ 지금 원장에는 **지급이 계산값으로** 들어가 있다 — 실측 `161하1197` 원장 2,364,000 · 원본 실제 1,700,000.
 *   ⇒ 여기서는 «자리 순서»에 기대지 않고 이름을 찍어 고른다. 순서에 기대면 탭마다 열이 흔들려 또 틀린다.
 *
 * ★**시트 필터를 지킨다** — `basicFilter.criteria[].hiddenValues` 로 숨긴 줄은 사람이 「이 달 아님」이라
 *   한 것이다. 합계(`SUBTOTAL`)도 그 줄을 안 센다. 값만 더하면 사람 숫자와 안 맞는다.
 *
 * ★**환수는 따로 담는다** — `v4/settlement_clawbacks`, 차량번호가 열쇠(사장님 2026-09-01).
 *
 *   npx tsx scripts/atomize-settlement-month.mts 2026-08
 *   npx tsx scripts/atomize-settlement-month.mts 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
/**
 * ★**달을 인자로 받는다**(사장님 2026-09-01 「8월게 아니라 이제 매달 쓸거야」).
 *   탭 이름이 «들쭉날쭉»하다 — (붙임) 과 (띄움) 이 섞여 있다.
 *   ⇒ 이름을 짓지 말고 «찾는다». 못 찾으면 멈춘다 — 엉뚱한 탭을 부으면 그 달이 통째로 틀어진다.
 */
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) {
  console.log('\n  달을 적어 주세요 — npx tsx scripts/atomize-settlement-month.mts 2026-08 [--apply]\n');
  process.exit(1);
}
let TAB = '';
const ROWS_NODE = 'v4/settlement_rows';
const CLAW_NODE = 'v4/settlement_clawbacks';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const flat = (s: string) => s.replace(/[\s\n()]/g, '');
const SERIAL0 = Date.UTC(1899, 11, 30);
const ymd = (v: unknown): string => {
  const n = Number(S(v));
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) {
    const m = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/.exec(S(v));
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`;
};

/**
 * **메모 → 원자 축.** 「계약번호」 칸에 적혀 있던 말을 기계가 읽는 칸으로 옮긴다.
 * ★확인된 것만 여기 담는다 — 원장 전체 44종류는 사람이 갈라 준 뒤에 넣는다.
 */
const AXIS: Record<string, Partial<Atom>> = {
  '영업사만 정산해야함': { settleTarget: '영업' },
  '프리패스지급 (공급사미청구)': { settleTarget: '영업' },
  '업무지원비': { settleTarget: '영업' },
  '공급사만 정산': { settleTarget: '공급' },
  '공급사정산 완료': { settleTarget: '영업', settledAlready: true },
  '0.5': { settleRatio: 0.5 },
  /**
   * ⚠ **「후불」은 «청구보류»가 아니다.** 2026-09-01 에 그렇게 읽어 퍼시픽 49호3059 를
   *   8월 청구에서 0 원으로 뺐는데, 태윤 매니저가 「퍼시픽 청구건 0원으로 되어있습니다 · 1,435,200원입니다」로
   *   바로잡았다. 후불은 «고객이» 뒤에 내는 조건이지 «우리 청구»를 미루는 말이 아니다.
   *   ⇒ 축으로 옮기지 않고 메모로만 남긴다.
   */
  '후불': { settleNote: '후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '무보증 후불': { settleNote: '무보증 후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '렌탈료 후불': { settleNote: '렌탈료 후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '부가세 포함': { vatIncluded: true },
  '한번에 정산': { settleNote: '한번에 정산 — 적힌 금액(수식X)이 이미 그 뜻이다' },
};

type Atom = {
  code: string; plate: string; model: string; customer: string; phone: string; age: string;
  supplier: string; channel: string; agent: string;
  product: string; rentKind: string; contractType: string; term: number;
  rent: number; deposit: number; price: number; payKind: string;
  supplierRate: number; agentRate: number;
  claimWritten: number; payWritten: number;
  receivedAt: string; deliveredAt: string; delivered: boolean; paper: boolean; cancelled: boolean;
  /** ── 정산 조건 (2026-09-01 신설) ── */
  settleTarget: '양쪽' | '공급사만' | '영업사만';
  settleRatio: number; billHold: boolean; settleExclude: boolean; settledAlready: boolean;
  vatIncluded: boolean; settleTerms: string; settleNote: string;
  billed: boolean; collected: boolean;
  note: string; sourceRow: number; sourceTab: string; billMonth: string;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

/**
 * ★**탭을 «찾는다».** 이름이 들쭉날쭉해서 지으면 안 된다 —
 *   실측: `프리패스25/8`(붙임) · `프리패스 26/8`(띄움) · `카렌 24년 1월` 이 한 파일에 섞여 있다.
 *   ⇒ 「연/월」 숫자로 찾고, 못 찾거나 둘 이상이면 멈춘다.
 */
{
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { sheets?: { properties: { title: string } }[] };
  const [yy, mm] = MONTH.split('-');
  const short = yy.slice(2);
  const hit = (meta.sheets || []).map((s) => s.properties.title)
    .filter((n) => new RegExp(`^프리패스\\s*${short}\\s*/\\s*${Number(mm)}$`).test(n.replace(/\s+/g, ' ').trim()));
  if (hit.length !== 1) {
    console.log(`   ✕ 「${MONTH}」 탭을 못 찾았다 (찾은 것 ${hit.length}개: ${hit.join(' · ') || '없음'}) — 멈춘다`);
    console.log('     엉뚱한 탭을 부으면 그 달이 통째로 틀어진다. 탭 이름을 확인해 주세요.');
    process.exit(1);
  }
  TAB = hit[0];
}
console.log(`■ ${MONTH} 원자화 — 원본 「${TAB}」 → 파이어베이스 ${APPLY ? '(반영)' : '(대조만)'}\n`);

// ── 시트 읽기 (값 + 필터) ─────────────────────────────────
const vr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`'${TAB}'!A1:BZ120`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${await tok()}` } });
if (!vr.ok) { console.log(`   ✕ 시트를 못 읽었다 ${vr.status}`); process.exit(1); }
const all = (((await vr.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
/**
 * ⚠ **필터는 «그 탭»의 것을 읽어야 한다.** `ranges=` 를 줘도 응답의 `sheets[0]` 이 그 탭이라는 보장이 없다 —
 *   2026-09-01 에 첫 탭의 필터를 읽고 「숨기는 값 없음」이라고 잘못 말했다. 제목으로 찍어 고른다.
 */
const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=${encodeURIComponent('sheets(properties.title,basicFilter)')}`, { headers: { Authorization: `Bearer ${await tok()}` } });
const sheetsMeta = ((await fr.json()) as { sheets?: { properties?: { title?: string }; basicFilter?: { criteria?: Record<string, { hiddenValues?: string[] }> } }[] }).sheets || [];
const filt = sheetsMeta.find((s) => S(s.properties?.title) === TAB)?.basicFilter;
const hidden = new Map<number, Set<string>>();
for (const [k, v] of Object.entries(filt?.criteria || {})) if (v?.hiddenValues?.length) hidden.set(Number(k), new Set(v.hiddenValues));
console.log(`   시트 필터 — 숨기는 값 ${[...hidden].map(([c, s]) => `${c}열: ${[...s].join(',')}`).join(' · ') || '없음'}`);

const hi = all.findIndex((x) => x.includes('차량번호'));
if (hi < 0) { console.log('   ✕ 머리글을 못 찾았다'); process.exit(1); }
const head = all[hi];
/** ★이름으로 열을 찍는다. 없으면 -1 이 아니라 «멈춘다» — 조용히 0 이 되면 돈이 사라진다. */
const col = (name: string, must = true) => {
  const j = head.findIndex((h) => flat(h) === flat(name));
  if (j < 0 && must) { console.log(`   ✕ 「${name}」 열이 없다 — 멈춘다`); process.exit(1); }
  return j;
};
const C = {
  memo: col('계약번호'), state: col('상태 표기'), sup: col('업체명'), recv: col('접수일'), deliv: col('인도일'),
  rentKind: col('렌트구분'), product: col('상품구분'), plate: col('차량번호'), model: col('모델명'),
  cust: col('고객명'), age: col('연령'), phone: col('고객연락처'), term: col('계약기간'),
  deposit: col('보증금'), payKind: col('분납여부'), ctype: col('계약형태'), rent: col('렌탈료'), price: col('차량가액'),
  supRate: col('수수료율 (공급사)'), claimY: col('판매 수수료'), claimZ: col('판매 수수료 (수식X)'),
  ch: col('에이전시'), agent: col('영업자'), agRate: col('수수료율 (에이전시)'),
  payAL: col('출고수수료'), payAM: col('출고 수수료 (수식X)'),
};

const atoms: Atom[] = []; const claws: Record<string, unknown>[] = []; const skipped: string[] = [];
for (let i = hi + 1; i < all.length; i++) {
  const x = all[i] || [];
  const st = S(x[C.state]);
  if (!st && !S(x[C.plate])) continue;
  /**
   * ⚠⚠ **시트 필터를 «뜻으로 읽지 않는다».**
   *   2026-09-01 에 8월 탭의 A열 필터(「공급사만 정산」 숨김)를 「이 달 아님」으로 읽고 52행을 뺐다.
   *   태윤 매니저가 「**박지원 누락입니다 · 박지원 공급사만 정산입니다**」로 바로잡았다 —
   *   숨긴 것은 «작업하려고» 걸어 둔 필터였지 「빼라」가 아니었다.
   *   ⇒ 필터는 «보여주기»일 뿐이다. 한 줄도 빼지 않고 다 담는다.
   *     (9월 탭 필터가 C열 업체명을 숨긴 것도 같은 종류였다 — 뜻이 아니라 작업 흔적이다.)
   */
  if (hidden.size) { /* 읽기만 하고 «거르지 않는다» */ }

  const memo = S(x[C.memo]);
  const ax = AXIS[memo] || {};
  const plate = S(x[C.plate]);
  /**
   * ★★수식X 가 이긴다 — 이름으로 고른다(자리 순서에 안 기댄다).
   * ⚠ **반드시 반올림한다.** 시트 수식값은 소수가 붙어 온다 — 실측 `1,274,546.4000000001`.
   *   안 자르면 「같은 값인데 다르다」가 되어 매번 «고칠 것»으로 잡힌다.
   */
  const claim = Math.round(N(x[C.claimZ]) || N(x[C.claimY]));
  const pay = Math.round(N(x[C.payAM]) || N(x[C.payAL]));

  if (st === '환수') {
    claws.push({
      plate, at: ymd(x[C.deliv]) || '', supplierAmt: claim, agentAmt: pay,
      reason: memo || '', supplier: S(x[C.sup]), channel: S(x[C.ch]),
      month: MONTH, sourceRow: i + 1, sourceTab: TAB, by: 'atomize-settlement-month', updatedAt: Date.now(),
    });
    continue;
  }
  atoms.push({
    code: '', plate: plate || '', model: S(x[C.model]), customer: S(x[C.cust]), phone: S(x[C.phone]), age: S(x[C.age]),
    supplier: S(x[C.sup]), channel: S(x[C.ch]), agent: S(x[C.agent]),
    product: S(x[C.product]), rentKind: S(x[C.rentKind]), contractType: S(x[C.ctype]), term: N(x[C.term]),
    rent: N(x[C.rent]), deposit: N(x[C.deposit]), price: N(x[C.price]), payKind: S(x[C.payKind]),
    supplierRate: N(x[C.supRate]), agentRate: N(x[C.agRate]),
    claimWritten: claim, payWritten: pay,
    receivedAt: ymd(x[C.recv]), deliveredAt: ymd(x[C.deliv]),
    delivered: !!ymd(x[C.deliv]), paper: st === '계약 완료', cancelled: false,
    settleTarget: (ax.settleTarget as Atom['settleTarget']) || '양쪽',
    settleRatio: ax.settleRatio ?? 1, billHold: ax.billHold ?? false, settleExclude: false,
    settledAlready: ax.settledAlready ?? false, vatIncluded: ax.vatIncluded ?? false,
    settleTerms: '', settleNote: ax.settleNote || '',
    billed: false, collected: false,
    note: AXIS[memo] ? '' : memo, sourceRow: i + 1, sourceTab: TAB,
    billMonth: st === '계약진행중' ? '' : MONTH,
  });
}

/**
 * ★★**똑같은 줄이 두 번 있으면 하나로 접는다.**
 *   태윤 매니저 2026-09-01 「웰릭스정산 **이경훈 중복**」 — 원본 8월 11·12행이 글자 하나 안 틀리고 같았다
 *   (142호1065 · 이경훈 · 청구 967,200 · 지급 744,000). 그대로 두면 웰릭스에 96만을 더 청구하고
 *   하허호에 74만을 더 준다.
 * ⚠ **접수일까지 같아야 «중복»이다.** 같은 차가 다른 날 다시 계약될 수 있다 — 차번만으로 접으면 진짜 계약이 사라진다.
 */
{
  const seen = new Map<string, Atom>();
  const dup: string[] = [];
  for (const a of atoms) {
    const k = `${a.plate.replace(/\s/g, '')}|${a.receivedAt}|${a.claimWritten}|${a.payWritten}|${a.customer}`;
    if (a.plate && seen.has(k)) { dup.push(`${a.sourceRow}행 ${a.plate} ${a.supplier} ${a.customer} — 앞줄과 «똑같다»`); continue; }
    if (a.plate) seen.set(k, a);
  }
  if (dup.length) {
    console.log(`\n   ★똑같은 줄을 접었다 ${dup.length}건`);
    for (const d of dup) console.log(`      ${d}`);
    const keep = new Set([...seen.values()]);
    for (let i = atoms.length - 1; i >= 0; i -= 1) if (atoms[i].plate && !keep.has(atoms[i])) atoms.splice(i, 1);
  }
}

// ── 기존 원자와 열쇠 맞추기 (차번|접수일 → stl_ 코드) ─────
const have = ((await db.ref(ROWS_NODE).get().catch(() => null))?.val() || {}) as Record<string, { plate?: string; receivedAt?: string; code?: string; payWritten?: number; claimWritten?: number; channel?: string; customer?: string; billMonth?: string; fromSheet?: string }>;
/**
 * ★★**차번 없는 줄의 열쇠에 «줄 번호»를 쓰지 않는다.**
 *   「업무지원비」처럼 차가 없는 정산이 있다(사장님 2026-09-01 「차량번호 없이 주는것도 있고」).
 *   ⚠ 2026-09-02 — 열쇠에 sourceRow 가 들어 있었다. 박지원 줄을 살리자 그 아래가 한 칸씩 밀렸고,
 *     최사랑 업무지원비 10만원이 51행→52행이 되면서 «다른 줄»로 잡혀 새 코드가 하나 더 생겼다.
 *     화면에는 똑같은 10만원이 두 줄로 섰다. 위에 한 줄만 끼어도 깨지는 열쇠는 열쇠가 아니다.
 *   ⇒ 자리가 아니라 «내용»으로 묶는다 — 달·채널·고객·청구·지급.
 */
const rowKey = (plate: string, recv: string, month: string, ch: string, cust: string, claim: number, pay: number) => (plate
  ? `${plate.replace(/\s/g, '')}|${recv}`
  : `무차번|${month}|${ch}|${cust}|${claim}|${pay}`);
const codeOf = new Map(Object.values(have).map((r) => [
  rowKey(S(r.plate), S(r.receivedAt), S(r.billMonth) || MONTH, S(r.channel), S(r.customer), N(r.claimWritten), N(r.payWritten)), S(r.code)]));
const keyOf = (a: Atom) => rowKey(a.plate, a.receivedAt, a.billMonth || MONTH, a.channel, a.customer, a.claimWritten, a.payWritten);
let matched = 0; const fresh: Atom[] = []; const fixes: string[] = [];
for (const a of atoms) {
  const key = keyOf(a);
  const code = codeOf.get(key);  // ★차번 없는 줄도 붙인다 — 안 붙이면 돌릴 때마다 새 줄이 선다
  if (code) {
    a.code = code; matched++;
    const old = have[code];
    // ★차이가 «0 이 아닌» 것만 알린다. 0 을 같이 찍으면 진짜 고쳐지는 것이 묻힌다.
    if (old && N(old.payWritten) - a.payWritten !== 0) fixes.push(`   ${a.plate.padEnd(11)} 지급 ${won(N(old.payWritten))} → ${won(a.payWritten)}  (${won(a.payWritten - N(old.payWritten))})`);
    if (old && N(old.claimWritten) - a.claimWritten !== 0) fixes.push(`   ${a.plate.padEnd(11)} 청구 ${won(N(old.claimWritten))} → ${won(a.claimWritten)}  (${won(a.claimWritten - N(old.claimWritten))})`);
  } else { a.code = `stl_${Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`; fresh.push(a); }
}

console.log(`\n   원자 ${atoms.length}줄 · 환수 ${claws.length}건 · 필터로 빠짐 ${skipped.length}줄`);
for (const s of skipped) console.log(`      ${s}`);
console.log(`\n   기존 원자와 붙음 ${matched}줄 · 새 줄 ${fresh.length}줄`);
for (const f of fresh) console.log(`      새 — ${(f.plate || "(차번없음)").padEnd(11)} ${(f.supplier || "(공급사없음)").padEnd(10)} ${f.channel} ${f.receivedAt} ${f.settleNote || f.note}`);
if (fixes.length) { console.log(`\n   ★고쳐지는 금액 ${fixes.length}건 (수식X 우선)`); for (const f of fixes) console.log(f); }

const ax = atoms.filter((a) => a.settleTarget !== '양쪽' || a.settleRatio !== 1 || a.billHold || a.settledAlready || a.vatIncluded);
console.log(`\n   ★메모에서 옮긴 축 ${ax.length}줄`);
for (const a of ax) console.log(`      ${a.plate.padEnd(11)} 대상 ${a.settleTarget.padEnd(5)} 비율 ${a.settleRatio} ${a.billHold ? '· 청구보류' : ''}${a.settledAlready ? ' · 정산완료' : ''}${a.vatIncluded ? ' · 부가세포함' : ''}`);
console.log(`\n   ★환수 ${claws.length}건`);
for (const c of claws) console.log(`      ${S(c.plate).padEnd(11)} ${S(c.supplier).padEnd(10)} 공급사 ${won(N(c.supplierAmt))} · 영업자 ${won(N(c.agentAmt))} · 환수일 ${S(c.at) || '(없음 — 사람이 채워야 한다)'}`);

/**
 * ★**이 탭에서 올렸던 줄인데 이번엔 «없는» 줄 = 묵은 줄.**
 *   시트에서 지웠거나, 예전 열쇠로 잘못 선 줄이다. 안 걷으면 화면에 유령이 남는다
 *   (2026-09-02 최사랑 10만원 두 줄이 그랬다). 걷은 것은 반드시 «이름을 대고» 지운다.
 */
const alive = new Set(atoms.map((a) => a.code));
const stale = Object.entries(have).filter(([k, r]) => S(r.fromSheet) === TAB && !alive.has(k));
if (stale.length) {
  console.log(`
   ★묵은 줄 ${stale.length}개 — 이 탭에서 올렸는데 이번 취합엔 «없다». 걷는다`);
  for (const [k, r] of stale) console.log(`      ${(S(r.plate) || '(차번없음)').padEnd(11)} ${S(r.customer).padEnd(8)} 청구 ${won(N(r.claimWritten))} · 지급 ${won(N(r.payWritten))}   [${k}]`);
}

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 올린다.\n'); process.exit(0); }

const patch: Record<string, unknown> = {};
for (const a of atoms) patch[`${ROWS_NODE}/${a.code}`] = { ...a, updatedAt: Date.now(), fromSheet: TAB };
for (const c of claws) patch[`${CLAW_NODE}/${S(c.plate).replace(/[.$#[\]/\s]/g, '_')}_${MONTH}`] = c;
for (const [k] of stale) patch[`${ROWS_NODE}/${k}`] = null;  // ★묵은 줄은 걷는다
await db.ref().update(patch);
console.log(`\n   ✓ ${Object.keys(patch).length}개 올림 — 원자 ${atoms.length} · 환수 ${claws.length}`);

// ── 되읽어 대조 ──
const back = ((await db.ref(ROWS_NODE).get()).val() || {}) as Record<string, Record<string, unknown>>;
const bad: string[] = [];
for (const a of atoms) {
  const g = back[a.code];
  if (!g) { bad.push(`${a.plate} — 안 올라갔다`); continue; }
  if (N(g.payWritten) !== a.payWritten) bad.push(`${a.plate} 지급 — 넣은 ${won(a.payWritten)} · 읽은 ${won(N(g.payWritten))}`);
  if (N(g.claimWritten) !== a.claimWritten) bad.push(`${a.plate} 청구 — 넣은 ${won(a.claimWritten)} · 읽은 ${won(N(g.claimWritten))}`);
}
if (bad.length) { console.log(`\n   ✕ 되읽기 어긋남 ${bad.length}건`); for (const b of bad.slice(0, 10)) console.log(`      ${b}`); process.exit(1); }
console.log('   ✓ 되읽어 대조 — 넣은 값 그대로다.\n');
process.exit(0);
