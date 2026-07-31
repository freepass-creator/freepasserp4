/**
 * freepasserp4 UI 계측기 — 실제 렌더에서 간격·정렬·넘침을 픽셀로 잰다.
 * 정적 분석으로는 "버튼이 셀 경계에 붙었다" 같은 걸 못 본다. 브라우저가 계산한 값을 그대로 읽는다.
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = 'http://localhost:4005';
const OUT = process.argv[2] || "tmp/ui-audit";
mkdirSync(`${OUT}/shots`, { recursive: true });

/** 화면 정의 — role 은 localStorage 스텁, actions 는 진입 후 조작. */
/** 목록 첫 행 좌표(CSS px) — 셀렉터가 없는 인라인 스타일 행이라 좌표 클릭이 가장 확실하다. */
// 헤더 56 + 툴바 56 = 112 아래가 목록 첫 행. CSS px 기준(스크린샷은 2배라 눈으로 재면 두 배가 된다).
const ROW = { m: [195, 150], d: [260, 150] };

/** 시드 행위자(lib/domain/deal.ts ACTORS)와 같은 세션. 없으면 스코프가 전부 막는다. */
const SESSION = {
  agent:    { uid: 'usr_park',  email: 'park@demo.test',  role: 'agent',    rawRole: 'agent',    name: '박영업',       code: 'usr_park', company_code: '',         agent_channel_code: 'chn_seoul', user_code: 'usr_park' },
  provider: { uid: 'sup_jeil',  email: 'jeil@demo.test',  role: 'provider', rawRole: 'provider', name: '제일오토렌탈', code: 'sup_jeil', company_code: 'sup_jeil', agent_channel_code: '',          user_code: 'sup_jeil' },
  admin:    { uid: 'usr_admin', email: 'admin@demo.test', role: 'admin',    rawRole: 'admin',    name: '관리자',       code: 'usr_admin', company_code: '',        agent_channel_code: '',          user_code: 'usr_admin' },
};

const SCREENS = [
  { id: 'finder',        path: '/',           role: 'agent' },
  { id: 'finder-detail', path: '/',           role: 'agent',    actions: [{ row: 1 }] },
  { id: 'chat',          path: '/chat',       role: 'agent' },
  { id: 'chat-room',     path: '/chat',       role: 'agent',    actions: [{ row: 1 }] },
  { id: 'contract',      path: '/contract',   role: 'agent' },
  { id: 'contract-prog', path: '/contract',   role: 'agent',    actions: [{ row: 1 }, { text: '진행' }] },
  { id: 'contract-docs', path: '/contract',   role: 'agent',    actions: [{ row: 1 }, { text: '서류' }] },
  { id: 'contract-sett', path: '/contract',   role: 'agent',    actions: [{ row: 1 }, { text: '정산' }] },
  { id: 'contract-prov', path: '/contract',   role: 'provider', actions: [{ row: 1 }, { text: '진행' }] },
  { id: 'settlement',    path: '/settlement', role: 'admin' },
  { id: 'settlement-det',path: '/settlement', role: 'admin',    actions: [{ row: 1 }] },
  { id: 'inventory',     path: '/inventory',  role: 'provider' },
  { id: 'inventory-det', path: '/inventory',  role: 'provider', actions: [{ row: 1 }] },
  { id: 'members',       path: '/members',    role: 'admin' },
  { id: 'members-det',   path: '/members',    role: 'admin',    actions: [{ row: 1 }] },
  { id: 'policy',        path: '/policy',     role: 'provider' },
  { id: 'policy-det',    path: '/policy',     role: 'provider', actions: [{ row: 1 }] },
  { id: 'faq',           path: '/faq',        role: 'agent' },
  { id: 'settings',      path: '/settings',   role: 'agent' },
  { id: 'login',         path: '/login',      role: 'agent',    noSeed: true },
  { id: 'signup',        path: '/login',      role: 'agent',    noSeed: true, actions: [{ text: '계정 만들기' }] },
  { id: 'terms',         path: '/terms',      role: 'agent',    noSeed: true },
];

const VIEWPORTS = [
  { key: 'm', width: 390, height: 844, isMobile: true },
  { key: 'd', width: 1440, height: 900, isMobile: false },
];

