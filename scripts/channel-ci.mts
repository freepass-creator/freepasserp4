/**
 * **영업채널 홈페이지에서 간판(CI)을 «따 온다».**
 *
 * ★★사장님 2026-09-10 「그래서 내가 **영업 채널 홈페이지를 너한테 주면 거기서 알아서 CI 따
 *   가지고** 쓸 수 있게끔」.
 *
 * ## 무엇을 하고 무엇을 «안» 하나
 *
 * ```
 *   한다     주소에서 마크 후보를 다 긁어 온다 · 여백을 잘라 «잉크에 딱» 맞춘다
 *            치수를 재서 보여 준다 · 브랜드 색을 뽑는다(가장 진한 색)
 *   안 한다  «무엇을 쓸지 혼자 정하지» 않는다 — 후보를 늘어놓고 사람이 고른다
 * ```
 * ★★**이게 규격이다**(`docs/DESIGN_CONFIRMED_SHOP.md` §CI — 「CI 는 «재서» 넣는다. 여백 붙은
 *   그림을 그대로 쓰지 않는다」). 홈페이지의 로고는 대개 **여백이 붙어 있고**, 어떤 것은
 *   가로로 긴 «조합형», 어떤 것은 네모 «심볼»이다. 그걸 안 재고 그대로 쓰면
 *   간판이 작아지거나 잘린다 — 2026-09-07 에 제네시스 마크가 그래서 날개가 잘렸다.
 *
 * ## 쓰는 법
 *
 * ```
 *   npm run channel:ci -- --url=https://example.co.kr --key=example
 *   npm run channel:ci -- --url=https://example.co.kr --key=example --save=3   # 3번 후보를 쓴다
 * ```
 * 처음에는 «후보만» 뽑아 `tmp/ci-<key>/` 에 넣고 표로 보여 준다. 눈으로 고른 뒤 `--save=N`.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const args = process.argv.slice(2);
const one = (k: string) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=').trim();
const url = one('url');
/**
 * **로고 주소를 «직접» 줄 때** — 요즘 사이트는 로고를 브라우저가 그려서 내려받은 HTML 에 없다.
 * 파일 이름도 `b352388e….jpg` 같은 업로드 해시라 이름으로도 못 찾는다(실측 — 이안카 홈페이지).
 * ⇒ 그때는 페이지를 열어 주소를 집어서 여기로 준다. **자르기·색·치수는 그대로 이 도구가 한다.**
 * ★찾는 요령 = 머리(header) 안, 화면 맨 위 140px 안, 폭 40~420px 인 `<img>`.
 *   이름이 아니라 **자리와 크기**로 찾는다.
 */
const direct = one('img');
/**
 * **찍은 그림에서 누끼를 따서 넣는다** — 로고 파일이 아예 없을 때의 «마지막 길».
 *
 * ★★사장님 2026-09-10 「되면 **캡처해 가지고 네가 누끼 따서 넣어주는** 형태로 해.
 *   뭐 CI 를 받으면 좋겠지만 **뭐 대단한 건 아니잖아**」. 맞다 — 받으면 좋고, 없으면 찍어서 쓴다.
 * ★내가 그 회사 홈페이지에서 로고만 찍어 두고 이 길로 넣는다(`--shot=<찍은 파일>`).
 *
 * ## ⚠⚠ 찍기는 «마지막 길»이다 — 주소가 보이면 `--img=` 가 먼저다
 *
 *   ⚠ 사장님 2026-09-10 「홈페이지에 **팝업이나 뭐가 떠 있는데 거기서 뭘 하려고 하면 안 되지**」.
 *     맞다. 실측 — 이안카 홈페이지에 행사 팝업이 떠 있는 채로 로고 자리를 찍었더니
 *     **로고 대신 팝업이 찍혔다.** 화면 찍기는 «그때 화면에 보이는 것»을 그대로 가져오므로
 *     덮인 것이 있으면 덮은 쪽이 찍힌다.
 *   ★게다가 화면은 «그려진 크기»로 찍힌다 — 같은 로고가 주소로 받으면 1558×250 인데
 *     화면에서는 160×26 이었다. 여섯 배 작다. 그걸 간판에 올리면 뭉갠 글자가 된다.
 *   ⇒ **순서를 지킨다.**
 *     ㉠ 로고의 «원본 주소»가 보이면 `--img=` — 원본 화소 그대로, 덮일 것도 없다.
 *     ㉡ 주소가 없을 때만(배경그림·캔버스) 찍는다. 그때는 **팝업·배너를 먼저 닫고**,
 *        로고만 화면에 홀로 있게 한 뒤 찍는다.
 */
const shot = one('shot');
const key = one('key');
const save = Number(one('save') || 0);

if ((!url && !direct && !shot) || !key) {
  console.error('\n  npm run channel:ci -- --url=https://회사주소 --key=채널이름');
  console.error('  npm run channel:ci -- --img=https://로고주소.png --key=채널이름 --save=1');
  console.error('  npm run channel:ci -- --shot=tmp/찍은로고.png --key=채널이름   (누끼까지 딴다)\n');
  process.exit(1);
}

