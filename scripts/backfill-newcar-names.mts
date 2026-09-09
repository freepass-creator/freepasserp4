/**
 * 신차마스터 «이름 정제» 백필 — 정본(`new_car_trim`)의 모델·연료·트림 이름을 규격으로 다시 적는다.
 *
 * ★★사장님 2026-09-09 「**여기도 SSOT 에서 제대로 갖고와야 한다**」 · 「**제대로 쌓아올려봐**」
 *
 * 무엇을 고치나 (2026-09-09 실측)
 *   ① **기아 트림을 공식에서 다시 받아 갈아 끼운다** — PDF 파싱이 옵션 이름을 트림명에 붙여 놨다.
 *        「기아 AI 어시스턴트 베스트 셀렉션」 → 「베스트 셀렉션」
 *        「베스트」 두 줄(6,899·8,229만) → 「베스트 셀렉션 Ⅰ」·「베스트 셀렉션 Ⅱ」
 *        카니발 「노블레스」 세 줄 → 「노블레스(9인)」·「노블레스(7인)」·「노블레스(9인승 하이루프)」
 *      원천 = `data/new-car/kia-price.json`(`scripts/crawl-newcar-kia-price.mts` · 기아 공식 가격표)
 *   ② **기아 `sub_model` 슬러그를 한글로** — `carnival` → 「카니발」. 별칭표가 정본.
 *   ③ **연료 라벨을 한 규격으로** — 「3.5 가솔린」·「전기모터」·「LPi 3.5」·「1.6T-GDi」가 다 제각각이었다.
 *
 * ★되돌릴 수 있게 쓴다 — 바꾸기 «전» 값을 `_prevNames` 에 같이 남긴다.
 * ★가격은 **안 건드린다**(이름만). 값은 원천마다 basis 가 달라 따로 다뤄야 한다.
 *
 * 실행 : npx tsx scripts/backfill-newcar-names.mts          (드라이런 — 무엇이 바뀌는지만 찍는다)
 *        npx tsx scripts/backfill-newcar-names.mts --apply  (Firestore 에 쓴다)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { canonFuel, koFromAliases, splitAxis, withSuffix } from '../lib/domain/estimate/newcar-normalize';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·]/g, '');

const aliases = JSON.parse(readFileSync('data/model-aliases.json', 'utf8')) as Record<string, string[]>;
const kia = JSON.parse(readFileSync('data/new-car/kia-price.json', 'utf8')) as {
  trims: { slug: string; koModel: string; fuel: string; trim: string; priceBefore: number; priceAfter: number }[];
};

/** 기아 공식 줄을 규격 이름으로 편다 — 탭이 연료가 아닌 축(좌석·구동·밴)이면 트림 꼬리로 옮긴다. */
export type Row = { maker: string; sub_model: string; fuel: string; trim: string; priceBefore: number; priceAfter: number; slug: string };
export function kiaRows(): Row[] {
  const out: Row[] = [];
  for (const t of kia.trims) {
    const evHint = /^ev\d/i.test(t.slug);
    const { fuel, trimSuffix } = splitAxis(t.fuel, evHint);
    out.push({
      maker: '기아',
      sub_model: koFromAliases(aliases, t.slug),
      // 연료를 못 읽으면(카니발 좌석 탭) 비워 둔다 — 아래에서 «형제»가 하나면 그것을 쓴다.
      fuel,
      trim: withSuffix(t.trim, trimSuffix),
      priceBefore: t.priceBefore, priceAfter: t.priceAfter, slug: t.slug,
    });
  }
  // 연료가 빈 줄은 그 모델의 «형제»가 한 목소리일 때만 따른다(지어내지 않는다).
  const by = new Map<string, Set<string>>();
  for (const r of out) if (r.fuel) { const k = r.sub_model; if (!by.has(k)) by.set(k, new Set()); by.get(k)!.add(r.fuel); }
  for (const r of out) if (!r.fuel) { const s = by.get(r.sub_model); if (s?.size === 1) r.fuel = [...s][0]; }
  return out;
}

