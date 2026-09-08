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

# ★숫자에 «사선 0» — 사장님 2026-09-08 「숫자 있는 거는 **숫자에 사선 나오는 프리텐다드** 써야 함」.
#   웰릭스 원본은 서른 군데 넘게 `tabular-nums` 만 건다. 그러면 0 과 O 가 안 갈린다.
#   뿌리에서 한 번 켜 봐야 그 규칙들이 제 자리에서 도로 끈다(선택자가 더 세다).
#   ⇒ 싸우지 말고 **원본 규칙 자체에 붙인다**. 기계가 하는 한 줄이라 손댄 자리가 남지 않는다.
#   (프리패스 기존 규격도 같다 — `estimate.css` 의 `tabular-nums slashed-zero`.)
out = re.sub(r'tabular-nums(?!\s+slashed-zero)', 'tabular-nums slashed-zero', out)
head = r"""/* ─────────────────────────────────────────────────────────────────────────
 * 웰릭스 견적기 화면 — **원본 그대로 옮긴 CSS**
 *   원천 : C:\dev\welrixtable/index.html 의 <style> 넷 (2026-09-07 기준)
 *   뜬 법 : scripts/extract-welrix-css.py — 규칙은 «한 글자도» 고치지 않고 선택자 앞에 `.wx-root` 만 붙였다.
 *           (`body`·`html`·`:root` 는 `.wx-root` 로 치환 · `*` 는 `.wx-root *`)
 *   왜   : 견적은 ERP 껍데기 «안»에 서는 페이지다. 웰릭스 전역 리셋이 풀리면 ERP 전체가 물든다.
 *   ★한 가지만 «고쳐서» 옮긴다 — `tabular-nums` 에 `slashed-zero` 를 붙인다(0 과 O 를 가른다).
 *     프리패스 기존 규격이 그렇다(`estimate.css`). 그 밖에는 한 글자도 안 고친다.
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
  .wx-root #sec-source, .wx-root #sec-credit {
    display: grid !important; grid-template-columns: 96px 1fr;
    align-items: start; column-gap: 12px; row-gap: 4px; padding: 12px 0 !important;
  }
  .wx-root #sec-source > .step-title, .wx-root #sec-credit > .step-title {
    grid-column: 1; margin-bottom: 0 !important; white-space: nowrap;
    align-self: start; padding-top: 8px;   /* 세 줄이 겹쳐 서는 칸이라 라벨을 첫 줄에 맞춘다 */
  }
  .wx-root #sec-source > *:not(.step-title), .wx-root #sec-credit > *:not(.step-title) {
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

/* ══ 기둥이 «둘»이 됐다 — 사장님 2026-09-08 「우측에 따로 놓지 말고」 ═══════════
   원본 웰릭스는 셋째 칸에 계약접수·채팅을 놓았고, 우리는 거기에 원가·손익을 놓았었다.
   그런데 원가를 따로 두면 「4년이 왜 이 값인지」를 보려고 탭을 옮겨 다녀야 하고
   다섯 해를 **나란히 견줄 수가 없다.** ⇒ 셋째 칸을 없애고 각 «줄» 안으로 넣었다.
   좌 400(차량 선택) : 우 나머지(조건 + 1~5년 설계). */
@media (min-width: 1025px) {
  /* ⚠ 반드시 «1025 이상»에서만 건다 — 원본은 1024 이하에서 기둥을 한 줄로 접는데,
     이 규칙을 밖에 두면 나중에 와서 그 접힘을 덮어 버린다(폰에서 두 기둥이 그대로 섰다 · 2026-09-08 실측). */
  .wx-root:not(.cost) { grid-template-columns: 400px minmax(0, 1fr); }
}

/* ── 1년 ~ 5년 — «가로로 쭉» ────────────────────────────────────────────────
   사장님 2026-09-08 「**1~5년은 가로로 쭉** 나와야지」 · 「**모바일에서는 그게 위아래로 분리**되는 거고」
   짜임은 원본 `.term-card` 그대로다. 원본은 셋이고 우리는 다섯이라 **열 수만** 늘렸다. */
.wx-root .qgrid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
/* 다섯이 안 들어가는 폭에서는 접는다 — 반쪽 칸은 안 편 것만 못하다. */
@media (max-width: 1500px) { .wx-root .qgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .wx-root .qgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
/* ★폰 — 「위아래로 분리」. 한 해가 한 장이다. */
@media (max-width: 760px) { .wx-root .qgrid { grid-template-columns: 1fr; } }

.wx-root .qgrid .term-card { min-width: 0; }
.wx-root .qterm { font-size: 13px; font-weight: 700; color: var(--ink-1); line-height: 1.15; }
.wx-root .qterm em { display: block; font-style: normal; font-size: 10px; font-weight: 400; color: var(--ink-4); }
/* 장부 세 줄(매출·원가·영업이익)은 조건 줄과 «선»으로 가른다 — 성격이 다른 숫자다. */
.wx-root .term-card__row.bk { border-top: 1px dashed var(--line-2); margin-top: 2px; padding-top: 4px; }
.wx-root .term-card__row.bk + .term-card__row.bk { border-top: 0; margin-top: 0; padding-top: 0; }
.wx-root .term-card__row.profit b { color: var(--brand); font-weight: 700; }
.wx-root .term-card__row.profit.neg b { color: #b23b3b; }
.wx-root .term-card__row.sum { border-top: 1px solid var(--line-2); margin-top: 3px; padding-top: 4px; font-weight: 600; }
.wx-root .qopen {
  width: 100%; height: 26px; margin-top: 8px;
  border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--bg);
  font: inherit; font-size: 11px; color: var(--ink-3); cursor: pointer;
}
.wx-root .qopen:hover { border-color: var(--ink-3); color: var(--ink-1); }
.wx-root .term-card.open .qopen { border-color: var(--brand); color: var(--brand); background: var(--brand-50); }
.wx-root .qdetail { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }

/* 고르는 칸은 **기존 것**을 쓴다(사장님 2026-09-08 「기존거 활용하라고 했는데」) —
   `.seg`·`.chips`·`.pin`(estimate.css) · `.mkrow`·`.tchips`·`.oprow`(picker.css).
   ⇒ 여기서 칩을 «새로 만들지 않는다». 자리만 잡아 준다. */
.wx-root .wrap .seg { margin-bottom: 0; }
.wx-root .wrap .chips { flex: 1 1 auto; }
.wx-root .wrap .tchips { margin-top: 0; }
.wx-root .wrap .mkrow { padding: 0; }
/* 긴 칸(제조사·모델)은 키를 묶는다 — 안 묶으면 열일곱·수십 개가 왼쪽을 통째로 민다. */
.wx-root .wrap .tchips.scroll { max-height: 132px; overflow-y: auto; padding-right: 2px; }
.wx-root .wrap .tchips .sw { width: 11px; height: 11px; border-radius: 50%; border: 1px solid rgba(0,0,0,.25); margin-right: 5px; flex: none; }
.wx-root .wrap .tchips button { display: inline-flex; align-items: center; }
.wx-root .wrap .tchips em { font-style: normal; font-size: 10.5px; opacity: .7; margin-left: 5px; }

/* 조건 줄 — 원본은 넷(신용·약정주행·보증금·선납) 고정 격자였다. 우리는 **다섯**이다
   (채널·만기·신용·보증금·선납 — 사장님 2026-09-08 「우측은 견적에 관련된 거」).
   고정 넷으로 두면 다섯째가 아래로 떨어져 줄이 두 단이 된다. ⇒ 폭에 맞춰 «흐르게» 한다. */
/* ★조건 줄은 «격자»가 아니라 «흐름»이다 — 사장님 2026-09-08
   「이런 거 **너무 칸 맞추려고 하지 말고 배열만 잘해** 봐」.
   격자(1fr)로 맞추니 「10 %」 하나가 제 칸을 다 먹어 입력 상자가 화면 절반이 됐다.
   ⇒ 내용 폭대로 흐르고, 넘치면 다음 줄로 접는다. */
.wx-root .qp-form--conds.flow {
  display: flex !important; flex-wrap: wrap; align-items: center;
  column-gap: 20px; row-gap: 8px; grid-template-columns: none !important;
}
.wx-root .qp-form--conds.flow .qc-field {
  display: inline-flex; align-items: center; gap: 8px;
  grid-template-columns: none; padding: 4px 0; width: auto;
}
.wx-root .qp-form--conds.flow .qc-field > label { white-space: nowrap; }
/* ⚠ `.seg`·`.chips` 는 안쪽 버튼이 `flex:1` 이라 «칸을 나눠 갖는» 짜임이다.
   흐름 줄에 그냥 놓으면 컨테이너가 눌려 글자가 겹친다(2026-09-08 보고 잡음).
   ⇒ 흐름 줄에서는 버튼이 «제 글자 폭»을 갖는다. */
.wx-root .qp-form--conds.flow .seg,
.wx-root .qp-form--conds.flow .chips { margin-bottom: 0; width: auto; flex: none; }
.wx-root .qp-form--conds.flow .seg button,
.wx-root .qp-form--conds.flow .chips button { flex: none; padding: 0 14px; white-space: nowrap; }
/* 숫자 칸은 «숫자만큼»만 — 늘리지 않는다. */
.wx-root .qp-form--conds.flow .pin { flex: none; }
.wx-root .qp-form--conds.flow .pin input { width: 42px; }

/* 오른쪽 단 구분 — 사장님 2026-09-08 「**위계랑 섹션 구분 잘해주고**」.
   원본은 제목이 둘뿐이라 여백만으로 갈렸다. 우리는 넷(①②③·손님)이라 «선»이 있어야 단이 보인다. */
.wx-root .quote-panel .qp-terms__title { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--line-2); }
.wx-root .quote-panel .qp-summary-mini + .qp-terms__title { margin-top: 10px; border-top: 0; padding-top: 0; }
.wx-root .quote-panel .qp-terms__title small { font-weight: 400; color: var(--ink-4); margin-left: 4px; }

/* 잔가 두 줄 — 견적용 / 인수용(사장님 2026-09-08 「잔가는 내부에서 견적용 잔가와 손님 인수용 잔가가 2개」).
   조건 줄(`term-card__cond`)과 같은 짜임을 쓰되, 위와 구별되게 선 하나로 가른다. */
.wx-root .term-card__cond.resid2 { border-top: 1px dashed var(--line-2); padding-top: 6px; margin-top: 4px; }

/* 「추정」 표시 — 우리가 채운 값이라는 것을 «말한다»(사장님 2026-09-08 「평균시세는 틀릴 수 있으니까」).
   ⚠ 표시를 빼면 사람이 그 값을 «우리가 아는 시세»로 믿는다. 그게 더 위험하다. */
.wx-root .seedmark {
  align-self: center; font-size: 10px; line-height: 1; padding: 3px 6px;
  border-radius: var(--r-sm); background: var(--accent-soft); color: var(--accent);
  white-space: nowrap; cursor: help;
}
.wx-root .seedmark.warn { background: #fdecec; color: #b23b3b; cursor: default; }

/* 접히는 칸 머리 — 원가에 속한 것(잔가)은 접어 두고 꺼내서 쓴다. */
.wx-root .foldhead {
  display: flex; align-items: center; gap: 6px; width: 100%;
  border: 0; background: transparent; padding: 0 0 6px; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 500; color: var(--ink-3); text-align: left;
}
.wx-root .foldhead b { color: var(--ink-2); font-weight: 600; }
.wx-root .foldhead .fold-note { font-size: 10px; color: var(--ink-4); }
.wx-root .foldhead .fold-cv {
  margin-left: auto; width: 18px; height: 18px; border: 1px solid var(--line-2);
  border-radius: var(--r-sm); display: grid; place-items: center; font-size: 12px; color: var(--ink-3);
}
.wx-root .foldhead:hover .fold-cv { border-color: var(--ink-3); color: var(--ink-1); }

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
.wx-root .pnl-row .v { font-variant-numeric: tabular-nums slashed-zero; white-space: nowrap; }
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
