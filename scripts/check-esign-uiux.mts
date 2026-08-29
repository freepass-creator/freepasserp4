/**
 * 전자계약 손님 화면의 «생김새» 점검 — 정본은 `docs/ESIGN-UIUX-SPEC.md`.
 *
 * ★왜 필요한가: 이 화면은 기능(코덱스)과 생김새(Claude)를 나눠 만진다.
 *   기능을 고치다 보면 그릇이 조용히 바뀐다 — 실제로 하루 사이에
 *   ① 셸이 통째로 ERP 얼굴로 돌아갔고 ② 배럴 미연결로 화면이 500 이 났고
 *   ③ 파란 안내 박스가 12개까지 늘었다(2026-08-29).
 *   눈으로는 «좀 달라졌네»로만 보인다. 여기서 잡는다.
 *
 * ⚠ 이 검사는 «생김새»만 본다. 값이 오가는 길은 `sim-esign-*` 들이 본다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('app/sign/[token]/page.tsx', 'utf8');
const css = readFileSync('components/sign/sign.css', 'utf8');
const atoms = readFileSync('components/sign/atoms.tsx', 'utf8');
const icon = readFileSync('public/icon.svg', 'utf8');

const ok = (label: string, fn: () => void) => { fn(); console.log(`  ✓ ${label}`); };

// ── ① 그릇 — 순서와 이름
ok('그릇이 착한거래 규격이다', () => {
  // 부작용 import 라 `from` 이 없다 — 경로만 본다
  assert.match(page, /import '@\/components\/sign\/sign\.css'/, 'sign.css 를 안 물렸습니다 — ERP 얼굴로 돌아갑니다');
  assert.match(page, /className="sign-root sign-page"/, '.sign-root.sign-page 가 없습니다');
  assert.match(page, /className="sign-frame"/, '.sign-frame 이 없습니다');
  assert.match(page, /className="c-head compact"/, '남색 머리(.c-head)가 없습니다');
  assert.match(page, /className="steps has-labels"/, '진행 막대(.steps)가 없습니다');
  assert.match(page, /className=["'`{][^"'`]*c-body/, '몸통(.c-body)이 없습니다');
  assert.match(page, /className=\{`c-footer/, '하단 CTA(.c-footer)가 없습니다');
});

// ── ② 진행 막대 마크업 — 규격은 .s-wrap > .s + .s-label
ok('진행 막대 마크업이 규격이다', () => {
  assert.match(page, /className="s-wrap"/, '.s-wrap 이 없습니다 — 막대가 큰 글씨로 깨집니다');
  assert.match(page, /className=\{`s\$\{/, '.s(막대)가 없습니다');
  assert.match(page, /className=\{`s-label\$\{/, '.s-label(글자)이 없습니다');
});

// ── ③ 제목은 «문장»이다
ok('제목이 이름이 아니라 문장이다', () => {
  assert.match(page, /function stepHeadline/, 'stepHeadline 이 없습니다');
  assert.match(page, /고객님, 아래 계약이 맞습니까\?/,
    '첫 화면 제목이 문장이어야 합니다 — 하단 「맞습니다. 계속하기」와 짝입니다');
  assert.match(page, /맞습니다\. 계속하기/, '하단 버튼 글이 물음의 답이어야 합니다');
});

// ── ④ 파란 안내 박스를 쌓지 않는다
ok('설명을 파란 박스로 쌓지 않는다', () => {
  const info = (page.match(/<Message variant="info"/g) || []).length;
  assert.equal(info, 0,
    `설명용 파란 박스가 ${info}개 있습니다. 규격은 셋뿐입니다 —\n`
    + '    막혔다=warning · 끝났다=success · 그 밖 설명=SignFootnote(※)');
});

// ── ④' 손님한테 쓰지 않는 말
ok('손님 화면에 「셀카」가 없다', () => {
  /* 「셀카」는 손님한테 쓸 말이 아니다(사장님 2026-08-28).
     ⚠ 오늘만 세 번 되살아났다 — 화면을 다시 지을 때마다 옛말이 돌아온다.
       동의서 옆줄이 「운전면허증 사진」이라 「본인 얼굴 사진」이 짝이다. */
  const bad = (page.match(/셀카/g) || []).length;
  assert.equal(bad, 0, `손님 화면에 「셀카」가 ${bad}곳 있습니다 — 「본인 얼굴 사진」으로 씁니다`);
});

