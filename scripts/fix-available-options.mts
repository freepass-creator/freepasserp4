/**
 * 「고를 수 있는 옵션」을 **제조사 공식 가격표와 맞대 본다** — 보고만 한다(쓰지 않는다).
 *
 * ★사장님 2026-09-17 「ERP5도 틀린 거 있으면 틀린 거대로 해야지」.
 *   erp5 는 **마스터 옵션 전부를 모든 트림에 붙여** 두었다(68줄). 공식은 트림마다 목록이 다르다 —
 *   상위 트림은 그 옵션이 «기본»이라 선택 목록에서 빠진다(쏘나타 인스퍼레이션 = 셋뿐).
 *   그대로 두면 **이미 달린 옵션을 손님에게 또 판다**(내비 140만·스마트센스 45만…).
 *
 * ⚠ 크롤러(`crawl-newcar-*-options`)는 **옵션표가 이미 실린 줄을 건너뛴다**(웰릭스 규칙 보호).
 *   그래서 그 줄들은 이 도구가 고친다 — 고치는 것은 `availableOptions` **한 칸뿐**이다.
 * ⚠ 이름이 안 맞아 못 짚은 줄은 **안 건드린다**(지어내지 않는다).
 *
 * ⚠⚠ **쓰기는 일부러 없다.** 2026-09-17 첫 판이 싼타페 캘리그래피를 6 → 1 로 «지워» 버렸다
 *   (공식 「HTRAC , 험로주행모드」 ↔ 우리 「HTRAC (4WD)」 — 이름 표기가 달라 못 짚은 것을 «없다»로 셌다).
 *   고치는 일은 **원본에서 다시 싣는 쪽**이 맞다 — 웰릭스 트림별 목록은 `ingest-newcar-options`,
 *   옵션표가 아예 없는 줄은 `crawl-newcar-{hyundai,kia}-options` 가 싣는다. 여기는 «어긋난 곳을 세는 자»다.
 *
 * 실행 : npx tsx scripts/fix-available-options.mts --sa=<경로>
 */
import { readFileSync } from 'node:fs';
import { canonFuel } from '../lib/domain/estimate/newcar-normalize';

/* 쓰기 없음 — 이 도구는 세기만 한다(위 머리말). */
const APPLY = false as boolean;
const SA = (process.argv.find((a) => a.startsWith('--sa=')) || '').split('=').slice(1).join('=');
if (!SA) { console.error('--sa=<서비스계정 경로> 가 필요합니다'); process.exit(1); }

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·,+/]/g, '');
/** 로마숫자·괄호설명까지 걷은 «속이름» — 「HTRAC (4WD)」 와 「HTRAC」 이 같은 것으로 서게. */
const CORE = (v: unknown) => N(v).replace(/[ⅰⅱⅲⅳⅠⅡⅢⅣ]/g, '').replace(/\d+(인승|인치|"|열)/g, '').replace(/[0-9]/g, '');
/** 둘이 같은 옵션인가 — 딱 맞거나, 한쪽이 다른 쪽을 «머리부터» 품거나, 속이름이 같으면 같다. */
function sameOption(a: string, b: string): boolean {
  const [x, y] = [N(a), N(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const [cx, cy] = [CORE(a), CORE(b)];
  if (cx && cy && (cx === cy || cx.startsWith(cy) || cy.startsWith(cx))) return true;
  return false;
}

type Off = { koModel?: string; powertrain?: string; trim?: string; trimKo?: string; trimEn?: string; price?: number; options: { name: string; price: number }[] };
const load = (f: string): Off[] => {
  try { return (JSON.parse(readFileSync(f, 'utf8')) as { trims?: Off[] }).trims ?? []; } catch { return []; }
};
const OFFICIAL = [...load('data/new-car/hyundai-options.json'), ...load('data/new-car/kia-options.json')];
console.log(`공식 트림 ${OFFICIAL.length}줄을 읽었다(현대·기아 가격표 선택품목)`);

const sa = JSON.parse(readFileSync(SA, 'utf8'));
const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).replace(/\n/g, '\n') }) });
console.log(`대상 프로젝트 = ${sa.project_id}${APPLY ? ' · **쓰기**' : ' · 드라이런'}`);
const fs = getFirestore();

