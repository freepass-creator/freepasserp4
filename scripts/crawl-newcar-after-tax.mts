/**
 * 전기·하이브리드 트림의 **「세제혜택 후 판매가격」**이 제조사 기준으로 맞는지 «확인»하고,
 * 빠진 것이 있으면 제조사 값으로 채운다.
 *
 * ★★사장님 2026-09-09 「**그냥 온라인에서 확인될 수 있는 거. 제조사 꺼 기준으로 해.**」
 *
 * ── 2026-09-09 실측 결과 (온라인 대조 끝) ─────────────────────────────
 * 전기·하이브리드 230트림 중 **169트림**에 이미 제조사 감면이 실려 있다. 나머지 61줄은:
 *
 *   · **현대 53줄 — 제조사가 「감면 없음」이라고 준 것**(`taxIncentive` 0 이 52줄 · 음수 1줄).
 *     스타리아·포터2 는 **승합·화물이라 개별소비세가 아예 안 붙는다** → 「후 = 전」이 **맞다.**
 *     음수는 감면이 아니라 «가산»이다(택시·영업용) → 0 으로 본다.
 *   · **기아 6줄**(쏘렌토 하이브리드 전자식4WD·블랙에디션) — `taxIncentive` 칸이 «없고»,
 *     공식 가격표 페이지도 그 트림엔 「세제혜택 후」를 **안 싣는다**(「판매가격」만 찍는다).
 *   · **제네시스 2줄**(G80-EV · GV70-EV) — genesis.com 이 가격을 JS 로 따로 부르고,
 *     모델 페이지에 「세제혜택」 문구가 **없다**.
 *
 * ⇒ **지어내지 않는다.** 저 8줄은 「감면 0」이 아니라 **「제조사가 공개를 안 한다」**이다.
 *   지금 화면은 감면 0 이면 그냥 감면 없이 계산한다(보수적 = 비싸게 나온다).
 *
 * ── 짝짓기 규칙 ────────────────────────────────────────────────
 * ⚠⚠ **제조사 경계를 넘지 않는다.** 값만 보고 붙였더니 제네시스 GV70-EV(전 75,800,000)에
 *   **기아 EV9** 의 세제후가 붙었다 — 전가가 우연히 같았다(미리보기에서 잡음).
 * ⚠ 현대는 문서에 `taxIncentive` 가 있으므로 **그 값을 그대로** 쓴다(페이지를 안 긁는다).
 *   현대 가격표 페이지는 **4WD 트림을 아예 안 싣는다**(싼타페 실측 — 2WD 5줄만).
 *
 *   npx tsx scripts/crawl-newcar-after-tax.mts            # 확인
 *   npx tsx scripts/crawl-newcar-after-tax.mts --apply    # 채우기
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·.]/g, '');

/** 한 트림의 공식 두 값. */
export type AfterTax = { trim: string; before: number; after: number };

const won = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0;
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/**
 * 가격표 HTML 에서 「… 세제혜택 전 판매가격 A 세제혜택 후 판매가격 B」 덩어리를 다 모은다.
 * ⚠ 태그를 걷어 «글»로 만든 뒤 읽는다 — 마크업이 바뀌어도 문구는 안 바뀐다.
 */
export function afterTaxPairs(html: string): AfterTax[] {
  const t = strip(
    html.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u002F/g, '/')
      .replace(/\\"/g, '"').replace(/\\[nrt]/g, ' '),
  );
  const out: AfterTax[] = [];
  const re = /세제혜택\s*전\s*판매가격\s*([\d,]{7,})\s*세제혜택\s*후\s*판매가격\s*([\d,]{7,})/g;
  for (const m of t.matchAll(re)) {
    const before = won(m[1]); const after = won(m[2]);
    if (!(before > 0 && after > 0) || after > before) continue;   // 후>전 은 버그다(영업용 가산)
    /* 트림 이름은 «바로 앞»에 있다 — 마지막 낱말 뭉치를 집는다. */
    const head = t.slice(Math.max(0, m.index - 80), m.index).trim();
    const trim = (/([가-힣A-Za-z0-9][가-힣A-Za-z0-9 ()+.\-]{0,24})\s*$/.exec(head)?.[1] ?? '').trim();
    out.push({ trim, before, after });
  }
  // 같은 짝이 여러 번 찍힌다(탭·요약) — 「전가」로 하나만 남긴다.
  const seen = new Map<number, AfterTax>();
  for (const p of out) if (!seen.has(p.before)) seen.set(p.before, p);
  return [...seen.values()];
}

