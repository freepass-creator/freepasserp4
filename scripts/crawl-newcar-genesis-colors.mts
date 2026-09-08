/**
 * 제네시스 «제조사 색상» 크롤러 — BTO(내 차 만들기)가 부르는 **구조 API** 를 그대로 받는다.
 *
 * ★★사장님 2026-09-08 「신차마스터에는 **제조사 색상 그대로** 해야지」 · 「채워」
 *
 * ★기아와 «달리» 브라우저가 필요 없다 — 제네시스 BTO 는 화면을 그리기 전에 JSON 을 받아 온다:
 *     https://www.genesis.com/wsvc/kr/api/v2/structure/data?key=btomodel&lngloc=ko-KR&model=JJ7B
 *   그 안에 색이 «구조»로 들어 있다(2026-09-08 실측 · G80 외장 16색):
 *     exteriorColors[].list[]           → colorName · colorCode · price · swatch
 *     interiorDesigns[].interiorColors[]→ colorName · specCode · swatch
 *   ⇒ 브라우저를 몰지 않는다. 빠르고, 화면이 바뀌어도 안 깨진다.
 *   ⚠ 기아는 이 길이 없어서(데이터 호출이 «하나도» 없다) Playwright 로 몬다
 *     — `scripts/crawl-newcar-kia-colors.mts`. 같은 일인데 길이 다르다.
 *
 * ★모델 코드는 BTO 페이지 HTML 에 그대로 있다(`model=JJ7B`). 그래서 주소만 알면 된다.
 *
 * 실행 : npx tsx scripts/crawl-newcar-genesis-colors.mts          (드라이런)
 *        npx tsx scripts/crawl-newcar-genesis-colors.mts --apply  (Firestore new_car_trim 에 merge)
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (v: unknown) => String(v ?? '').trim();

/** BTO 주소 — 갈래(sedan/suv)가 주소에 들어가서 목록으로 둔다. */
const BTO: { key: string; url: string }[] = [
  { key: 'G70', url: 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g70/bto' },
  { key: 'G80', url: 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g80/bto' },
  { key: 'G80-EV', url: 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/electrified-g80/bto' },
  { key: 'G90', url: 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g90/bto' },
  { key: 'GV60', url: 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv60/bto' },
  { key: 'GV70', url: 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv70/bto' },
  { key: 'GV70-EV', url: 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/electrified-gv70/bto' },
  { key: 'GV80', url: 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv80/bto' },
  { key: 'GV80-COUPE', url: 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv80-coupe/bto' },
];

type Color = { name: string; code?: string; price?: number; ok?: string };

/** 「바트나 그레이 [GRY] 」 → 이름과 코드로 가른다. 코드가 이름 안에 대괄호로 붙어 온다. */
function splitName(raw: string): { name: string; code?: string } {
  const t = S(raw);
  const m = /^(.*?)\s*\[([A-Z0-9]{2,4})\]\s*$/.exec(t);
  return m ? { name: m[1].trim(), code: m[2] } : { name: t };
}

async function modelCode(url: string): Promise<string | null> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const html = await r.text();
  return /btomodel&lngloc=ko-KR&model=([A-Z0-9]{3,6})/.exec(html)?.[1] ?? null;
}

async function colorsOf(code: string, ref: string): Promise<{ ext: Color[]; int: Color[] } | null> {
  const r = await fetch(`https://www.genesis.com/wsvc/kr/api/v2/structure/data?key=btomodel&lngloc=ko-KR&model=${code}`,
    { headers: { 'User-Agent': UA, Referer: ref, Accept: 'application/json' } });
  if (!r.ok) return null;
  const d = await r.json() as {
    exteriorColors?: { list?: { colorName?: string; colorCode?: string; price?: string; hide?: boolean }[] }[];
    interiorDesigns?: { interiorColors?: { colorName?: string; specCode?: string; price?: string; hide?: boolean }[] }[];
  };
  const seen = new Set<string>();
  const ext: Color[] = [];
  for (const g of d.exteriorColors ?? []) {
    for (const c of g.list ?? []) {
      if (c.hide) continue;
      const { name, code: cc } = splitName(c.colorName ?? '');
      if (!name || seen.has(name)) continue;
      seen.add(name);
      ext.push({ name, code: cc || S(c.colorCode) || undefined, price: Math.max(0, Number(c.price) || 0), ok: 'Y' });
    }
  }
  const seen2 = new Set<string>();
  const int: Color[] = [];
  for (const g of d.interiorDesigns ?? []) {
    for (const c of g.interiorColors ?? []) {
      if (c.hide) continue;
      const { name } = splitName(c.colorName ?? '');
      if (!name || seen2.has(name)) continue;
      seen2.add(name);
      int.push({ name, code: S(c.specCode) || undefined, price: Math.max(0, Number(c.price) || 0), ok: 'Y' });
    }
  }
  return { ext, int };
}

const result: Record<string, { code: string; ext: Color[]; int: Color[] }> = {};
console.log(`제네시스 색상 — 모델 ${BTO.length}개`);
for (const m of BTO) {
  try {
    const code = await modelCode(m.url);
    if (!code) { console.log(`  ✗ ${m.key} — 모델 코드를 못 찾았다`); continue; }
    const c = await colorsOf(code, m.url);
    if (!c || (!c.ext.length && !c.int.length)) { console.log(`  ✗ ${m.key}(${code}) — 색이 비었다`); continue; }
    result[m.key] = { code, ...c };
    console.log(`  · ${m.key}(${code}) — 외장 ${c.ext.length} · 내장 ${c.int.length} · 유료 ${c.ext.filter((x) => x.price).length}`);
  } catch (e) { console.log(`  ✗ ${m.key} —`, String((e as Error).message).slice(0, 60)); }
  await sleep(700);
}

mkdirSync('data/new-car', { recursive: true });
writeFileSync('data/new-car/genesis-colors.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), models: result }, null, 1));
console.log(`\n받은 모델 ${Object.keys(result).length} → data/new-car/genesis-colors.json`);

if (!APPLY) { console.log('(드라이런 — Firestore 에 쓰려면 --apply)'); process.exit(0); }

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const FS = getFirestore();
const snap = await FS.collection('new_car_trim').where('maker', '==', '제네시스').get();
const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
let hit = 0;
const batch = FS.batch();
for (const doc of snap.docs) {
  const sub = norm(S(doc.data().sub_model));
  // 긴 이름부터 맞춘다 — 「G80-EV」가 「G80」에 먼저 걸리면 안 된다.
  const key = Object.keys(result).sort((a, b) => norm(b).length - norm(a).length).find((k) => sub === norm(k));
  if (!key) continue;
  batch.set(doc.ref, { extColors: result[key].ext, intColors: result[key].int, colorSource: 'genesis.com/bto', colorAt: new Date().toISOString().slice(0, 10) }, { merge: true });
  hit++;
}
await batch.commit();
console.log(`Firestore — 제네시스 트림 ${snap.size} 중 ${hit} 개에 색상을 넣었다`);
