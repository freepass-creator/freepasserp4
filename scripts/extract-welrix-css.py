# -*- coding: utf-8 -*-
"""웰릭스 index.html 의 <style> 을 **그대로** 떠 와서 `.wx-root` 안에만 살도록 가둔다.
   규칙은 한 글자도 고치지 않는다 — 선택자 앞에 뿌리만 붙인다(`body`/`:root`/`html` 은 뿌리로 치환).
   왜 — 견적 화면은 ERP 껍데기(상단바·전체메뉴) 안에 서므로, 웰릭스의 전역 리셋(`*`,`body`,`select`)이
        그대로 풀리면 ERP 전체가 웰릭스 톤으로 바뀐다. 가두면 원본 그대로 쓰면서 밖으로 안 샌다.
"""
import io, re, sys

SRC = r'C:\dev\welrixtable\index.html'
ROOT = '.wx-root'

html = io.open(SRC, encoding='utf-8').read()
blocks = re.findall(r'<style([^>]*)>(.*?)</style>', html, re.S)
# 4번(id=simple-mode-overrides)은 웰릭스의 «단순 견적 모드» 토글이라 우리 몫이 아니다 — 뺀다.
css = '\n'.join(b for a, b in blocks if 'simple-mode-overrides' not in a)

def split_top(sel):
    """콤마로 나누되 괄호 안 콤마(:is(), :not())는 안 나눈다."""
    out, buf, d = [], '', 0
    for ch in sel:
        if ch == '(': d += 1
        elif ch == ')': d -= 1
        if ch == ',' and d == 0:
            out.append(buf); buf = ''
        else:
            buf += ch
    out.append(buf)
    return out

def one(sel):
    s = sel.strip()
    if not s:
        return s
    if s in (':root', 'html', 'body'):
        return ROOT
    for tag in ('body', 'html'):
        if s.startswith(tag) and (len(s) == len(tag) or s[len(tag)] in '.:[ >+~,'):
            rest = s[len(tag):]
            return ROOT + rest if rest[:1] in '.:[' else ROOT + rest
    return ROOT + ' ' + s

def prefix(sel):
    """앞머리 주석·공백은 «그 자리에» 두고, 진짜 선택자에만 뿌리를 붙인다.
       (안 그러면 `.wx-root /* 주석 */ .foo` 가 되어 주석이 자손 결합자를 먹는다.)"""
    m = re.match(r'^(?:\s|/\*.*?\*/)*', sel, re.S)
    keep, body = m.group(0), sel[m.end():]
    return keep + ', '.join(one(p) for p in split_top(body))

def walk(s, in_keyframes=False):
    res, buf, i, n = [], '', 0, len(s)
    while i < n:
        if s[i] == '/' and s[i:i+2] == '/*':
            j = s.find('*/', i + 2)
            j = n if j < 0 else j + 2
            buf += s[i:j]; i = j; continue
        if s[i] == '{':
            d, j = 0, i
            while j < n:
                if s[j] == '/' and s[j:j+2] == '/*':
                    k = s.find('*/', j + 2); j = n if k < 0 else k + 2; continue
                if s[j] == '{': d += 1
                elif s[j] == '}':
                    d -= 1
                    if d == 0: break
                j += 1
            inner, prelude = s[i+1:j], buf
            buf = ''
            # 앞머리 주석을 떼고 봐야 `/* .. */ @media print` 을 at-rule 로 알아본다.
            p = re.sub(r'^(?:\s|/\*.*?\*/)*', '', prelude, flags=re.S).strip()
            if in_keyframes:
                res.append(prelude + '{' + inner + '}')
            elif p.startswith('@'):
                name = re.match(r'@([a-zA-Z-]+)', p).group(1).lower()
                if name in ('media', 'supports', 'container', 'layer', 'scope'):
                    res.append(prelude + '{' + walk(inner) + '}')
                elif name in ('keyframes', '-webkit-keyframes'):
                    res.append(prelude + '{' + walk(inner, True) + '}')
                else:                      # @font-face, @page …
                    res.append(prelude + '{' + inner + '}')
            else:
                res.append(prefix(prelude) + '{' + inner + '}')
            i = j + 1; continue
        if s[i] == ';' and buf.lstrip().startswith('@'):
            res.append(buf + ';'); buf = ''; i += 1; continue
        buf += s[i]; i += 1
    res.append(buf)
    return ''.join(res)

# 컴포넌트 안에만 있던 <style scoped> 도 같이 뜬다 — index.html 에 없어서 안 뜨면
# `.cs-form`(손님·담당자 줄)·`.ref-pct`(기본견적 % 글씨)가 «맨몸»으로 서게 된다.
SFC = ['src/components/CustomerStaffForm.vue', 'src/components/ReferenceGrid.vue']
for rel in SFC:
    v = io.open('C:/dev/welrixtable/' + rel, encoding='utf-8').read()
    for m in re.findall(r'<style[^>]*>(.*?)</style>', v, re.S):
        css += chr(10) + '/* -- 원본 ' + rel + ' 의 <style scoped> -- */' + chr(10) + m