const KIA = 'https://www.kia.com/kr/vehicles';
const HD = 'https://www.hyundai.com/kr/ko';

async function fetchText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (freepass newcar sync)' } });
    return r.ok ? await r.text() : '';
  } catch { return ''; }
}

/** 현대는 전기/그 밖 경로가 갈린다 — 둘 다 눌러 본다. */
/** (남겨 둔다 — 현대 페이지는 4WD 트림을 안 싣는 것이 실측이라 지금은 API 스냅샷을 쓴다.) */
export const hyundaiPrice = async (slug: string) =>
  (await fetchText(`${HD}/e/vehicles/${slug}/price`)) || (await fetchText(`${HD}/vehicles/${slug}/price`));

/* ★슬러그는 «짐작»이 아니라 사이트가 건 링크다 — 기존 크롤러가 이미 푼 목록을 그대로 쓴다.
   내가 모델 이름에서 만들어 봤더니 61줄 중 **한 줄도** 못 붙였다(2026-09-09). */
const KIA_SLUGS = ['morning', 'ray', 'k5', 'k8', 'k9', 'seltos', 'niro', 'sportage', 'sorento', 'carnival',
  'ev3', 'ev4', 'ev5', 'ev6', 'ev9'];
const HD_SLUGS: string[] = [
  'the-new-grandeur', 'the-new-grandeur-hybrid', 'the-new-grandeur-taxi',
  'sonata-the-edge', 'sonata-the-edge-hybrid', 'sonata-taxi',
  'the-all-new-avante', 'the-all-new-avante-hybrid', 'avante-n',
  'venue', 'kona', 'kona-hybrid', 'kona-electric',
  'the-all-new-tucson', 'tucson', 'tucson-hybrid',
  'santafe', 'santafe-hybrid', 'palisade', 'palisade-hybrid',
  'the-new-staria', 'the-new-staria-hybrid', 'the-new-staria-electric',
  'the-new-staria-lounge', 'the-new-staria-lounge-hybrid', 'the-new-staria-lounge-electric',
  'the-new-staria-lounge-mobility', 'the-new-staria-lounge-mobility-hybrid',
  'the-new-staria-limousine-hybrid', 'the-new-staria-limousine-electric',
  'the-new-staria-kinder', 'the-new-staria-kinder-hybrid',
  'ioniq5', 'ioniq5-n', 'the-new-ioniq6', 'ioniq6-n', 'ioniq9',
  'nexo', 'st1', 'porter2', 'porter2-electric', 'porter2-special', 'porter2-electric-special',
];