/**
 * **누끼 — 바탕을 지우고 잉크만 남긴다.**
 *
 * ★★사장님 2026-09-10 「되면 **캡처해 가지고 네가 누끼 따서 넣어주는** 형태로 해.
 *   뭐 CI 를 받으면 좋겠지만 뭐 대단한 건 아니잖아」.
 *
 * ★로고 파일을 못 구하면 **화면을 찍어서** 쓴다. 찍은 그림은 바탕(대개 흰색)이 붙어 오므로
 *   그 바탕을 투명으로 만든다 — 그래야 머리띠 색이 바뀌어도 로고가 흰 네모를 안 달고 다닌다.
 * ★바탕색은 **네 귀퉁이에서 뽑는다**(흰 바탕이 아닐 수도 있다).
 * ★가장자리는 «부드럽게» 지운다 — 딱 끊으면 글자 테두리가 톱니처럼 된다.
 *   바탕과 얼마나 다른지(거리)로 반투명을 만든다.
 */
async function knockout(buf: Buffer, hardBg?: string): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const at = (x: number, y: number) => (y * info.width + x) * ch;
  const corners = [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)];
  let bg = [255, 255, 255];
  if (hardBg && /^#[0-9a-fA-F]{6}$/.test(hardBg)) {
    bg = [1, 3, 5].map((i) => parseInt(hardBg.slice(i, i + 2), 16));
  } else {
    bg = [0, 1, 2].map((k) => Math.round(corners.reduce((n, c) => n + data[c + k], 0) / corners.length));
  }
  /* 거리 20 아래는 바탕, 60 위는 잉크, 사이는 반투명 — 톱니를 없애는 띠다. */
  const T0 = 20; const T1 = 60;
  for (let p = 0; p < data.length; p += ch) {
    const d = Math.sqrt((data[p] - bg[0]) ** 2 + (data[p + 1] - bg[1]) ** 2 + (data[p + 2] - bg[2]) ** 2);
    const a = d <= T0 ? 0 : d >= T1 ? 255 : Math.round(((d - T0) / (T1 - T0)) * 255);
    if (ch === 4) data[p + 3] = Math.min(data[p + 3], a);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch as 4 } })
    .png().trim({ threshold: 1 }).toBuffer();
}

const outDir = path.join('tmp', `ci-${key}`);
fs.mkdirSync(outDir, { recursive: true });

const abs = (src: string): string => { try { return new URL(src, url || direct).href; } catch { return ''; } };

const UA = 'Mozilla/5.0 (compatible; freepass-ci/1.0)';

/** 후보 — 어디서 나왔는지까지 들고 있어야 「왜 이걸 골랐나」를 말할 수 있다. */
type Cand = { from: string; src: string };
const cands: Cand[] = [];
const push = (from: string, src?: string | null) => {
  const u = abs(String(src || '').trim());
  if (u && !cands.some((c) => c.src === u)) cands.push({ from, src: u });
};

let themeColor = '';
if (shot) {
  /*
   * 찍은 그림 — 바탕을 지우고(누끼) 여백을 자른 뒤 바로 «쓸 수 있는 것»으로 만든다.
   * ★여기만 `--save` 없이도 바로 넣는다. 후보가 하나뿐이라 고를 것이 없다.
   */
  const raw = fs.readFileSync(shot);
  const cut = await knockout(raw, one('bg'));
  const before = await sharp(raw).metadata();
  const after = await sharp(cut).metadata();
  const dest = path.join('public', 'brand', `${key}-mark.png`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, cut);
  const look = path.join(outDir, 'shot-cut.png');
  fs.writeFileSync(look, cut);
  console.log(`\n✓ 누끼 따서 넣었습니다 — ${dest}`);
  console.log(`   ${before.width}×${before.height}  →  ${after.width}×${after.height} (바탕 지우고 여백까지)`);
  console.log(`   눈으로 볼 파일: ${look}`);
  console.log(`\n  채널 표에 이 줄을 답니다:`);
  console.log(`    logo: { src: '/brand/${key}-mark.png', alt: '<회사 이름>' },`);
  console.log('\n  ⚠ 바탕이 흰색이 아니면 --bg=#RRGGBB 로 알려 주세요.\n');
  process.exit(0);
}
if (direct) {
  /* 주소를 직접 받았으면 페이지를 안 긁는다 — 그 한 장만 재고 자른다. */
  push('직접 준 주소', direct);
} else {
const page = await fetch(url, { headers: { 'user-agent': UA } }).then((r) => r.text());
const $ = cheerio.load(page);

push('og:image', $('meta[property="og:image"]').attr('content'));
push('apple-touch-icon', $('link[rel="apple-touch-icon"]').attr('href'));
$('link[rel~="icon"]').each((_, el) => push('favicon', $(el).attr('href')));
/* 머리(header·nav)의 그림 중 이름에 logo/ci/bi 가 든 것 — 회사들이 대개 이렇게 짓는다. */
$('header img, nav img, a[href="/"] img, .logo img, img').each((_, el) => {
  const s = `${$(el).attr('src') || ''} ${$(el).attr('alt') || ''} ${$(el).attr('class') || ''}`.toLowerCase();
  if (/logo|ci\b|brand|bi_|symbol|emblem/.test(s)) push('머리 그림', $(el).attr('src'));
});
/* 인라인 SVG 는 그대로 떠서 파일로 만든다(가장 깨끗한 원본인 경우가 많다). */
$('header svg, .logo svg, a[href="/"] svg').each((i, el) => {
  const svg = $.html(el);
  if (svg.length > 120) {
    const f = path.join(outDir, `inline-${i}.svg`);
    fs.writeFileSync(f, svg, 'utf8');
    cands.push({ from: '인라인 SVG', src: `file://${f}` });
  }
});

themeColor = $('meta[name="theme-color"]').attr('content') || '';
}

