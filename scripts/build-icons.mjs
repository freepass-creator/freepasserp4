/**
 * PWA 래스터 아이콘 생성 — `public/icon.svg` → 192/512 PNG + maskable 512.
 *
 * 왜 필요한가: 매니페스트에 SVG 만 있으면 안드로이드 홈화면 추가·스토어 제출에서
 * 아이콘이 비거나 반려된다(check-release 가 192x192·512x512 를 확인한다).
 *
 * maskable 을 따로 만드는 이유: 런처가 아이콘을 원형·squircle 로 잘라내는데,
 * 안전영역 규격상 가장자리 약 10% 가 잘릴 수 있다. `any` 용 이미지를 그대로 쓰면
 * 차 아이콘 가장자리가 먹힌다. 그래서 10% 여백을 준 별도 파일을 만든다.
 *
 * 실행: node scripts/build-icons.mjs   (아이콘 원본을 바꾼 뒤에만 돌리면 된다)
 */
import sharp from 'sharp';
import { readFileSync, statSync } from 'node:fs';

const svg = readFileSync('public/icon.svg');
// density 를 올려야 벡터를 큰 캔버스로 먼저 그린 뒤 축소한다 — 안 그러면 곡선이 계단진다.
const DENSITY = 600;
const PAD_RATIO = 0.1;

const kb = (p) => `${Math.round(statSync(p).size / 1024)}KB`;

for (const size of [192, 512]) {
  const out = `public/icon-${size}.png`;
  await sharp(svg, { density: DENSITY }).resize(size, size).png().toFile(out);
  console.log(`${out}  ${size}x${size}  ${kb(out)}`);
}

const pad = Math.round(512 * PAD_RATIO);
const maskable = 'public/icon-maskable-512.png';
await sharp(svg, { density: DENSITY })
  .resize(512 - pad * 2, 512 - pad * 2)
  // 배경은 아이콘 자체의 라운드 사각형 색과 같게 — 여백이 흰 테두리로 보이면 안 된다.
  .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#1B2A4A' })
  .png()
  .toFile(maskable);
console.log(`${maskable}  512x512 (여백 ${PAD_RATIO * 100}%)  ${kb(maskable)}`);