async function main() {
  const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).split(String.fromCharCode(92) + 'n').join(String.fromCharCode(10)) }) });
  const fs = getFirestore();

  const snap = await fs.collection('new_car_trim').get();
  /* 고칠 줄만 고른다 — 전기·하이브리드인데 「후 = 전」인 것. 가솔린·디젤은 감면이 원래 없다. */
  const need = snap.docs.filter((d) => {
    const v = d.data();
    if (!/전기|하이브리드/.test(S(v.fuel))) return false;
    const b = Number(v.priceBefore) || 0; const a = Number(v.priceAfter) || 0;
    return b > 0 && !(a > 0 && a < b);
  });
  console.log(`세제혜택이 비어 있는 전기·하이브리드 줄 — ${need.length}개
`);

  /* ★모델을 «짝지으려» 하지 않는다 — 전 슬러그를 훑어 짝을 모으고, 「세제혜택 전」 값으로 맞댄다.
     전가는 제조사가 정한 «한 값»이라 이름 표기가 갈려도 안 갈린다.
     ⚠ 값이 겹치는 짝이 있으면 **안 붙인다** — 남의 차 감면을 붙이느니 비우는 게 낫다. */
  /* 기아·제네시스는 공식 가격표 «페이지»에서 「세제혜택 전/후」 짝을 받는다.
     ⚠⚠ 제조사 경계를 넘지 않는다 — 값만 보고 붙였더니 제네시스 GV70-EV(전 75,800,000)에
       **기아 EV9** 의 세제후가 붙었다(전가가 우연히 같았다 · 2026-09-09 미리보기에서 잡음). */
  const pool = new Map<string, { after: number; where: string }>();
  const dup = new Set<string>();
  const key = (maker: string, before: number) => `${maker}|${before}`;
  const add = (maker: string, where: string, ps: AfterTax[]) => {
    for (const p of ps) {
      const k = key(maker, p.before);
      const prev = pool.get(k);
      if (prev && prev.after !== p.after) { dup.add(k); continue; }
      pool.set(k, { after: p.after, where });
    }
  };
  for (const slug of KIA_SLUGS) {
    const ps = afterTaxPairs(await fetchText(`${KIA}/${slug}/price`));
    if (ps.length) add('기아', `기아 ${slug}`, ps);
  }
  console.log(`기아 공식 가격표 짝 ${pool.size}개`);

  let hit = 0; const missed: string[] = [];
  let batch = fs.batch(); let n = 0;
  for (const d of need) {
    const v = d.data();
    const b = Number(v.priceBefore) || 0;
    /* ① 현대 — 문서 키(`saleModelCode`)로 «정확히» 맞춘다. ② 그 밖 — 공식 가격표 짝(제조사 안에서). */
    /* ★현대 문서는 `taxIncentive` 를 «이미» 들고 있다 — 제조사 API 가 준 값이다. 그대로 쓴다. */
    const inc = Math.max(0, Number(v.taxIncentive) || 0);
    const k = key(S(v.maker), b);
    const found = inc > 0 && inc < b
      ? { after: b - inc, where: `현대 공식 API(taxIncentive ${inc.toLocaleString('ko-KR')})` }
      : (dup.has(k) ? undefined : pool.get(k));
    const label = `${S(v.maker)} ${S(v.sub_model)} ${S(v.fuel)} ${S(v.trim)}`;
    if (!found) { missed.push(`${label} — 전 ${b.toLocaleString('ko-KR')}`); continue; }
    console.log(`  ${label} — 전 ${b.toLocaleString('ko-KR')} → 후 ${found.after.toLocaleString('ko-KR')} (−${(b - found.after).toLocaleString('ko-KR')}) · ${found.where}`);
    if (APPLY) {
      batch.set(d.ref, { priceAfter: found.after, priceAfterSource: `${found.where} 공식 가격표`, priceAfterAt: new Date().toISOString().slice(0, 10) }, { merge: true });
      if (++n >= 400) { await batch.commit(); batch = fs.batch(); n = 0; }
    }
    hit++;
  }
  if (APPLY && n) await batch.commit();
  console.log(`
붙인 줄 ${hit} · 못 붙인 줄 ${missed.length}${APPLY ? ' (실제로 썼다)' : ' (미리보기 — 쓰려면 --apply)'}`);
  /* ⚠ 못 붙인 것은 «지어내지 않는다». 제조사가 안 실은 것은 「감면 0」이 아니라 「미수집」이다. */
  for (const m of missed) console.log(`  ⚠ ${m}`);
}

if (!process.env.VITEST) await main();
