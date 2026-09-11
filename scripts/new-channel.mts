/**
 * **새 채널 한 줄을 찍어 낸다** — 「말하면 바로」.
 *
 * ★★사장님 2026-09-10 「이제 **여러 개를 좀 만들 거야.** 그러니까 그거를 딱 얘기하면
 *   **바로바로 만들 수 있게끔** 준비를 좀 해줘」.
 *
 * ## 왜 도구로 만드나
 *
 * 채널 하나는 «표에 줄 하나»다(`lib/whitelabel.ts`). 그런데 그 줄에 들어가는 칸이 열댓 개고,
 * 그중 **틀리면 조용히 사고가 나는 칸**이 셋 있다:
 *   ㉠ `key` 중복        — 나중 줄이 먼저 줄을 덮어 «남의 간판»이 뜬다.
 *   ㉡ `hosts` 중복       — 한 주소가 두 채널을 가리키면 어느 쪽이 뜰지 아무도 모른다.
 *   ㉢ `providerCode` 오타 — 목록이 **통째로 0건**이 된다(그 칸 머리말의 그 사고).
 * ⇒ 손으로 베끼지 않는다. 받아 적고 «검사»까지 여기서 한다.
 *
 * ## 쓰는 법
 *
 * ```
 *   npm run channel:new -- --key=uniplan --name=유니오토모빌 --tel=1800-6454 \
 *     --color=#1D4ED8 --biz="(주)유니오토모빌 · 대표 김다훈 · 사업자등록번호 000-00-00000" \
 *     --biz="주소 · 통신판매업신고 0000-어디-0000" --biz="고객상담 1800-6454"
 *
 *   덧붙일 수 있는 것 — --provider=RP031  --headline="지금 바로 출고 가능한 차량입니다"
 *                      --host=eancar.freepasserp.com   --dry
 * ```
 * `--dry` 면 줄만 찍고 파일은 안 건드린다(먼저 눈으로 보고 넣을 때).
 *
 * ## 안 하는 것
 *
 * ★**간판 그림(CI)은 안 만든다.** 로고는 «재서» 넣는 것이라(`docs/DESIGN_CONFIRMED_SHOP.md`
 *   §CI) 자동으로 지어내면 남의 상표를 우리가 자르는 꼴이 된다. 파일을 받으면 그때 `logo` 를 단다.
 * ★**빠른조건·축은 비워 둔다.** 안 적으면 집 기본이고, 그게 맞는 출발점이다 —
 *   그 채널 재고를 보고 정하는 값이라 만들 때 알 수 없다(화면에서 고칠 수 있다).
 */
import fs from 'node:fs';

const WL = 'lib/whitelabel.ts';
const args = process.argv.slice(2);
const one = (k: string): string => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3).trim() : '';
};
const many = (k: string): string[] =>
  args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3).trim()).filter(Boolean);
const has = (k: string) => args.includes(`--${k}`);

const key = one('key');
const name = one('name');
const tel = one('tel');
const color = one('color');
const biz = many('biz');
const hosts = many('host');
const provider = one('provider');
const headline = one('headline');

const missing = [
  !key && '--key (내부 이름 · 영문소문자)',
  !name && '--name (간판에 설 회사 이름)',
  !tel && '--tel (손님 상담 번호)',
  !color && '--color (브랜드 색 · #RRGGBB)',
  !biz.length && '--biz (푸터 사업자 줄 · 여러 번 줄 수 있다)',
].filter(Boolean) as string[];

if (missing.length) {
  console.error('\n✗ 빠진 것이 있습니다 — 이것만 주시면 바로 만듭니다\n');
  for (const m of missing) console.error(`   · ${m}`);
  console.error('\n  보기:');
  console.error('   npm run channel:new -- --key=eancar --name=이안카 --tel=1899-9199 --color=#DE3536');
  console.error('     --biz="(주)이안카 · 대표 ○○○ · 사업자등록번호 000-00-00000" --biz="주소 · 통신판매업신고 0000-○○-0000"');
  console.error('');
  process.exit(1);
}

const src = fs.readFileSync(WL, 'utf8');

