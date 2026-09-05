# -*- coding: utf-8 -*-
"""
기아·제네시스 가격표 PDF에서 «옵션 × 트림 가격 매트릭스»를 좌표로 복원한다(Codex #2).
  평문 추출은 열 정렬을 잃으므로 get_text("words")의 x·y로 표를 다시 세운다.
  - 옵션표 블록 = 왼쪽(x<60)에 트림명이 오고 그 오른쪽으로 가격/기본/− 셀이 3개 이상 늘어선 연속 행.
  - 셀의 x를 열로 군집하고, 첫 트림행 위 2~3줄의 헤더 단어를 열에 배정해 옵션명을 만든다.
  - 가격 「NNN만」 → 원, 「기본」 → 0(기본 포함), 「-」/「─」 → None(해당 없음).
출력: JSON {model, tables:[{trims:[...], options:[{name, byTrim:{트림:가격|0|null}}]}]}
사용: python scripts/extract-option-matrix.py tmp/newcar-pdf/price_sorento.pdf sorento > out.json
"""
import fitz, sys, json, re

PRICE = re.compile(r'^([\d,]+)\s*만$')
BASE = re.compile(r'^(기본|기\s*본)$')
DASH = re.compile(r'^[-–—―─]$')
# 트림명으로 인정할 후보(왼쪽 첫 칸). 너무 헐겁게 잡지 않도록 실제 트림 어휘 위주.
TRIMWORD = re.compile(r'^(트렌디|프레스티지|노블레스|시그니처|시그너처|X-?Line|GT-?Line|그래비티|캘리그래피|'
                      r'에어|어스|스탠다드|롱레인지|익스클루시브|프리미엄|스마트|모던|인스퍼레이션|블랙|에디션|'
                      r'라이트|밸류|E-Value|E-LITE|캐즘|셀레브리티|다이내믹|스포츠|리미티드)', re.I)


def won(s):
    m = PRICE.match(s.strip())
    return int(m.group(1).replace(',', '')) * 10000 if m else None


def cluster(xs, tol=14):
    """x 좌표들을 tol 이내로 군집해 대표 x(중앙) 리스트로."""
    xs = sorted(xs)
    cols, cur = [], []
    for x in xs:
        if cur and x - cur[-1] > tol:
            cols.append(sum(cur) / len(cur)); cur = []
        cur.append(x)
    if cur:
        cols.append(sum(cur) / len(cur))
    return cols


def nearest(cols, x, tol=22):
    best, bd = None, 1e9
    for c in cols:
        d = abs(c - x)
        if d < bd:
            bd, best = d, c
    return best if bd <= tol else None


FUELHDR = re.compile(r'(\d\.\d\s*(?:가솔린|디젤|LPG)(?:\s*터보)?|(?:플러그인\s*)?하이브리드|전기|EV)')


def page_fuel(p):
    """페이지에서 가장 위쪽 연료 헤더를 이 표의 연료로 본다(없으면 '')."""
    for x0, y0, x1, y1, wd, *_ in sorted(p.get_text("words"), key=lambda w: w[1]):
        m = FUELHDR.search(wd)
        if m and len(wd) < 22:
            return m.group(1).replace('  ', ' ').strip()
    txt = p.get_text()
    m = FUELHDR.search(txt)
    return m.group(1).strip() if m else ''