// ── ⑤ 체크는 CI 좌표 하나
ok('체크가 CI 정본과 같은 좌표다', () => {
  const path = /M128 264 l80 80 L384 168/;
  assert.match(icon, path, 'public/icon.svg 의 좌표가 바뀌었습니다');
  assert.match(page, path, '손님 화면의 체크가 CI 와 다른 좌표입니다');
  assert.match(css, /border-radius:18\.75%/, 'CI 라운드(96/512=18.75%)가 아닙니다');
  assert.match(page, /strokeWidth="52"/, 'CI 획(52/512)이 아닙니다');
  // 머리 위에서는 반전 — 흰 네모 + 남색 체크
  assert.match(css, /\.brand-mark\{[^}]*background:#fff[^}]*color:var\(--navy\)/,
    '머리 마크는 «흰 네모 + 남색 체크»여야 합니다(대비 14.1:1). 스카이+흰 체크는 1.8:1 로 뭉갭니다');
});

// ── ⑥ 원자에 색·크기 상수를 두지 않는다
ok('원자에 생 hex 가 없다', () => {
  const hex = atoms.match(/#[0-9a-fA-F]{6}\b/g) || [];
  assert.deepEqual(hex, [],
    `atoms.tsx 에 생 hex 가 ${hex.length}곳 있습니다: ${hex.slice(0, 4).join(' ')}\n`
    + '    색은 sign.css 의 .sign-root 가 한 번만 얹습니다');
});

// ── ⑦ .c-body 를 flex 로 만들지 않는다 (판이 찌그러진다)
ok('.c-body 안을 flex 로 만들지 않았다', () => {
  const bridge = css.match(/\.sign-root \.c-body\.erp-bridge\{([^}]*)\}/);
  if (bridge) {
    assert.doesNotMatch(bridge[1], /display:flex/,
      'erp-bridge 를 flex 로 두면 자식이 줄어들어 판이 찌그러집니다(실측 346×2)');
  }
});

// ── ⑧ 옮기는 중임을 잊지 않게 — 남은 ERP 원자를 센다(막지는 않는다)
const LEFT = ['Message', 'Btn', 'ButtonLabel', 'Dropzone', 'Checkbox', 'Badge'] as const;
/* ⚠ `<Name` 뒤에 «줄바꿈»이 오는 것도 센다. `[ />]` 만 보면 여러 줄로 쓴 것을 놓쳐
   «다 걷었다»는 헛수치가 나온다(2026-08-29: 7개를 3개로 셌다). */
const left = LEFT.map((name) => [name, (page.match(new RegExp(`<${name}(?![A-Za-z])`, 'g')) || []).length] as const)
  .filter(([, n]) => n > 0);
const bridged = /className=["'`{][^"'`]*c-body[^"'`]*erp-bridge/.test(page);
console.log('');
if (left.length) {
  console.log(`  · 아직 ERP 원자 ${left.reduce((a, [, n]) => a + n, 0)}개 — ${left.map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log('    바꿀 것은 docs/ESIGN-UIUX-SPEC.md §4');
  assert.ok(bridged, '.c-body 에 erp-bridge 가 없는데 ERP 원자가 남아 있습니다 — 여백이 0 이 되어 겹칩니다');
} else {
  assert.ok(!bridged,
    'ERP 원자를 다 걷었는데 erp-bridge 가 남아 있습니다 — 여백이 두 벌이 됩니다. 클래스를 떼 주세요');
  console.log('  · ERP 원자 0개 — 완전히 착한거래 규격입니다');
}

console.log('\n✓ 전자계약 손님 화면 UI·UX 규격 (docs/ESIGN-UIUX-SPEC.md)');