/** 페이지 안에서 도는 계측 코드. DOM/CSSOM 만 쓴다. */
function measure() {
  const out = { overflowX: null, findings: [], stats: {} };
  const px = (v) => Math.round(v * 10) / 10;
  const se = document.scrollingElement;
  if (se.scrollWidth > se.clientWidth + 1) {
    out.overflowX = { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
  }

  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + e.id; parts.unshift(s); break; }
      const cls = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      parts.unshift(s);
    }
    return parts.join('>');
  };
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };

  const all = [...document.querySelectorAll('body *')].filter(visible);

  // ── A. 행 안 컨트롤의 상하/좌우 여백 비대칭 ──────────────────────────
  const CONTROLS = 'button,input,select,textarea,[role="button"],a[href]';
  const controls = all.filter((e) => e.matches(CONTROLS));
  for (const c of controls) {
    const cr = c.getBoundingClientRect();
    // "행" = 컨트롤보다 눈에 띄게 넓고, 세로로는 비슷한 조상 중 가장 가까운 것
    let row = null;
    for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
      const pr = p.getBoundingClientRect();
      if (pr.width > cr.width * 1.4 && pr.height <= cr.height + 48 && pr.height >= cr.height) { row = p; break; }
      if (pr.height > cr.height + 48) break;
    }
    if (!row) continue;
    const rr = row.getBoundingClientRect();
    const cs = getComputedStyle(row);
    const bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    const top = px(cr.top - (rr.top + bt));
    const bottom = px((rr.bottom - bb) - cr.bottom);
    const left = px(cr.left - (rr.left + bl));
    const right = px((rr.right - br) - cr.right);
    const vAsym = Math.abs(top - bottom);
    const minV = Math.min(top, bottom);
    const hEdge = Math.min(left, right);
    const issues = [];
    if (minV < 2 && rr.height > cr.height + 1) issues.push(`상하여백 ${minV}px(붙음)`);
    if (vAsym > 3) issues.push(`상${top}/하${bottom} 비대칭 ${px(vAsym)}px`);
    if (minV >= 0 && hEdge - minV > 10) issues.push(`가로여백 ${hEdge}px vs 세로 ${minV}px`);
    if (top < -0.5 || bottom < -0.5) issues.push(`행 밖으로 ${px(Math.min(top, bottom))}px 넘침`);
    if (issues.length) {
      out.findings.push({
        kind: 'control-gap', el: path(c), row: path(row), text: label(c),
        rect: { w: px(cr.width), h: px(cr.height) }, rowH: px(rr.height),
        gaps: { top, bottom, left, right }, issues,
      });
    }
  }

  // ── B. 부모 밖으로 실제로 넘친 요소 ─────────────────────────────────
  for (const e of all) {
    const p = e.parentElement; if (!p || p === document.body) continue;
    const pcs = getComputedStyle(p);
    if (pcs.overflow !== 'visible' || pcs.position === 'absolute') continue;
    const er = e.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (getComputedStyle(e).position === 'absolute' || getComputedStyle(e).position === 'fixed') continue;
    const over = px(er.right - pr.right);
    if (over > 2 && pr.width > 40) {
      out.findings.push({ kind: 'overflow', el: path(e), text: label(e), overRight: over, parent: path(p) });
    }
  }

  // ── C. 터치 타깃 ────────────────────────────────────────────────────
  if (window.innerWidth <= 480) {
    for (const c of controls) {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && r.height < 34 && label(c)) {
        out.findings.push({ kind: 'touch-target', el: path(c), text: label(c), h: px(r.height), w: px(r.width) });
      }
    }
  }

  // ── D. 잘릴 텍스트인데 ellipsis 없음 ────────────────────────────────
  for (const e of all) {
    if (e.children.length) continue;
    const cs = getComputedStyle(e);
    if (cs.overflow === 'visible') continue;
    if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && (e.innerText || '').trim()) {
      out.findings.push({ kind: 'clipped-text', el: path(e), text: label(e), scrollW: e.scrollWidth, clientW: e.clientWidth });
    }
  }

  // ── E. 같은 flex 행에서 세로 중심이 어긋난 형제 ─────────────────────
  const flexRows = all.filter((e) => {
    const cs = getComputedStyle(e);
    return cs.display.includes('flex') && !cs.flexDirection.startsWith('column') && e.children.length > 1;
  });
  for (const f of flexRows) {
    const kids = [...f.children].filter(visible);
    if (kids.length < 2) continue;
    const cs = getComputedStyle(f);
    if (cs.alignItems === 'flex-start' || cs.alignItems === 'stretch' || cs.alignItems === 'baseline') continue;
    const mids = kids.map((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2; });
    const spread = px(Math.max(...mids) - Math.min(...mids));
    if (spread > 1.5) {
      out.findings.push({ kind: 'v-align', el: path(f), text: label(f), spread, align: cs.alignItems });
    }
  }

  // ── F. 간격·폰트 인벤토리(리듬 확인용) ──────────────────────────────
  const bag = (k, v) => { (out.stats[k] ||= {}); out.stats[k][v] = (out.stats[k][v] || 0) + 1; };
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.display.includes('flex') || cs.display.includes('grid')) {
      const g = cs.gap || '';
      if (g && g !== 'normal') g.split(' ').forEach((v) => { if (parseFloat(v) > 0) bag('gap', v); });
    }
    ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'].forEach((k) => {
      const v = parseFloat(cs[k]); if (v > 0) bag('padding', v + 'px');
    });
    bag('fontSize', cs.fontSize);
    bag('fontWeight', cs.fontWeight);
    bag('borderRadius', cs.borderTopLeftRadius);
  }

  // ── G. 숫자 컬럼 tabular-nums 누락 ─────────────────────────────────
  for (const e of all) {
    if (e.children.length) continue;
    const t = (e.innerText || '').trim();
    if (!t || t.length < 3) continue;
    const digits = (t.match(/[0-9]/g) || []).length;
    if (digits / t.length < 0.5) continue;
    const cs = getComputedStyle(e);
    if (!/tabular-nums/.test(cs.fontVariantNumeric)) {
      out.findings.push({ kind: 'no-tabular', el: path(e), text: t.slice(0, 20) });
    }
  }

  return out;
}