def extract(pdf_path):
    d = fitz.open(pdf_path)
    tables = []
    for pno in range(len(d)):
        p = d[pno]
        words = p.get_text("words")
        if not words:
            continue
        pfuel = page_fuel(p)
        # y로 행 묶기 — 라벨과 가격이 몇 px 어긋나므로(에어 라벨 y147 · 가격 y144) 가까운 y(≤6px)를 한 줄로 병합.
        sw = sorted(words, key=lambda w: (w[1], w[0]))
        rows = []  # (anchorY, [(x,word)])
        for x0, y0, x1, y1, wd, *_ in sw:
            # 라벨과 가격이 최대 ~9px 어긋난다(EV3 에어: 컴포트II·와이드선루프 y138.6 vs 일반가 y145.5 vs 라벨 y147).
            #   다음 트림행은 보통 18~30px 밖이라 9px 병합은 안전(Codex #3).
            if rows and y0 - rows[-1][0] <= 9:
                rows[-1][1].append((x0, wd.strip()))
            else:
                rows.append((y0, [(x0, wd.strip())]))
        rows = [(round(y), sorted(cells)) for y, cells in rows]
        # 옵션표 행 = 왼쪽 첫 단어가 트림명 + 오른쪽에 가격/기본/− 3개 이상
        def is_matrix_row(cells):
            if not cells:
                return False
            lead = cells[0][1]
            if not TRIMWORD.match(lead):
                return False
            vals = [w for x, w in cells[1:] if PRICE.match(w) or BASE.match(w) or DASH.match(w)]
            return len(vals) >= 3
        i = 0
        while i < len(rows):
            if is_matrix_row(rows[i][1]):
                # 이 블록의 연속 매트릭스 행 모으기
                block = []
                j = i
                while j < len(rows) and is_matrix_row(rows[j][1]):
                    block.append(rows[j]); j += 1
                # 셀 x 군집 → 값 열(트림명 칸 x 제외)
                valxs = []
                for _, cells in block:
                    for x, w in cells[1:]:
                        if PRICE.match(w) or BASE.match(w) or DASH.match(w):
                            valxs.append(x)
                cols = cluster(valxs)
                first_y = block[0][0]
                # 헤더 = 첫 매트릭스 행 «바로 위 ~55px» 창에서, 값열 x에 배정되는 «짧은» 단어들.
                #   피처 설명줄(단어 많음·긴 단어)은 배제 → 옵션명만 남긴다.
                hdr_rows = [(yk, cells) for (yk, cells) in rows if first_y - 55 <= yk < first_y]
                colwords = {round(c): [] for c in cols}
                for yk, cells in hdr_rows:
                    if len(cells) > 9:
                        continue  # 피처 설명 같은 촘촘한 줄 제외
                    for x, w in cells:
                        if PRICE.match(w) or BASE.match(w) or DASH.match(w) or TRIMWORD.match(w):
                            continue
                        if re.match(r'^(구분|파워|트레인|판매가격|주|요|기|본|품|목|외)$', w) or len(w) > 12 or w.endswith(',') or '·' in w:
                            continue
                        if re.match(r'^(적용|시|선택|가능|불가|동시|중복)$', w) or w.endswith(')') or w.startswith('('):
                            continue  # 규칙 조각어만 배제(정상 헤더는 유지)
                        c = nearest(cols, x, tol=22)
                        if c is not None:
                            colwords[round(c)].append((yk, x, w))
                # 열 이름 = 위→아래, 왼→오 순으로 조립
                optnames = {}
                for c in cols:
                    ws = sorted(colwords[round(c)], key=lambda t: (t[0], t[1]))
                    optnames[round(c)] = ' '.join(w for _, _, w in ws).strip() or f'opt@{round(c)}'
                # 트림 행별 값
                out_trims, out_opts = [], {round(c): {} for c in cols}
                for _, cells in block:
                    trim = cells[0][1]
                    out_trims.append(trim)
                    for x, w in cells[1:]:
                        c = nearest(cols, x)
                        if c is None:
                            continue
                        if PRICE.match(w):
                            out_opts[round(c)][trim] = won(w)
                        elif BASE.match(w):
                            out_opts[round(c)][trim] = 0
                        elif DASH.match(w):
                            out_opts[round(c)][trim] = None
                tables.append({
                    'page': pno,
                    'fuel': pfuel,
                    'trims': out_trims,
                    'options': [{'name': optnames[round(c)], 'byTrim': out_opts[round(c)]} for c in cols],
                })
                i = j
            else:
                i += 1
    return tables


if __name__ == '__main__':
    pdf = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else ''
    out = sys.argv[3] if len(sys.argv) > 3 else ''
    payload = json.dumps({'model': model, 'tables': extract(pdf)}, ensure_ascii=False, indent=1)
    if out:
        open(out, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'wrote {out}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