/* ㉠㉡ 겹치면 «조용히» 남의 간판이 뜬다 — 넣기 전에 막는다. */
const fail: string[] = [];
if (!/^[a-z][a-z0-9]*$/.test(key)) fail.push(`key 는 영문 소문자·숫자만 — 받은 값 「${key}」`);
if (new RegExp(`key: '${key}'`).test(src)) fail.push(`key 「${key}」 는 이미 표에 있습니다`);
if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail.push(`color 는 #RRGGBB — 받은 값 「${color}」`);
for (const h of hosts) if (src.includes(`'${h}'`)) fail.push(`host 「${h}」 는 이미 다른 채널이 씁니다`);
if (provider && !/^[A-Z]{2}\d{3}$/.test(provider)) {
  fail.push(`provider 는 RP031 꼴입니다 — 받은 값 「${provider}」 (틀리면 목록이 통째로 0건이 됩니다)`);
}
if (fail.length) {
  console.error('\n✗ 이대로 넣으면 사고가 납니다\n');
  for (const f of fail) console.error(`   · ${f}`);
  console.error('');
  process.exit(1);
}

const q = (s: string) => `'${s.replace(/'/g, "\'")}'`;
const row = [
  '  {',
  `    key: ${q(key)},`,
  `    sitePath: '/${key}',`,
  hosts.length
    ? `    hosts: [${hosts.map(q).join(', ')}],\n    domainReady: false,`
    : `    /* 도메인을 사면 여기 적고 domainReady 를 켠다 — 그전까지 주소는 sitePath 다. */\n    hosts: [],`,
  `    name: ${q(name)},`,
  '    /* 간판 그림은 파일을 받은 «뒤에» 단다(없는 마크를 지어내지 않는다). */',
  '    // logo: { src: \'/brand/○○-mark.png\', alt: ' + q(name) + ' },',
  `    wordmark: { main: ${q(name)}, sub: '' },`,
  `    brandColor: ${q(color)},`,
  `    tel: ${q(tel)},`,
  headline ? `    headline: ${q(headline)},` : null,
  '    bizLines: [',
  ...biz.map((b) => `      ${q(b)},`),
  '    ],',
  provider
    ? `    /* 이 공급사 차만 판다 — 영업채널이면 이 줄을 지운다(재고 전체를 제 이름으로 판다). */\n    providerCode: ${q(provider)},`
    : '    /* 영업채널이라 재고 전체를 판다 — providerCode 를 비워 둔다. */',
  '    /* 빠른조건·축은 안 적는다 = 집 기본. 그 채널 재고를 보고 화면에서 고친다. */',
  '  },',
].filter((l) => l !== null).join('\n');

if (has('dry')) {
  console.log(`\n  ${WL} 의 WHITELABELS 에 이 줄을 넣습니다 (--dry 라 안 넣었습니다)\n`);
  console.log(row);
  console.log('');
  process.exit(0);
}

/*
 * 표의 «맨 끝»에 붙인다 — 순서가 판정에 안 쓰이므로(호스트로 찾는다) 뒤가 안전하다.
 * ⚠ 줄바꿈에 매이지 않는다. 이 파일은 CRLF 라 `'\n];\n'` 으로 찾으면 **못 찾는다**
 *   (처음에 그렇게 짰다가 「배열 끝을 못 찾았습니다」로 떨어졌다).
 */
const m = /\r?\n\];\r?\n/.exec(src.slice(src.indexOf('export const WHITELABELS')));
const at = m ? src.indexOf('export const WHITELABELS') + m.index : -1;
const nl = src.includes('\r\n') ? '\r\n' : '\n';
if (at < 0) { console.error('✗ WHITELABELS 배열의 끝을 못 찾았습니다 — 손으로 넣으세요'); process.exit(2); }
/* 넣는 줄도 그 파일의 줄바꿈을 쓴다 — 한 파일에 두 꼴이 섞이면 다음 diff 가 통째로 붉어진다. */
fs.writeFileSync(WL, `${src.slice(0, at)}${nl}${row.split('\n').join(nl)}${src.slice(at)}`, 'utf8');

console.log(`\n✓ 채널 「${name}」(${key}) 을 표에 넣었습니다\n`);
console.log(`   주소      https://www.freepasserp.com/${key}`);
console.log(`   미리보기  https://www.freepasserp.com/shop?wl=${key}`);
console.log('\n  남은 것');
console.log('   1. 간판 그림(CI) 을 받으면 `logo` 줄을 켠다 — 여백 잘라 넣는 규격은 DESIGN_CONFIRMED_SHOP §CI');
console.log('   2. 통신판매업신고 번호가 오면 bizLines 에 채운다');
console.log('   3. npm run check:design && npm run build 로 확인하고 PR');
console.log('   ★빠른조건은 화면에서 고친다 — 코드를 다시 안 고쳐도 된다\n');