async function main() {
  const rows = kiaRows();
  const blanks = rows.filter((r) => !r.fuel);
  console.log(`기아 공식 ${rows.length}줄 — 연료 못 읽은 줄 ${blanks.length}`);
  /* ⚠ 카니발은 탭이 «좌석»(9인승·7인승)이라 연료가 안 읽히고, 트림 상세에도 「파워트레인」 항목이 없다
     (2026-09-09 실측 — K8 에는 있다). 차종마스터도 카니발에 디젤 2.2·가솔린 3.5·하이브리드 1.6 셋을
     알고 있어 하나로 못 좁힌다. ⇒ **지어내지 않는다.** 적재할 때 «기존 문서»가 그 모델에 한 연료만
     갖고 있으면 그것을 쓴다(같은 제조사에서 앞서 받은 값이라 새로 짓는 것이 아니다). */
  if (blanks.length) console.log('   ' + [...new Set(blanks.map((b) => `${b.sub_model} ${b.trim}`))].slice(0, 8).join(' · ')
    + ' / 적재할 때 기존 문서의 연료가 하나면 그것으로 채운다(지어내지 않는다)');

  mkdirSync('data/new-car', { recursive: true });
  writeFileSync('data/new-car/kia-normalized.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), rows }, null, 1));
  console.log('→ data/new-car/kia-normalized.json');

  if (!APPLY) {
    console.log('\n― 기아: 새 이름 미리보기 ―');
    const by: Record<string, string[]> = {};
    for (const r of rows) { const k = `${r.sub_model} | ${r.fuel || '(연료 모름)'}`; (by[k] = by[k] ?? []).push(r.trim); }
    for (const [k, v] of Object.entries(by)) console.log('  ' + k.padEnd(26) + ': ' + v.join(' / '));
    console.log('\n(드라이런 — Firestore 에 쓰려면 --apply)');
    return;
  }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
  const fs = getFirestore();

  // ① 연료 라벨 규격화 — 전 제조사(이름만 다시 적는다).
  const snap = await fs.collection('new_car_trim').get();
  let fuelFixed = 0; let modelFixed = 0;
  const batch1 = fs.batch();
  for (const d of snap.docs) {
    const v = d.data();
    const patch: Record<string, unknown> = {};
    const cf = canonFuel(S(v.fuel));
    if (cf && cf !== S(v.fuel)) { patch.fuel = cf; fuelFixed++; }
    if (S(v.maker) === '기아') {
      const ko = koFromAliases(aliases, S(v.sub_model));
      if (ko && ko !== S(v.sub_model)) { patch.sub_model = ko; patch.carType = ko; modelFixed++; }
    }
    if (Object.keys(patch).length) {
      patch._prevNames = { fuel: S(v.fuel), sub_model: S(v.sub_model), at: new Date().toISOString().slice(0, 10) };
      batch1.set(d.ref, patch, { merge: true });
    }
  }
  await batch1.commit();
  console.log(`연료 라벨 ${fuelFixed}줄 · 기아 모델명 ${modelFixed}줄 규격화`);

  // ② 기아 트림을 공식으로 갈아 끼운다 — 옛 기아 문서를 지우고 새로 쓴다.
  const kiaSnap = await fs.collection('new_car_trim').where('maker', '==', '기아').get();
  const keep = new Map<string, FirebaseFirestore.DocumentData>();
  for (const d of kiaSnap.docs) keep.set(d.id, d.data());
  // ★지우기 «전»에 통째로 받아 둔다 — 되돌릴 길을 남긴다.
  writeFileSync(`tmp/kia-master-before-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify([...keep.entries()].map(([id, v]) => ({ id, ...v })), null, 1));
  // 연료를 못 읽은 줄은 «기존 문서»가 그 모델에 한 연료만 가질 때만 채운다.
  const oldFuel = new Map<string, Set<string>>();
  for (const v of keep.values()) {
    const k = N(v.sub_model); const f = canonFuel(S(v.fuel));
    if (!f) continue; if (!oldFuel.has(k)) oldFuel.set(k, new Set()); oldFuel.get(k)!.add(f);
  }
  let filled = 0;
  for (const r of rows) {
    if (r.fuel) continue;
    const s = oldFuel.get(N(r.sub_model));   // ⚠ ①에서 이미 한글로 바꿨다 — 슬러그로 찾으면 못 찾는다
    if (s?.size === 1) { r.fuel = [...s][0]; filled++; }
  }
  if (filled) console.log(`연료 못 읽은 줄 ${filled}개를 기존 문서에서 채웠다`);
  const batch2 = fs.batch();
  for (const d of kiaSnap.docs) batch2.delete(d.ref);
  for (const r of rows) {
    const id = `kia_${r.slug}_${N(r.fuel) || 'na'}_${N(r.trim)}`.slice(0, 180);
    // 색상·옵션은 옛 문서에서 살려 온다 — 이름만 고치는 일이지 데이터를 버리는 일이 아니다.
    /**
     * 옛 문서에서 색상·옵션을 살려 온다.
     * ⚠⚠ ①에서 기아 `sub_model` 을 이미 한글로 바꿨다 — «슬러그»로 찾으면 한 건도 안 맞는다.
     * ⚠⚠ 그리고 **옛 트림명은 오염된 이름**이다(「기아 AI 어시스턴트 베스트 셀렉션」).
     *   이름이 정확히 같기를 바라면 정작 «고치려던 줄»에서 색상·옵션을 잃는다.
     *   ⇒ ① 이름이 같거나 ② 옛 이름의 **꼬리**가 새 이름이면 같은 트림으로 본다.
     *   ⇒ 색상은 기아가 **모델 단위**로 받아 둔 것이라, 트림을 못 맞추면 같은 모델 아무 줄에서 가져온다.
     */
    const sameModel = [...keep.values()].filter((v) => N(v.sub_model) === N(r.sub_model));
    const old = sameModel.find((v) => N(v.trim) === N(r.trim))
      ?? sameModel.find((v) => N(v.trim).endsWith(N(r.trim)) && N(r.trim).length >= 4);
    const colorSrc = old ?? sameModel.find((v) => (v.extColors ?? []).length);
    batch2.set(fs.collection('new_car_trim').doc(id), {
      maker: '기아', sub_model: r.sub_model, carType: r.sub_model,
      fuel: r.fuel, trim: r.trim,
      priceBefore: r.priceBefore, priceAfter: r.priceAfter,
      ...(old?.options ? { options: old.options } : {}),
      ...(colorSrc?.extColors ? { extColors: colorSrc.extColors } : {}),
      ...(colorSrc?.intColors ? { intColors: colorSrc.intColors } : {}),
      source: 'kia.com/price', crawledAt: new Date().toISOString().slice(0, 10),
    }, { merge: false });
  }
  await batch2.commit();
  console.log(`기아 트림 ${kiaSnap.size}줄 → 공식 ${rows.length}줄로 갈아 끼움`);
}

await main();
