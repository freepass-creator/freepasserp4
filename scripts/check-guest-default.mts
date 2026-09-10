/**
 * **손님 동 기본 간판을 «일시에» 갈아쳐도 업무동이 안 물드는가.**
 *
 * 사장님 2026-09-09 「프리패스도 화이트라벨처럼 만들어서 **프리패스 기본이 화이트라벨식**이 되게
 * 할 거야」 · 「일단 구현해 놓고 **일시에 갈아치울 수 있게끔** 테스트 충분히 하고」.
 *
 * ## 갈아치는 길은 «하나»뿐이다
 *
 * `lib/whitelabel.ts` 의 **`GUEST_FALLBACK_KEY` 한 줄**. 그 값만 바꾸면 호스트·`?wl=` 어디에도
 * 안 걸린 손님 화면이 전부 그 채널 간판으로 선다. 화면 코드는 한 줄도 안 고친다.
 *
 * ## ⚠ 막아야 하는 «그럴듯한 다른 길»
 *
 * 노브랜드 기본값(`FREEPASS`)에 이름을 채워 넣는 방식이 제일 쉬워 보인다. 그런데 그러면
 * `hasBrand(FREEPASS)` 가 true 가 되고, **업무동 셋이 같은 판정을 쓰고 있어서 같이 물든다** —
 *
 * | 어디 | 무엇을 하나 | 물들면 |
 * |---|---|---|
 * | `middleware.ts` `isShopHome` | 채널 도메인의 `/` 를 `/shop` 으로 rewrite | **로그인 현관이 사라진다** |
 * | `app/layout.tsx` | 브랜드면 업무동 상단바를 안 그린다 | 콕핏에서 상단바가 없어진다 |
 * | `lib/public-access.ts` | 브랜드 호스트의 `/` 를 공개로 연다 | 업무동 첫 화면이 로그인 없이 열린다 |
 *
 * ⇒ 그래서 이 검사가 **벽**을 세운다. 실행 = `npm run check:guest`
 */
import { readFileSync } from 'node:fs';
import {
  FREEPASS, GUEST_FALLBACK_KEY, HOME_IS_SHOP, WHITELABELS,
  hasBrand, hasShopFrame, homeIsShop, resolveGuestWhitelabel, resolveWhitelabel,
} from '../lib/whitelabel';

const root = new URL('../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');

let bad = 0;
const ok = (label: string, note = '') => console.log(`  ✓ ${label.padEnd(34)}${note}`);
const must = (cond: boolean, label: string, why: string) => {
  if (cond) { ok(label); return; }
  bad += 1;
  console.log(`  ✗ ${label.padEnd(34)}${why}`);
};

/*
 * ── ★★sitePath 채널이 «대문 도메인»에 삼켜지지 않는가 ──────────────────
 *
 * ⚠⚠ 2026-09-10 사고. 「프리패스erp.com 얼굴 교체」로 `freepasserp.com` 이 라벨 없는 얼굴의
 *   호스트가 되자, 호스트가 먼저 걸려 `?wl=` 을 아예 안 보게 됐다.
 *   그 순간 도메인이 «없는» 채널 넷이 통째로 사라졌다 — `/freepass` `/haheoho` `/eancar` `/uniauto`
 *   가 전부 노브랜드로 떨어졌다. 사장님 「화이트라벨 만들어 둔 거 다 어디 갔냐」.
 * ★그 넷은 `sitePath` 로 산다 — 미들웨어가 `/shop?wl=<키>` 로 다시 쓴다.
 *   즉 그 `?wl=` 은 손님이 붙인 게 아니라 **우리가 붙인 것**이라 이겨야 한다.
 * ⚠ 다만 «채널 제 도메인»에서는 호스트가 이겨야 한다 — 안 그러면 손님이 주소에 `?wl=` 을 붙여
 *   남의 간판을 씌운다. 그래서 둘 다 잰다.
 */
/*
 * ★★**«우리» 도메인 «전부»에서 잰다 — 한 곳만 재면 다음 도메인에서 또 삼켜진다**(2026-09-10).
 *   ⚠ 여기 `'freepasserp.com'` 이 손으로 박혀 있었다. 같은 날 사장님이 모빌리티닷컴에
 *     간판 단 가게를 매칭하라 하셔서 **우리 얼굴이 둘**이 됐는데, 이 검사는 여전히 한 곳만 봤다 —
 *     새로 받은 도메인에서 채널 넷이 삼켜져도 **초록불이 떴을** 것이다.
 *   ⇒ 표에서 «우리 것»(`self`)의 호스트를 전부 긁어 곱한다. 우리 도메인이 늘어도 검사가 따라온다.
 */