console.log(`\n  ${url || direct}`);
console.log(`  후보 ${cands.length}개 · theme-color ${themeColor || '(없음)'}\n`);

type Row = { n: number; from: string; src: string; file: string; size: string; trimmed: string; color: string };
const rows: Row[] = [];

for (let i = 0; i < cands.length; i++) {
  const c = cands[i];
  const n = i + 1;
  try {
    const buf = c.src.startsWith('file://')
      ? fs.readFileSync(c.src.slice(7))
      : Buffer.from(await (await fetch(c.src, { headers: { 'user-agent': UA } })).arrayBuffer());
    const ext = /\.svg($|\?)/i.test(c.src) || buf.slice(0, 200).toString().includes('<svg') ? 'svg' : 'png';
    const raw = path.join(outDir, `${n}-raw.${ext}`);
    fs.writeFileSync(raw, buf);

    /* ★여백을 «잘라» 본다 — 원본이 아니라 잘린 것을 쓴다(집 규격 §CI). */
    const img = sharp(buf, { density: 512 });
    const meta = await img.metadata();
    const trimmedBuf = await sharp(buf, { density: 512 }).png().trim({ threshold: 10 }).toBuffer();
    const tMeta = await sharp(trimmedBuf).metadata();
    const cut = path.join(outDir, `${n}-cut.png`);
    fs.writeFileSync(cut, trimmedBuf);

    /* 브랜드 색 — 가장 «진한»(채도 높은) 색을 고른다. 회색·검정·흰색은 브랜드가 아니다. */
    const { data, info } = await sharp(trimmedBuf).resize(48, 48, { fit: 'inside' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let best = { s: -1, hex: '' };
    for (let p = 0; p < data.length; p += info.channels) {
      const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3] ?? 255];
      if (a < 200) continue;
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (mx < 30 || mx > 245) continue;                       // 검정·흰색은 건너뛴다
      if (sat > best.s) best = { s: sat, hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
    }
    rows.push({
      n, from: c.from, src: c.src, file: cut,
      size: `${meta.width ?? '?'}×${meta.height ?? '?'}`,
      trimmed: `${tMeta.width ?? '?'}×${tMeta.height ?? '?'}`,
      color: best.s > 0.25 ? best.hex.toUpperCase() : '(무채색)',
    });
  } catch (e) {
    rows.push({ n, from: c.from, src: c.src, file: '(못 받음)', size: '-', trimmed: '-', color: '-' });
  }
}

console.log('   번호  어디서          원본        여백 자른 뒤   색        파일');
for (const r of rows) {
  console.log(`   ${String(r.n).padStart(2)}   ${r.from.padEnd(14)} ${r.size.padEnd(11)} ${r.trimmed.padEnd(13)} ${r.color.padEnd(9)} ${r.file}`);
}

if (!save) {
  console.log(`\n  ★그림을 «눈으로» 보고 고르세요 — ${outDir}\*-cut.png`);
  console.log('   고른 뒤:  npm run channel:ci -- --url=… --key=… --save=<번호>');
  console.log('   ⚠ 가로로 긴 것 = 조합형(이름까지 든 것) · 네모 = 심볼. 간판에는 대개 조합형이 낫습니다.\n');
  process.exit(0);
}

const pick = rows.find((r) => r.n === save);
if (!pick || pick.file === '(못 받음)') { console.error(`✗ ${save}번 후보가 없습니다`); process.exit(1); }
const dest = path.join('public', 'brand', `${key}-mark.png`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(pick.file, dest);

console.log(`\n✓ ${dest} 에 넣었습니다 (여백 자른 것 · ${pick.trimmed})\n`);
console.log('  채널 표에 이 두 줄을 답니다:');
console.log(`    logo: { src: '/brand/${key}-mark.png', alt: '<회사 이름>' },`);
if (pick.color !== '(무채색)') console.log(`    brandColor: '${pick.color}',`);
console.log('\n  ⚠ 넣은 뒤 «화면으로» 한 번 봅니다 — 머리띠에서 작아 보이면 조합형으로 바꿉니다.\n');
