/**
 * 디자인 토큰 가드 — FS/FW + 생 hex/rgba 드리프트 차단.
 *   walk: app/ · components/ · features/
 *   실행: npx tsx scripts/check-tokens.mts   (0=정합 · 1=드리프트)
 *   check:fonts 는 하위호환(오프스케일·800/900만).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components', 'features'];

/** FS 6단계 + 컨트롤 웹 sm(12.5). */
const FS_OK = new Set([10, 11, 12, 12.5, 13, 14.5, 16, 18]);
/** FW 토큰 값. */
const FW_OK = new Set([400, 500, 550, 600, 650, 700]);

/**
 * 생 색·그림자가 불가피한 섬 / 메타데이터 / 미사용·장식 원자.
 * (값 변경 없이 가드만 통과 — 토큰 경유 불가·의도적 예외)
 */
const HEX_WHITELIST = new Set([
  'components/ui/tokens.ts',
  'app/globals.css',
  'app/global-error.tsx',
  'app/login/page.tsx',
  'app/layout.tsx',       // themeColor 메타
  'app/manifest.ts',      // PWA 팔레트
  'app/m/page.tsx',       // 모바일 프로모 섬
  'app/sign/[token]/page.tsx', // 서명 잉크·지면(PDF 동일)
  'app/error.tsx',
  'app/not-found.tsx',
  // 차량 도색 계열은 브랜드 토큰이 아니라 실제 데이터 표현용 swatch palette다.
  'components/color-swatch.tsx',
  'components/ContractSign.tsx', // 서명 PNG 흰 지면
  'components/ui/metrics.tsx',   // 미사용 원자 · 장식 숫자 스케일
  'components/ui/overlays.tsx',  // 미사용 원자
]);

const hits: string[] = [];

function rel(p: string) {
  return relative(ROOT, p).replace(/\\/g, '/');
}

/** 라인에서 // 주석 제거(문자열 안 슬래시는 단순 처리 — 가드용). */
function codeOf(ln: string): string {
  const i = ln.indexOf('//');
  if (i < 0) return ln;
  // URL http:// 보호
  if (ln.slice(Math.max(0, i - 5), i).includes(':')) return ln;
  return ln.slice(0, i);
}

function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'data') continue;
      walk(p);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(e.name)) continue;
    const r = rel(p);
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    const allowHex = HEX_WHITELIST.has(r);

    lines.forEach((ln, i) => {
      const raw = ln.trim();
      if (!raw || raw.startsWith('*') || raw.startsWith('/*') || raw.startsWith('//')) return;
      const code = codeOf(ln);

      const fsMatch = code.match(/fontSize:\s*([0-9]+(?:\.[0-9]+)?)\b/);
      if (fsMatch && !allowHex) {
        const n = Number(fsMatch[1]);
        if (!FS_OK.has(n)) {
          hits.push(`  ${r}:${i + 1}\n    FS 6값 외 fontSize 금지 → FS.* (got ${n})\n    → ${raw.slice(0, 120)}`);
        }
      }

      const fwMatch = code.match(/fontWeight:\s*([0-9]+)\b/);
      if (fwMatch && !allowHex) {
        const n = Number(fwMatch[1]);
        if (!FW_OK.has(n)) {
          hits.push(`  ${r}:${i + 1}\n    FW 외 fontWeight 금지 → FW.* (got ${n})\n    → ${raw.slice(0, 120)}`);
        }
      }

      if (!allowHex) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(code) && !/url\(|data:/.test(code)) {
          hits.push(`  ${r}:${i + 1}\n    생 hex 금지 → C.* / CSS var\n    → ${raw.slice(0, 120)}`);
        }
        if (/rgba?\(/.test(code)) {
          hits.push(`  ${r}:${i + 1}\n    생 rgba 금지 → SH.* / SCRIM.* / C.focusRing\n    → ${raw.slice(0, 120)}`);
        }
      }
    });
  }
}

for (const root of ROOTS) walk(join(ROOT, root));

/* ★★0 에 «사선» — 사장님 2026-09-08 「글꼴도 0 에 사선 들어가는 거로 해야 함」.
   뿌리 한 줄(`html{font-feature-settings:'zero' 1}`)이 집 전체를 덮는다.
   ⚠ 그 속성은 **통째로 덮인다** — 어디선가 다시 걸면 그 가지에서 사선이 사라진다.
     그래서 ㉠ 뿌리 줄이 살아 있는지 ㉡ 다시 거는 자리가 생겼는지 둘 다 본다. */
const GLOBALS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
if (!/html\s*\{[^}]*font-feature-settings:\s*'zero'\s*1/.test(GLOBALS)) {
  hits.push(`  app/globals.css\n    0 에 사선이 꺼졌습니다 — html{font-feature-settings:'zero' 1} 한 줄이 집 전체를 덮습니다\n    → 0 과 O 가 같아 보이면 차번·금액을 잘못 읽습니다`);
}
for (const root of ROOTS) {
  const stack = [join(ROOT, root)];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(full); continue; }
      if (!/[.](css|ts|tsx)$/.test(e.name)) continue;
      const r = relative(ROOT, full).split(sep).join('/');
      if (r === 'app/globals.css') continue;
      const src = readFileSync(full, 'utf8');
      /*
       * ★★**예외는 «하나», 그것도 이름으로 안다** — 손님 동은 사선 0 을 쓰지 않는다
       *   (사장님 2026-09-10 「글꼴 숫자에 0 에 사선 없어야 해 여기서는」).
       *   업무동은 차번·계좌를 «대조»하니 사선이 있어야 하고, 손님은 값을 «읽을» 뿐이다.
       *   ⇒ 규격이 뒤집힌 게 아니라 범위가 갈렸다. 그래서 뿌리 줄은 그대로 두고 손님 껍데기만 되돌린다.
       * ⚠ **면제는 파일이 아니라 «그 한 줄»이다.** 같은 파일에서 다른 식으로 다시 걸면 그대로 막힌다 —
       *   면제를 파일 단위로 주면 그 파일이 규칙 밖으로 나가 버린다.
       */
      const SHOP_OFF = ".fp-wl { font-feature-settings: normal; }";
      if (r === 'app/whitelabel.css' && src.includes(SHOP_OFF)) {
        /* ⚠ 주석은 걷고 본다 — 왜 껐는지 «설명»에도 그 낱말이 나온다. 설명까지 위반으로 세면
             제대로 적어 둔 자리가 벌을 받는다. */
        const rest = src.split(SHOP_OFF).join('').replace(/\/\*[\s\S]*?\*\//g, '');
        if (!/font-feature-settings/.test(rest)) continue;
      }
      if (/font-feature-settings/.test(src)) {
        hits.push(`  ${r}\n    font-feature-settings 를 다시 걸었습니다 — 뿌리의 «사선 0» 이 이 가지에서 꺼집니다\n    → 꼭 걸어야 하면 'zero' 1 을 함께 적으세요`);
      }
    }
  }
}

if (hits.length) {
  console.log(`✗ 토큰 드리프트 ${hits.length}건 — FS/FW/C/SH/SCRIM으로 고칠 것:\n\n${hits.join('\n\n')}`);
  process.exit(1);
}
console.log('✓ 토큰 드리프트 0 — FS/FW + hex/rgba 정합성 유지');
process.exit(0);