const ourHosts = WHITELABELS.filter((w) => w.self).flatMap((w) => w.hosts);
if (!ourHosts.length) {
  must(false, '우리 도메인이 표에 있다',
    '`self` 채널에 호스트가 하나도 없습니다 — 그러면 이 검사가 아무것도 재지 못합니다.');
}
for (const w of WHITELABELS) {
  if (!w.sitePath) continue;
  const bad = ourHosts.filter((h) => resolveGuestWhitelabel(h, w.key).key !== w.key);
  must(bad.length === 0, `sitePath 채널이 산다 · ${w.sitePath}`,
    bad.length === 0
      ? `${w.key} — 우리 도메인 ${ourHosts.length}곳 전부에서 제 간판이 선다`
      : `${bad.join(' · ')} 에서 ?wl=${w.key} 가 «${resolveGuestWhitelabel(bad[0], w.key).key}» 로 떨어집니다 — 그 채널이 사라진 것입니다`);
}
{
  /* ★협력채널 도메인에서는 호스트가 이긴다 — 재는 대상은 «우리 것이 아닌» 줄이다(`self`). */
  const owner = WHITELABELS.find((w) => w.hosts.length && !w.self);
  if (owner) {
    const other = WHITELABELS.find((w) => w.key !== owner.key && !w.plain);
    const got = resolveGuestWhitelabel(owner.hosts[0], other?.key ?? null);
    must(got.key === owner.key, '채널 도메인에서는 호스트가 이긴다',
      got.key === owner.key
        ? `${owner.hosts[0]} 에 ?wl=${other?.key} 를 붙여도 ${owner.key} 그대로`
        : `${owner.hosts[0]} 에서 ?wl= 로 «${got.key}» 간판을 씌울 수 있습니다`);
  }
}
console.log('\n손님 동 기본 간판 — 갈아쳐도 업무동은 그대로인가\n');

/* ── ① 스위치가 «실재하는» 채널을 가리키나 ─────────────────────────────── */
const dflt = WHITELABELS.find((w) => w.key === GUEST_FALLBACK_KEY);
must(!!dflt, '기본 채널이 표에 있다',
  `GUEST_FALLBACK_KEY='${GUEST_FALLBACK_KEY}' 인데 그런 채널이 없습니다 — 손님이 노브랜드 화면을 봅니다.`);
/*
 * ★★**기본은 «라벨 없음»이어도 된다**(2026-09-10 얼굴 교체). 예전 규칙은 「간판을 가져야 한다」였는데,
 *   그건 기본이 남의 채널(유니오토)이던 때의 말이다. 지금 기본은 `plain` — 라벨이 «없는 것»이
 *   프리패스erp.com 의 정체다. 그래서 묻는 것을 바꾼다: **가게 껍데기를 세우는가.**
 * ⚠ 노브랜드 기본값(`FREEPASS`)이 기본 채널로 들어오는 것은 여전히 막는다 — 그건 껍데기조차 없다.
 */
must(!!dflt && hasShopFrame(dflt), '기본 채널이 «가게»다',
  '껍데기조차 없는 값을 기본으로 두면 손님이 머리띠도 푸터도 없는 화면을 봅니다.');
if (dflt) ok('지금 기본 간판', `${dflt.name} (${dflt.key})`);

/* ── ② 업무동은 «어떤 스위치 값에서도» 노브랜드다 ───────────────────────── */
/*
 * ★이 판정은 `resolveWhitelabel`(호스트 정본)이 한다 — 스위치(`resolveGuestWhitelabel`)와
 *   **다른 함수**다. 그래서 스위치를 갈아쳐도 여기 답은 안 바뀐다.
 */
const WORK_HOSTS = ['freepasserp.com', 'www.freepasserp.com', 'localhost', 'sign.freepasserp.com'];
for (const h of WORK_HOSTS) {
  must(!hasBrand(resolveWhitelabel(h)), `업무동 노브랜드 · ${h}`,
    '이 호스트가 브랜드로 잡히면 로그인 현관이 /shop 으로 다시 쓰이고 상단바가 사라집니다.');
}
must(!hasBrand(FREEPASS), '노브랜드 기본값이 비어 있다',
  'FREEPASS 에 이름·워드마크를 채우면 업무동 셋이 같이 물듭니다(이 파일 머리말의 표).');