const browser = await chromium.launch({ channel: 'msedge' });
const report = [];

for (const vp of VIEWPORTS) {
  for (const s of SCREENS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2, isMobile: vp.isMobile, hasTouch: vp.isMobile,
    });
    // 역할 스텁만으로는 부족하다 — canAccessOwnedRecord 가 세션 없으면 scope 'none' 이라
    //  계약·문의·정산이 전부 걸러져 빈 화면이 찍힌다. 시드 행위자와 같은 세션을 넣어 준다.
    const sess = SESSION[s.role];
    await ctx.addInitScript(`try{
      localStorage.setItem('fp4_role', ${JSON.stringify(s.role)});
      localStorage.setItem('fp4_session', ${JSON.stringify(JSON.stringify(sess))});
    }catch(e){}`);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
    const key = `${s.id}-${vp.key}`;
    try {
      // 시드는 홈 진입에서 1회 주입된다 — 상세 화면만 바로 열면 빈 화면이 된다.
      if (!s.noSeed) {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);
      }
      await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      for (const a of s.actions || []) {
        if (a.row) {
          const [x, y] = ROW[vp.key];
          await page.mouse.click(x, y);
        } else if (a.text) {
          await page.getByText(a.text, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
        }
        await page.waitForTimeout(1800);
      }
      // Next 개발 오버레이는 하단바를 가리고 계측도 오염시킨다 — 재기 전에 걷어낸다.
      await page.evaluate(() => { document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()); });
      const m = await page.evaluate(measure);
      await page.screenshot({ path: `${OUT}/shots/${key}.png`, fullPage: true });
      report.push({ key, screen: s.id, path: s.path, role: s.role, vp: vp.key, url: page.url(), errors: errs.slice(0, 6), ...m });
      console.log(`${key}: findings=${m.findings.length} overflowX=${m.overflowX ? 'YES' : '-'} errs=${errs.length}`);
    } catch (e) {
      report.push({ key, screen: s.id, vp: vp.key, fatal: String(e.message).slice(0, 200) });
      console.log(`${key}: FATAL ${String(e.message).slice(0, 120)}`);
    }
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 1), 'utf8');
console.log('\n=== 요약 ===');
const byKind = {};
for (const r of report) for (const f of r.findings || []) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
console.log(JSON.stringify(byKind, null, 1));
console.log('출력:', `${OUT}/audit.json`);
