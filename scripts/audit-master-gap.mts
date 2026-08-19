/**
 * **상품리스트에 서는 차가 차종마스터에 실제로 있나** — 없는 축을 뽑아 준다. 읽기 전용.
 *
 * ★값은 마스터에서 가져와야 한다(사장님 2026-08-13 — 「차종마스터에서 가져오는 거지 새로 쓰는 게
 *   아니야, 없으면 차종마스터를 만들더라도」). 그러려면 «무엇이 없는지»부터 세야 한다.
 *
 * 축은 마스터 구조 그대로다.
 *   제조사 maker → 모델 model → 세부모델 sub_model → 파워트레인 variant.label → 세부트림 trim
 *
 * 어디서 끊겼는지로 가른다.
 *   ✗제조사     그 제조사가 마스터에 없다
 *   ✗모델       제조사는 있는데 그 모델이 없다
 *   ✗세부모델    모델은 있는데 그 세부모델이 없다
 *   ✗파워트레인   세부모델은 있는데 그 파워트레인 축이 없다   ← 마스터에 variant 를 더해야 한다
 *   ✗세부트림    파워트레인은 있는데 그 트림이 목록에 없다
 *   ✓          다섯 축이 마스터에 다 있다
 *
 *   npx tsx scripts/audit-master-gap.mts
 *   npx tsx scripts/audit-master-gap.mts --csv=tmp/master-gap.csv
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isStockedProduct } from '../lib/domain/product';
import { makerDisplay } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const at = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${tok}`)).text());

const prods = await at('v4/products');
/**
 * ★차종마스터 정본은 **리포 파일 `public/data/vehicle-master.json`** 이다. 앱이 그걸 읽는다.
 * ⚠ RTDB `vehicle_master`(1,106건)를 보지 마라 — v3 잔재이고 **제조사·모델만 있는 껍데기**다
 *   (sub_model·gen_code·variants·trims 가 전부 비어 있다, 실측 2026-08-13).
 *   그걸로 대조하면 「96% 가 마스터에 없다」는 거짓 결론이 나온다. `v4/vehicle_master` 는 0건이다.
 */
const MASTER_FILE = arg('master', 'public/data/vehicle-master.json');
const parsed = JSON.parse(readFileSync(MASTER_FILE, 'utf8')) as unknown;
const entries = (Array.isArray(parsed) ? parsed : ((parsed as Rec)?.entries || Object.values(parsed as Rec))) as MasterEntry[];
console.log(`  정본 ${MASTER_FILE}`);
console.log(`■ 차종마스터 ${entries.length}건\n`);

/**
 * ★제조사는 **표시 규격(`makerDisplay`)으로 맞춰 비교한다.**
 *   마스터는 「르노코리아」·「KG모빌리티」로 담고 매물은 「르노」·「KGM」으로 담는 일이 있다.
 *   원문끼리 견주면 그랑 콜레오스 16대가 「마스터에 없는 모델」로 나온다 — 실제로는 있다
 *   (실측 2026-08-13, 그 착오를 한 번 냈다).
 */
const mk = (v: unknown) => norm(makerDisplay(v));
const makers = new Set(entries.map((e) => mk(e.maker)));
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

type Verdict = '✓' | '✗차종정보미입력' | '✗제조사' | '✗모델' | '✗세부모델' | '✗파워트레인' | '✗세부트림';
const judge = (p: Rec): { verdict: Verdict; note: string } => {
  if (!S(p.maker) && !S(p.model) && !S(p.sub_model) && !S(p.variant) && !S(p.trim_name)) {
    return { verdict: '✗차종정보미입력', note: `${S(p.car_number)} (${code(p) || '공급사미상'})` };
  }
  const maker = mk(p.maker);
  if (!makers.has(maker)) return { verdict: '✗제조사', note: S(p.maker) };
  const pool = byMaker.get(maker) || [];
  const model = norm(p.model);
  const sameModel = pool.filter((e) => norm(e.model) === model);
  if (!sameModel.length) return { verdict: '✗모델', note: `${S(p.maker)} ${S(p.model)}` };
  const sub = norm(p.sub_model);
  // 세부모델은 세대코드가 붙어 있기도 하다 — 마스터의 「세부모델 + 세대코드」와도 견준다.
  const sameSub = sameModel.filter((e) => norm(e.sub_model) === sub || norm(`${e.sub_model}${e.gen_code}`) === sub);
  if (!sameSub.length) return { verdict: '✗세부모델', note: `${S(p.maker)} ${S(p.model)} / ${S(p.sub_model)}` };
  const variant = norm(p.variant);
  const hitVar = sameSub.flatMap((e) => e.variants || []).filter((v) => norm(v.label) === variant);
  if (!hitVar.length) return { verdict: '✗파워트레인', note: `${S(p.maker)} ${S(p.model)} ${S(p.sub_model)} / ${S(p.variant)}` };
  const trim = norm(p.trim_name);
  if (!trim) return { verdict: '✓', note: '' };
  const trims = new Set([...hitVar.flatMap((v) => v.trims || []), ...sameSub.flatMap((e) => e.trims || [])].map(norm));
  if (!trims.has(trim)) return { verdict: '✗세부트림', note: `${S(p.maker)} ${S(p.model)} ${S(p.sub_model)} ${S(p.variant)} / ${S(p.trim_name)}` };
  return { verdict: '✓', note: '' };
};

const tally = new Map<Verdict, number>();
const gaps = new Map<string, { verdict: Verdict; n: number }>();
const lines: string[] = ['상품키,차량번호,제조사,모델,세부모델,파워트레인,세부트림,판정,없는 축'];
for (const p of rows) {
  const { verdict, note } = judge(p);
  tally.set(verdict, (tally.get(verdict) || 0) + 1);
  if (verdict !== '✓') {
    const key = `${verdict}|${note}`;
    const g = gaps.get(key) || { verdict, n: 0 };
    g.n++; gaps.set(key, g);
  }
  lines.push([p._key || p.product_code, p.car_number, p.maker, p.model, p.sub_model, p.variant, p.trim_name, verdict, note]
    .map((c) => `"${S(c).replace(/"/g, '""')}"`).join(','));
}
console.log(`■ 상품리스트 ${rows.length}대 판정`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(8)} ${String(n).padStart(4)}대  ${(n / rows.length * 100).toFixed(1)}%`);

const missingProductInfo = [...gaps].filter(([, g]) => g.verdict === '✗차종정보미입력');
const masterGaps = [...gaps].filter(([, g]) => g.verdict !== '✗차종정보미입력');
console.log(`\n■ 마스터에 만들어야 할 것 — 같은 결손끼리 묶었다 (${masterGaps.length}종)`);
for (const [key, g] of masterGaps.sort((a, b) => b[1].n - a[1].n).slice(0, 40)) {
  console.log(`   ${String(g.n).padStart(3)}대  ${key.split('|')[0].padEnd(8)} ${key.split('|')[1]}`);
}
if (masterGaps.length > 40) console.log(`   … 그 밖 ${masterGaps.length - 40}종`);
console.log(`\n■ 공급사 상품행 차종정보 미입력 (${missingProductInfo.length}종)`);
for (const [key, g] of missingProductInfo.sort((a, b) => b[1].n - a[1].n)) {
  console.log(`   ${String(g.n).padStart(3)}대  ${key.split('|')[1]}`);
}

const csv = arg('csv');
if (csv) { mkdirSync('tmp', { recursive: true }); writeFileSync(csv, lines.join('\n'), 'utf8'); console.log(`\n  CSV: ${csv} (${lines.length}행)`); }