/* ── ③ 손님 동은 «반드시» 간판을 얻는다 ─────────────────────────────────── */
for (const h of ['www.freepasserp.com', 'freepasserp.com']) {
  /* ★라벨은 없어도 «가게»여야 한다 — 머리띠·푸터가 서야 손님이 길을 잃지 않는다. */
  must(hasShopFrame(resolveGuestWhitelabel(h)), `손님 동 가게 · ${h}`,
    '손님 화면이 껍데기 없이 떨어지면 머리띠도 푸터도 없는 화면이 나갑니다.');
}

/* ── ④ 업무동 셋이 «손님 판정»을 쓰지 않는다 ────────────────────────────── */
/*
 * ⚠ 여기가 진짜 벽이다. 누군가 `middleware`·`layout`·`public-access` 에서
 *   `resolveWhitelabel` 을 `resolveGuestWhitelabel` 로 바꾸면, 스위치를 갈아치는 순간
 *   **업무동이 통째로 손님 가게가 된다.** 소스에서 직접 막는다.
 */
const GUARDS: [string, string][] = [
  ['middleware.ts', '채널 도메인 첫 화면 판정(isShopHome)'],
  ['app/layout.tsx', '업무동 상단바 판정'],
  ['lib/public-access.ts', '업무동 첫 화면 공개 판정'],
];
for (const [file, what] of GUARDS) {
  const src = read(file);
  const guestUse = /resolveGuestWhitelabel\s*\(\s*(?:hdrs\.get\('host'\)|host|window\.location\.host)/.test(src);
  /* ★layout 은 «손님 라우트일 때만» 손님 판정을 쓴다(x-fp-guest). 그건 정상이라 걸러 낸다. */
  const guarded = file === 'app/layout.tsx' ? /x-fp-guest/.test(src) : true;
  must(!guestUse || guarded, `업무동 판정 유지 · ${file}`,
    `${what} 이 손님 기본값을 타면 스위치를 갈아칠 때 업무동까지 물듭니다.`);
}

/* ── ⑤ 표 자체가 성한가 — 키·주소 중복 ─────────────────────────────────── */
const keys = WHITELABELS.map((w) => w.key);
must(new Set(keys).size === keys.length, '채널 키가 안 겹친다',
  `?wl= 미리보기가 엉뚱한 채널을 엽니다 — ${keys.join(' · ')}`);
const paths = WHITELABELS.map((w) => w.sitePath).filter(Boolean) as string[];
must(new Set(paths).size === paths.length, '채널 주소가 안 겹친다',
  `한 주소가 두 채널을 가리키면 미들웨어가 먼저 걸린 쪽만 엽니다 — ${paths.join(' · ')}`);
const hosts = WHITELABELS.flatMap((w) => w.hosts.map((h) => h.toLowerCase()));
must(new Set(hosts).size === hosts.length, '채널 호스트가 안 겹친다',
  '같은 도메인을 두 채널이 적어 두면 표 순서가 브랜드를 정합니다.');

/* ── ⑥ 채널 호스트는 제 채널로 간다 ────────────────────────────────────── */
for (const wl of WHITELABELS) {
  for (const h of wl.hosts) {
    const got = resolveWhitelabel(h);
    must(got.key === wl.key, `호스트 판정 · ${h}`,
      `${wl.key} 여야 하는데 ${got.key} 로 갔습니다.`);
  }
}

/* ── ⑥-2 라벨 없는 얼굴 — «가게»지만 «이름»은 없다 ───────────────────────── */
/*
 * 사장님 2026-09-09 「화이트라벨은 회사 라벨이 붙는 거고, **프리패스erp.com 기본은 라벨이 없는 거**지.
 * 그걸 일단 모빌리티.com 에 구현해 놓고 도메인갈이 하자고」 · 「들어왔을 때 **브랜드 안 떠야 함**」.
 */
const plains = WHITELABELS.filter((w) => w.plain);
console.log(`
  ── 라벨 없는 얼굴 ${plains.length}벌`);
for (const w of plains) {
  must(!hasBrand(w), `라벨이 없다 · ${w.key}`,
    '이름·워드마크가 있으면 그건 화이트라벨이지 «기본 얼굴»이 아닙니다.');
  must(hasShopFrame(w), `껍데기는 선다 · ${w.key}`,
    '머리띠·푸터가 없으면 검색·조건·연락처가 갈 데가 없습니다(사장님 「상단바를 없앨 수는 없으니까」).');
  must(w.hosts.length > 0 || !!w.sitePath, `열 주소가 있다 · ${w.key}`,
    '호스트도 주소도 없으면 아무도 그 얼굴을 볼 수 없습니다.');
}
/*
 * ★★**업무동 기본값과 «다른 것»이다.** 둘을 한 값으로 합치면 로그인 현관이 사라진다 —
 *   `FREEPASS` 는 콕핏이라 껍데기조차 없고, `plain` 은 가게라 껍데기가 있다.
 */
must(!hasShopFrame(FREEPASS), '업무동 기본값에는 껍데기가 없다',
  'FREEPASS 에 plain 을 달면 freepasserp.com/ 이 가게로 바뀌어 로그인 현관이 사라집니다.');

/* ── ⑦ 진화 스위치 ② — `freepasserp.com/` 를 가게로 바꿀 준비가 돼 있나 ────── */
/*
 * 사장님 2026-09-09 「우리 링크 … 그게 **메인 프리패스erp.com 으로 진화**하자. 준비를 명확하게」.
 * 여기서 지키는 것은 **켠 뒤에도 «들어갈 문»이 남는가**다.
 */
console.log(`\n  ── 진화 스위치 ② · HOME_IS_SHOP = ${HOME_IS_SHOP}`);
must(homeIsShop('uniautofreepass.com'), '채널 도메인 첫 화면 = 가게',
  '채널 도메인은 스위치와 무관하게 가게여야 합니다(2026-09-05 확정).');
/*
 * ★★**호스트가 스위치보다 «먼저»다**(2026-09-10). ERP 도메인을 `plain` 의 `hosts` 에 적어
 *   얼굴을 교체했으므로, 그 도메인은 스위치와 «무관하게» 가게다.
 *   ⇒ 스위치는 이제 「표에 «없는» 호스트」만 정한다. 그것으로 검사를 바꾼다.
 * ★그래서 Vercel 미리보기 주소는 여전히 로그인 현관이다 — 옛 얼굴을 확인할 길이 남는다.
 */
must(homeIsShop('freepasserp.com'), 'ERP 도메인 첫 화면 = 가게',
  '얼굴을 교체했는데 첫 화면이 가게가 아닙니다 — plain 의 hosts 를 확인하세요.');
must(homeIsShop('some-preview.vercel.app') === HOME_IS_SHOP, '표에 없는 호스트는 스위치가 정한다',
  '표에 없는 호스트가 스위치와 다르게 굴면, 미리보기 주소에서 옛 얼굴을 확인할 수 없습니다.');

/*
 * ★★**로그인 길은 스위치와 무관하다.** 이게 막히면 켠 순간 아무도 업무 화면에 못 들어온다.
 *   `/` 말고 다른 경로까지 가게로 다시 쓰면 그 순간 문이 잠긴다.
 */
const mw = read('middleware.ts');
must(/pathname === '\/'\s*&&\s*homeIsShop\(host\)/.test(mw), '가게 판정은 «루트에서만»',
  '`/` 말고 다른 경로까지 가게로 다시 쓰면 로그인·업무 화면이 통째로 사라집니다.');
must(/isShopHome\(host[\s\S]{0,600}?GUEST_HEADER,\s*'1'/.test(mw), '첫 화면 다시쓰기에 손님 표시',
  '표시를 안 붙이면 겉은 가게인데 메타·JSON-LD 는 업무동 것이 실려 나갑니다(2026-09-06 사고).');

must(/homeIsShop/.test(read('lib/public-access.ts')), '공개 판정도 같은 함수를 본다',
  '미들웨어와 게이트가 각자 계산하면 «서버는 가게 · 게이트는 로그인»인 반쪽 상태가 납니다.');

must(!/homeIsShop/.test(read('app/layout.tsx')), '루트 레이아웃은 호스트로 안 정한다',
  '레이아웃이 이 판정을 쓰면 스위치를 켠 순간 업무동 «전 층»에서 상단바가 사라집니다.');

console.log(
  bad === 0
    ? '\n✅ 스위치 한 줄로 갈아쳐도 업무동은 그대로다 — 손님 동만 갈린다\n'
    : `\n⛔ ${bad}건 — 이대로 갈아치면 업무동이 물들거나 손님이 빈 간판을 봅니다\n`,
);
process.exit(bad === 0 ? 0 : 1);
