/**
 * 디자인 토큰 가드 — FS/FW + 생 hex/rgba 드리프트 차단.
 *   walk: app/ · components/ · features/
 *   실행: npx tsx scripts/check-tokens.mts   (0=정합 · 1=드리프트)
 *   check:fonts 는 하위호환(오프스케일·800/900만).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

if (hits.length) {
  console.log(`✗ 토큰 드리프트 ${hits.length}건 — FS/FW/C/SH/SCRIM으로 고칠 것:\n\n${hits.join('\n\n')}`);
  process.exit(1);
}
console.log('✓ 토큰 드리프트 0 — FS/FW + hex/rgba 정합성 유지');
process.exit(0);
