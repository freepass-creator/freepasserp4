/**
 * **차종마스터에 빠진 파워트레인·트림을 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★값은 마스터에서 가져오는 것이고, **없으면 마스터를 만든다**(사장님 2026-08-13).
 *   그래야 영업자 시트를 되읽어 ERP 에 넣을 때 기계적으로 들어간다.
 *
 * ★**어순부터 맞춘 뒤에 없는지 본다.** 공급사 원문은 「1.6T가솔린 2WD」처럼 배기량이 앞에 온다.
 *   그대로 마스터에 넣으면 같은 파워트레인이 두 줄로 앉아 마스터가 더러워진다.
 *   먼저 「가솔린 1.6T 2WD」로 돌리고, 그래도 없을 때만 만든다.
 *
 * ★**모델·세부모델은 만들지 않는다.** 그건 세대코드·연식범위를 사람이 정해야 한다
 *   (벤츠 CLE·캐딜락 등 4대, 그리고 스냅이 잘못 물린 「기아 로체 / A6 C9」 같은 것).
 *   여기서 하는 일은 **이미 있는 세부모델에 축을 더하는 것**뿐이다.
 *
 * ⚠ 고치기 전 파일을 `tmp/master-backup-*.json` 으로 떠 둔다.
 *
 *   npx tsx scripts/fill-master-gap.mts
 *   npx tsx scripts/fill-master-gap.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct } from '../lib/domain/product';
import { makerDisplay } from '../lib/domain/vehicle-master-match';
import { EMPTY_BOOK, upsert, type AliasBook, type AliasRule } from '../lib/domain/master-alias';
import type { MasterEntry, MasterVariant } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const FILE = arg('master', 'public/data/vehicle-master.json');
/** 「매물이 쓴 말 → 마스터가 쓰는 말」 사전. 고칠 때마다 여기 쌓인다. */
const ALIAS_FILE = arg('alias', 'public/data/master-aliases.json');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 트림 자리에 앉은 «트림이 아닌 말» — 마스터에 넣지 않는다. */
const NOT_A_TRIM = /^\(?세부등급\s*없음\)?$|^없음$|^-$/;
const FUEL = '가솔린|디젤|하이브리드|전기|수소|LPG';

/**
 * 「1.6T가솔린 2WD」 → 「가솔린 1.6T 2WD」. **어순만** 돌린다.
 * ⚠ 4MATIC·xDrive·콰트로를 AWD 로 바꾸지 마라 — 마스터가 브랜드 말을 그대로 쓴다
 *   (벤츠 「가솔린 2.0 4MATIC」 · BMW 「가솔린 2.0 xDrive」, 실측 2026-08-13).
 *   바꿔 넣으면 같은 축이 두 줄로 앉는다.
 */
const canonLabel = (raw: string) => S(raw)
  .replace(new RegExp(`^([\\d.]+T?)\\s*(${FUEL})`, 'i'), '$2 $1')
  .replace(/\s{2,}/g, ' ')
  .trim();
/** 파워트레인 뒤에 붙은 트림 조각을 떼어 낸다 — 「가솔린 1.6T 2WD 트렌드」 → 「…2WD」 + 「트렌드」. */
const DRIVE = '2WD|4WD|AWD|4MATIC|xDrive|콰트로';
function splitLabel(raw: string): { label: string; tail: string } {
  const v = canonLabel(raw);
  /**
   * ⚠ 배기량 자리가 「2WD」의 2 나 「66kWh」의 66 을 먹으면 안 된다 —
   *   「전기 66kWh」가 「전기 66」+트림「kWh」로, 「하이브리드 2WD …」가 「하이브리드 2」로 깨졌다.
   *   그래서 뒤에 WD·kWh 가 붙는 숫자는 배기량으로 보지 않는다.
   */
  const m = v.match(new RegExp(`^((?:${FUEL})(?:\\s+[\\d.]+T?(?![\\d.]*(?:WD|kWh)))?(?:\\s+(?:${DRIVE}))?(?:\\s+[\\d.]+\\s*kWh)?(?:\\s+\\d+인승)?)\\s*(.*)$`, 'i'));
  if (!m) return { label: v, tail: '' };
  // 「… 플러스 6인승」처럼 인승이 트림 뒤에 오면 인승까지 함께 살린다.
  const tail = m[2].trim();
  const seat = tail.match(/(\d+)\s*인승\s*$/);
  if (seat && !/\d+\s*인승/.test(m[1])) {
    return { label: `${m[1]} ${seat[0].replace(/\s+/g, '')}`.trim(), tail: tail.replace(/(\d+)\s*인승\s*$/, '').trim() };
  }
  return { label: m[1].trim(), tail };
}