out = walk(css)
head = r"""/* ─────────────────────────────────────────────────────────────────────────
 * 웰릭스 견적기 화면 — **원본 그대로 옮긴 CSS**
 *   원천 : C:\dev\welrixtable/index.html 의 <style> 넷 (2026-09-07 기준)
 *   뜬 법 : scripts/extract-welrix-css.py — 규칙은 «한 글자도» 고치지 않고 선택자 앞에 `.wx-root` 만 붙였다.
 *           (`body`·`html`·`:root` 는 `.wx-root` 로 치환 · `*` 는 `.wx-root *`)
 *   왜   : 견적은 ERP 껍데기 «안»에 서는 페이지다. 웰릭스 전역 리셋이 풀리면 ERP 전체가 물든다.
 *   ⚠ 이 파일을 손으로 고치지 마라. 원본이 바뀌면 위 스크립트를 다시 돌린다.
 *     우리 사정(껍데기 높이 등)으로 덮을 것은 맨 아래 「프리패스 덧칠」에만 적는다.
 * ───────────────────────────────────────────────────────────────────────── */
"""
tail = """

/* ══ 프리패스 덧칠 — 원본을 «고치지 않고» 우리 껍데기에 맞추는 것만 ══════════ */
/* 원본은 body 가 곧 판이라 100vh 였다. 우리는 ERP 상단바 밑에 선다. */
.wx-root { height: calc(100vh - var(--topbar-h, 0px)); }

/* 왼쪽 칸 짜임 — 원본은 `#sec-manufacturer…` 넷에만 「라벨 96 + 한 줄」을 걸어 뒀다.
   우리가 새로 세운 칸(상품·채널·만기·신용)도 **같은 줄**에 서야 한다
   (사장님 2026-09-08 「저렇게 굵을 필요 없고」). 원본 규칙은 안 건드리고 이름만 보탠다. */
@media (min-width: 1025px) {
  .wx-root #sec-source, .wx-root #sec-channel, .wx-root #sec-type, .wx-root #sec-credit {
    display: grid !important; grid-template-columns: 96px 1fr;
    align-items: center; column-gap: 12px; row-gap: 4px; padding: 12px 0 !important;
  }
  .wx-root #sec-source > .step-title, .wx-root #sec-channel > .step-title,
  .wx-root #sec-type > .step-title, .wx-root #sec-credit > .step-title {
    grid-column: 1; margin-bottom: 0 !important; white-space: nowrap;
  }
  .wx-root #sec-source > *:not(.step-title), .wx-root #sec-channel > *:not(.step-title),
  .wx-root #sec-type > *:not(.step-title), .wx-root #sec-credit > *:not(.step-title) {
    grid-column: 2; min-width: 0;
  }
}

/* 머리 토글 「견적내기 / 원가설정」 — 사장님 2026-09-08 「원가설정에는 왜 «밑줄»이 가져 있지?」
   ⇒ 링크(`<a>`)라 밑줄이 그어졌고, 옆 버튼과 높이가 달라 줄이 안 맞았다. 한 덩이로 묶고 밑줄을 없앤다.
   ★견적·원가 **두 화면이 같은 것을 쓴다** — 한쪽만 고치면 또 어긋난다. */
.wx-root .gt-modes { display: inline-flex; border: 1px solid var(--line-2); border-radius: var(--r-sm); overflow: hidden; }
.wx-root .gt-modes > * {
  display: inline-flex; align-items: center; justify-content: center;
  height: 28px; padding: 0 14px; font-size: 12px; font-weight: 500; font-family: inherit;
  color: var(--ink-3); background: var(--bg); border: 0; cursor: pointer;
  text-decoration: none;
  white-space: nowrap; letter-spacing: -0.2px;
}
.wx-root .gt-modes > * + * { border-left: 1px solid var(--line-2); }
.wx-root .gt-modes > *:hover { background: var(--accent-soft); color: var(--ink-1); }
.wx-root .gt-modes > .on, .wx-root .gt-modes > .on:hover { background: var(--brand); color: #fff; font-weight: 600; cursor: default; }

/* 고른 차 되짚기 — 넷을 다 누르고 나면 위가 안 보인다. */
.wx-root .cascade-echo { padding: 8px 0 0; font-size: 11.5px; color: var(--ink-3); line-height: 1.5; }

/* 원가 화면 — 머리는 견적과 «같고», 몸통만 제 짜임을 쓴다(설정 34칸이라 기둥이 넷이다).
   사장님 2026-09-08 「각 페이지는 이거랑 맞춰야지, 원가랑 견적은 동일하게」.
   ⇒ 「동일하게」는 «머리·색·글꼴·토글»이다. 몸통까지 400/52/20 으로 밀면 설정 칸이 안 들어간다. */
.wx-root.cost { grid-template-columns: 1fr; }
.wx-root.cost > .est-root { min-width: 0; height: 100%; overflow-y: auto; }
.wx-root.cost .phone { min-height: 0; }

/* 폰 — 원본은 폰을 «다른 페이지»(mobile.html)로 보내 버려서, 이 폭에서 세 기둥이 제자리를 못 잡는다.
   칸마다 `height:100% + overflow:auto` 라 스크롤 상자 셋이 겹쳐 뒤 칸이 통째로 잘린다(2026-09-07 실측).
   우리는 폰에서도 «같은 페이지»를 쓴다(CLAUDE.md 「웹·모바일 양립」) — 세로로 이어 붙이고
   스크롤은 화면 하나만 갖는다. 원본 규칙은 안 고치고 이 폭에서만 덮는다. */
@media (max-width: 1024px) {
  .wx-root { height: auto; overflow: visible; }
  .wx-root .wrap,
  .wx-root .quote-panel,
  .wx-root .contract-panel { height: auto !important; max-height: none !important; overflow: visible !important; }
  /* 총액 띠는 ERP 하단 홈바 «위»에 선다 — 안 올리면 홈·검색·설정을 덮는다. */
  .wx-root .total-bar { bottom: var(--fp-bar-h, 0px); }
}

/* ★웰릭스 CI 레드(#e1141e)는 «남의 간판»이다 — 액센트만 프리패스 남색으로 돌린다.
   CLAUDE.md 「브랜드 표식은 안 세운다(노브랜드)」 · 짜임·치수는 원본 그대로 둔다. */
.wx-root {
  --brand: #1B2A4A; --brand-700: #111d35; --brand-100: #c6cdda; --brand-50: #eef1f6;
  --welrix-red: #1B2A4A;
}
/* 차 고르기(picker.css)가 부르는 이름 넷 — 웰릭스 토큰표에 없어서 여기서 채운다.
   (없으면 피커가 배경·글자색 없이 맨몸으로 선다.) */
.wx-root { --surface: #fff; --surface-2: var(--bg-soft); --on: #fff; --accent-line: var(--line-2); }
/* 인라인 피커는 좌패널 폭에 갇힌다 — 원본의 «모달 폭»을 물려받으면 400px 을 넘는다. */
.wx-root .est-picker.inline { width: 100%; max-width: 100%; }

/* 중고 차량 정보 칸 — 웰릭스는 신차라 DB 가 다 채워 «입력칸이 없었다».
   중고는 시세·연식·주행을 사람이 넣는다. 칸 모양은 원본 `.cs-field`(밑줄 입력)를 그대로 쓴다. */
.wx-root .wx-warn {
  grid-column: 1 / -1;
  font-size: 11px; color: var(--brand); background: var(--brand-50);
  border-radius: var(--r-sm); padding: 6px 8px; line-height: 1.5;
}
.wx-root .vfields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.wx-root .vfields .cs-field--wide { grid-column: 1 / -1; }
.wx-root .color-wrap:has(.color-swatch-mini) .step-dd { padding-left: 30px; }
.wx-root .vfields .unit { font-size: 11px; color: var(--ink-4); margin-left: 4px; white-space: nowrap; }

/* 손익(원가) 기둥 — 웰릭스가 계약·채팅을 놓던 셋째 칸이다. 우리 원가구조가 여기 선다. */
.wx-root .contract-panel { display: block; overflow-y: auto; padding: 8px 16px 24px; }
.wx-root .pnl-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.wx-root .pnl-row .k { color: var(--ink-3); min-width: 0; }
.wx-root .pnl-row .k em { font-style: normal; color: var(--ink-4); font-size: 10px; display: block; }
.wx-root .pnl-row .v { font-variant-numeric: tabular-nums; white-space: nowrap; }
.wx-root .pnl-row.minus .v { color: var(--ink-2); }
.wx-root .pnl-row.head { border-bottom: 0; padding-top: 12px; color: var(--ink-4); font-size: 10px; letter-spacing: .6px; }
.wx-root .pnl-row.sum { border-bottom: 2px solid var(--line-3); font-weight: 600; color: var(--ink-1); }
.wx-root .pnl-row.pay { border-bottom: 0; font-size: 13px; font-weight: 700; color: var(--brand); padding-top: 8px; }
.wx-root .pnl-tabs { display: flex; gap: 4px; padding: 10px 0 4px; }
.wx-root .pnl-tabs button { flex: 1; height: 28px; border: 1px solid var(--line-2); background: #fff; border-radius: var(--r-sm); font-size: 11.5px; font-family: inherit; color: var(--ink-3); cursor: pointer; }
.wx-root .pnl-tabs button.on { border-color: var(--brand); background: var(--brand-50); color: var(--brand); font-weight: 600; }
"""
io.open('components/estimate/welrix.css', 'w', encoding='utf-8', newline='\n').write(head + out + tail)
print('원본 CSS', len(css), '자 →', len(out), '자')