const snap = await fs.collection('new_car_trim').get();
let looked = 0; let changed = 0; let unmatched = 0; let same = 0;
const rows: string[] = [];
const missedNames: string[] = [];
let batch = fs.batch(); let n = 0;

for (const d of snap.docs) {
  const v = d.data() as Record<string, unknown>;
  const master = (v.optionsMaster ?? {}) as Record<string, { name?: string }>;
  const ids = Object.keys(master);
  if (!ids.length) continue;                      // 옵션표가 없는 줄은 크롤러 몫이다
  looked++;
  const sameModel = (x: Off) => !!x.koModel && N(x.koModel) === N(v.sub_model);
  const sameTrim = (x: Off) => [x.trim, x.trimKo, x.trimEn].some((t) => t && N(t) === N(v.trim));
  const sameFuel = (x: Off) => { const f = canonFuel(S(x.powertrain)); return !f || N(f) === N(canonFuel(S(v.fuel))); };
  const cands = OFFICIAL.filter((x) => sameModel(x) && sameTrim(x) && sameFuel(x));
  const near = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= 10_000;
  const pick = cands.length === 1 ? cands[0]
    : cands.find((x) => near(Number(x.price), Number(v.priceBefore || 0)) || near(Number(x.price), Number(v.priceAfter || 0))) ?? null;
  if (!pick || !pick.options.length) { unmatched++; continue; }

  /* ★공식 이름 ↔ 우리 마스터 이름을 맞댄다. **못 짚은 공식 이름이 있으면 그 줄은 통째로 건너뛴다** —
       2026-09-17 첫 판이 싼타페 캘리그래피를 6 → 1 로 «지워» 버렸다(「HTRAC (4WD)」 대 「HTRAC」).
       모르면 안 건드리는 것이 맞다. 못 짚은 이름은 아래에 찍어 사람이 별칭을 보탤 수 있게 한다. */
  const offNames = pick.options.map((o) => S(o.name));
  const hit = new Map<string, string>();          // 공식이름 → 우리 마스터 id
  for (const on of offNames) {
    const id = ids.find((x) => sameOption(master[x]?.name ?? '', on));
    if (id) hit.set(on, id);
  }
  const missed = offNames.filter((on) => !hit.has(on));
  if (missed.length) { unmatched++; missedNames.push(`${v.sub_model}|${v.trim} — ${missed.join(' / ')}`); continue; }
  const next = [...new Set([...hit.values()])];
  if (!next.length) { unmatched++; continue; }
  const cur = (v.availableOptions as string[] | undefined) ?? [];
  if (cur.length === next.length && cur.every((x) => next.includes(x))) { same++; continue; }

  const gone = cur.filter((x) => !next.includes(x)).map((id) => master[id]?.name ?? id);
  rows.push(`${v.maker} ${v.sub_model} | ${v.fuel} | ${v.trim} — ${cur.length} → ${next.length} (공식 ${pick.options.length})`
    + (gone.length ? `\n      빠지는 것: ${gone.slice(0, 5).join(' / ')}${gone.length > 5 ? ` 외 ${gone.length - 5}` : ''}` : ''));
  changed++;
  if (APPLY) {
    batch.set(d.ref, { availableOptions: next, availableSource: '제조사 공식 가격표 선택품목', availableAt: new Date().toISOString().slice(0, 10) }, { merge: true });
    if (++n >= 400) { await batch.commit(); batch = fs.batch(); n = 0; }
  }
}
if (APPLY && n) await batch.commit();
console.log(`\n옵션표가 있는 줄 ${looked} · 그대로 ${same} · 못 짚음 ${unmatched} · ${APPLY ? '고친' : '고칠'} 줄 ${changed}`);
for (const r of rows.slice(0, 25)) console.log('  ·', r);
if (rows.length > 25) console.log(`  … 외 ${rows.length - 25}줄`);
if (missedNames.length) {
  console.log(`
⚠ 공식 이름을 우리 마스터에서 못 짚어 **건너뛴** 줄 ${missedNames.length}:`);
  for (const m of missedNames.slice(0, 12)) console.log('   ·', m);
  if (missedNames.length > 12) console.log(`   … 외 ${missedNames.length - 12}줄`);
}
if (!APPLY) console.log('\n(드라이런 — 쓰려면 --apply)');