/** 라벨을 마스터 축으로 푼다. 못 푸는 건 null 로 두지 지어내지 않는다. */
function parseVariant(label: string): MasterVariant {
  const disp = label.match(/(?:^|\s)([\d.]+)T?(?:\s|$)/);
  const seat = label.match(/(\d+)\s*인승/);
  const kwh = label.match(/([\d.]+)\s*kWh/i);
  const drive = label.match(/\b(2WD|4WD|AWD)\b/i);
  const fuel = label.match(new RegExp(`(${FUEL})`, 'i'));
  return {
    label,
    fuel: fuel ? fuel[1] : '',
    displacement_l: disp ? Number(disp[1]) : null,
    turbo: /[\d.]T(?:\s|$)/.test(label),
    drivetrain: drive ? drive[1].toUpperCase() : null,
    seat: seat ? Number(seat[1]) : null,
    battery_kwh: kwh ? Number(kwh[1]) : null,
    trims: [],
  };
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${tok}`)).text()) || {};

const raw = readFileSync(FILE, 'utf8');
const parsed = JSON.parse(raw) as unknown;
const wrapped = !Array.isArray(parsed);
const entries = (Array.isArray(parsed) ? parsed : ((parsed as Rec)?.entries || Object.values(parsed as Rec))) as MasterEntry[];
console.log(`■ 차종마스터 ${entries.length}건 — ${FILE}\n`);

const mk = (v: unknown) => norm(makerDisplay(v));
const byMaker = new Map<string, MasterEntry[]>();
for (const e of entries) {
  const k = mk(e.maker);
  (byMaker.get(k) || byMaker.set(k, []).get(k)!).push(e);
}

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const code = (p: Rec) => S(p.provider_company_code) || S(p.partner_code);
const rows = Object.values<Rec>(prods)
  .filter((p) => p && typeof p === 'object' && !dead(p) && isStockedProduct(p as any))
  .filter((p) => code(p) !== 'RP023' && !(code(p) === 'RP012' && /구독/.test(canonProductType(p.product_type) || '')));

/**
 * 그 매물이 붙을 마스터 항목을 찾는다. 못 찾으면 여기서 **만들지 않는다** —
 * 모델·세부모델을 새로 세우는 일은 세대코드·연식범위를 사람이 정해야 한다.
 * ⚠ 특히 스냅이 잘못 물린 줄(「캐딜락 캐딜락」·「기아 로체 / A6 C9」)이 그대로 마스터가 되면
 *   그 뒤로 모든 차가 거기 붙는다. 그건 결손이 아니라 데이터 오류다.
 */
const findEntry = (p: Rec): MasterEntry | null => {
  const pool = byMaker.get(mk(p.maker)) || [];
  const model = norm(p.model);
  const sameModel = pool.filter((e) => norm(e.model) === model);
  if (!sameModel.length) return null;
  const sub = norm(p.sub_model);
  const hit = sameModel.filter((e) => norm(e.sub_model) === sub || norm(`${e.sub_model}${e.gen_code}`) === sub);
  return hit[0] || null;
};

const addedVariant: { where: string; label: string; n: number }[] = [];
const addedTrim: { where: string; trim: string; n: number }[] = [];
const skipped: string[] = [];
const seenVar = new Map<string, number>();
const seenTrim = new Map<string, number>();

/** 마스터에 «비슷한 말»이 이미 있나 — 있으면 마스터를 늘리지 않고 매물 표기를 고쳐야 한다. */
const nearMiss: { where: string; ours: string; theirs: string; kind: string; n: number }[] = [];
const seenNear = new Map<string, number>();
/**
 * ★고칠 때마다 **규칙을 남긴다**(사장님 2026-08-13 — 「계속 누적해서 학습해」).
 *   여기 담긴 것이 「매물이 쓴 말 → 마스터가 쓰는 말」 사전이 되고, 다음 유입 때 자동으로 맞춰진다.
 */
const learn: AliasRule[] = [];

for (const p of rows) {
  const entry = findEntry(p);
  if (!entry) { skipped.push(`${S(p.car_number)} ${S(p.maker)} ${S(p.model)} / ${S(p.sub_model)}`); continue; }
  const { label, tail } = splitLabel(S(p.variant));
  if (!label) continue;
  const where = `${entry.maker} ${entry.model} ${entry.sub_model}`;
  let variant = (entry.variants || []).find((v) => norm(v.label) === norm(label));
  if (!variant) {
    /**
     * 축을 만들기 전에 «같은 뜻 다른 말»이 있나 본다 — 연료·배기량·구동이 같으면 표기 차이다
     * (「하이브리드 1.6T」 ↔ 「하이브리드 1.6」). 그건 마스터를 늘릴 일이 아니라 매물을 고칠 일이다.
     */
    const want = parseVariant(label);
    const twin = (entry.variants || []).find((v) => {
      const t = parseVariant(v.label);
      return t.fuel === want.fuel
        && (t.displacement_l ?? -1) === (want.displacement_l ?? -1)
        // ⚠ 터보는 «표기 차이»가 아니라 **다른 엔진**이다. 1.6T 를 1.6 으로 접으면 없는 차가 된다.
        && t.turbo === want.turbo
        && (t.drivetrain || '') === (want.drivetrain || '')
        && (t.seat ?? -1) === (want.seat ?? -1);
    });
    if (twin) {
      const k = `축|${where}|${label}|${twin.label}`;
      seenNear.set(k, (seenNear.get(k) || 0) + 1);
      learn.push({ kind: 'variant', maker: S(entry.maker), model: S(entry.model), sub_model: S(entry.sub_model), from: S(p.variant), to: twin.label, n: 1 });
      variant = twin;
    } else {
      const key = `${entry.maker}|${entry.model}|${entry.sub_model}|${label}`;
      seenVar.set(key, (seenVar.get(key) || 0) + 1);
      variant = parseVariant(label);
      entry.variants = [...(entry.variants || []), variant];
    }
  }
  // 파워트레인 칸에 붙어 있던 꼬리는 트림으로 본다(원문이 그렇게 적혀 있었다).
  const trim = S(p.trim_name) || tail;
  if (!trim || NOT_A_TRIM.test(trim)) continue;
  const all = [...(variant.trims || []), ...(entry.trims || [])];
  if (all.some((t) => norm(t) === norm(trim))) continue;
  /**
   * 마스터가 더 자세히 적어 둔 트림이 있으면(「E200 아방가르드」 ⊃ 「아방가르드」) 넣지 않는다.
   * 넣으면 같은 등급이 두 층위로 앉아 나중에 어느 쪽으로 붙을지 알 수 없게 된다.
   */
  const looser = all.find((t) => norm(t).includes(norm(trim)) || norm(trim).includes(norm(t)));
  if (looser) {
    const k = `트림|${where} ${label}|${trim}|${looser}`;
    seenNear.set(k, (seenNear.get(k) || 0) + 1);
    learn.push({ kind: 'trim', maker: S(entry.maker), model: S(entry.model), sub_model: S(entry.sub_model), from: trim, to: looser, n: 1 });
    continue;
  }
  variant.trims = [...(variant.trims || []), trim];
  entry.trims = [...(entry.trims || []), trim];
  const key = `${entry.maker}|${entry.model}|${entry.sub_model}|${label}|${trim}`;
  seenTrim.set(key, (seenTrim.get(key) || 0) + 1);
}
for (const [k, n] of seenNear) {
  const [kind, where, ours, theirs] = k.split('|');
  nearMiss.push({ kind, where, ours, theirs, n });
}

for (const [k, n] of seenVar) { const [ma, mo, sub, label] = k.split('|'); addedVariant.push({ where: `${ma} ${mo} ${sub}`, label, n }); }
for (const [k, n] of seenTrim) { const [ma, mo, sub, label, trim] = k.split('|'); addedTrim.push({ where: `${ma} ${mo} ${sub} ${label}`, trim, n }); }

console.log(`■ 더할 파워트레인 ${addedVariant.length}종`);
for (const a of addedVariant.sort((x, y) => y.n - x.n)) console.log(`   ${String(a.n).padStart(3)}대  ${a.where} / 「${a.label}」`);
console.log(`\n■ 더할 트림 ${addedTrim.length}종`);
for (const a of addedTrim.sort((x, y) => y.n - x.n)) console.log(`   ${String(a.n).padStart(3)}대  ${a.where} / 「${a.trim}」`);
if (nearMiss.length) {
  console.log(`\n■ 마스터에 «같은 뜻 다른 말»이 이미 있다 ${nearMiss.length}종 — 마스터를 늘리지 않는다`);
  console.log(`   (고칠 곳은 매물 쪽이다 — 마스터 말로 바꿔야 스냅이 붙는다)`);
  for (const a of nearMiss.sort((x, y) => y.n - x.n)) {
    console.log(`   ${String(a.n).padStart(3)}대  [${a.kind}] ${a.where}`);
    console.log(`          매물 「${a.ours}」  →  마스터 「${a.theirs}」`);
  }
}
if (skipped.length) {
  console.log(`\n  ⚠ 붙을 세부모델이 마스터에 없어 건너뛴 차 ${skipped.length}대 — 모델·세부모델은 사람이 정해야 한다`);
  for (const s of [...new Set(skipped.map((x) => x.split(' ').slice(1).join(' ')))].slice(0, 12)) console.log(`     ${s}`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

// ⚠ 마스터에 더할 게 없어도 **사전은 쓴다** — 표기 규칙은 마스터를 안 늘려도 쌓여야 한다.
if (addedVariant.length || addedTrim.length) {
  mkdirSync('tmp', { recursive: true });
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = `tmp/master-backup-${stamp}.json`;
  writeFileSync(backup, raw, 'utf8');
  const out = wrapped ? { ...(parsed as Rec), entries } : entries;
  writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\n  마스터 반영 — 파워트레인 ${addedVariant.length}종 · 트림 ${addedTrim.length}종`);
  console.log(`  되돌리려면 ${backup} 를 ${FILE} 로 덮어라`);
} else {
  console.log('\n  마스터에 더할 것은 없다.');
}

/**
 * ★표기 사전에 규칙을 **쌓는다**. 지우지 않고 더한다 —
 *   사람이 손으로 고친 규칙(`reviewed`)은 자동 규칙이 덮지 못한다.
 */
{
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let book: AliasBook = EMPTY_BOOK;
  try { book = JSON.parse(readFileSync(ALIAS_FILE, 'utf8')) as AliasBook; } catch { /* 처음이면 빈 사전 */ }
  let added = 0, changed = 0;
  for (const r of learn) {
    const res = upsert(book, { ...r, at: day, by: 'fill-master-gap' });
    book = res.book;
    if (res.added) added++;
    if (res.changed) changed++;
  }
  book.updated = day;
  writeFileSync(ALIAS_FILE, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  console.log(`\n  표기 사전 ${ALIAS_FILE} — 규칙 ${book.rules.length}개 (새로 ${added}${changed ? ` · 바뀜 ${changed}` : ''})`);
  console.log(`  이 사전은 발행·유입에서 «매물 말 → 마스터 말»로 옮기는 데 쓰인다. 다음 유입부터 자동으로 맞는다.\n`);
}
