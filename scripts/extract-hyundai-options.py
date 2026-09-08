# -*- coding: utf-8 -*-
"""
현대 가격표 PDF에서 «트림별 선택옵션 가격»을 뽑는다(현대는 기아와 포맷이 달라 선형 파싱).
  PDF URL = https://www.hyundai.com/contents/repn-car/catalog/{model}-price.pdf
  구조: 트림헤더 「(모던)」/「Modern」 → 그 아래 「▶ 옵션명」 다음 「[900,000]」(원 · 다음/같은 줄).
        「[추가비용없음]」 = 0(무상). 트림가는 「19,010,000」(전) 형태로 헤더 근처.
출력 JSON: {model, trims:[{trim, options:[{name, price}]}]}
사용: python scripts/extract-hyundai-options.py tmp/newcar-pdf/hy_avante.pdf avante out.json
"""
import fitz, sys, json, re

PRICE_BR = re.compile(r'\[([\d,]+)\]')          # [900,000]
FREE = re.compile(r'추가\s*비용\s*없음|추가비용없음')
# 트림 헤더 = 「(스마트)」「(모던)」 괄호 한글, 또는 bare 영문 트림(「Inspiration」 등 — 현대 PDF 혼재).
TRIM_PAREN = re.compile(r'^\(([가-힣A-Za-z0-9 ·\-]{2,16})\)$')
EN2KO = {'smart': '스마트', 'modern': '모던', 'premium': '프리미엄', 'inspiration': '인스퍼레이션',
         'exclusive': '익스클루시브', 'calligraphy': '캘리그래피', 'prestige': '프레스티지'}
TRIM_EN = re.compile(r'^(Smart|Modern|Premium|Inspiration|Exclusive|Calligraphy|Prestige)\s*$', re.I)
# 옵션 시작 표식 ▶ (PDF에 U+25B6 등). 텍스트에선 ▶ 또는 ▶ 유사.
OPT_MARK = re.compile(r'^[▶▷]\s*(.+?)\s*$')
NOISE = re.compile(r'기본\s*품목|선택\s*품목|파워트레인|세제혜택|개별소비세|친환경')


def won_br(line):
    if FREE.search(line):
        return 0
    m = PRICE_BR.search(line)
    return int(m.group(1).replace(',', '')) if m else None


def extract(pdf_path):
    d = fitz.open(pdf_path)
    lines = []
    for p in d:
        lines += [l.strip() for l in p.get_text().split('\n')]
    # 연료 헤더(트림 섹션의 연료 문맥): 「LPi 1.6 모던 기본」·「스마트스트림 가솔린 1.6 스마트」 등
    FUEL = re.compile(r'(LPi|LPG|가솔린|디젤|하이브리드|전기)')
    trims = []
    cur = None  # {trim, fuel, options}
    i = 0
    while i < len(lines):
        L = lines[i]
        tm = TRIM_PAREN.match(L)
        em = TRIM_EN.match(L)
        if (tm or em) and not NOISE.search(L):
            name = tm.group(1).strip() if tm else EN2KO.get(em.group(1).lower(), em.group(1))
            # 영문헤더 바로 다음 「(한글)」 이면 같은 트림 — 중복 섹션 방지(Smart\n(스마트))
            if cur is not None and re.sub(r'\s', '', cur['trim']) == re.sub(r'\s', '', name) and not cur['options']:
                i += 1
                continue
            # 연료 = 트림헤더 아래 「… 기본 품목」 줄에서 찾음
            fuel = ''
            for j in range(i + 1, min(i + 8, len(lines))):
                if '기본' in lines[j] and ('품목' in lines[j] or name in lines[j]):
                    fm = FUEL.search(lines[j])
                    if fm:
                        fuel = fm.group(1)
                    break
            cur = {'trim': name, 'fuel': fuel, 'options': []}
            trims.append(cur)
            i += 1
            continue
        om = OPT_MARK.match(L)
        if om and cur is not None:
            oname = re.sub(r'\s+', ' ', om.group(1)).strip().rstrip('▶▷ ').strip()
            # 가격: 같은 줄에 있거나 다음 몇 줄 안에 [..]/추가비용없음
            price = won_br(L)
            if price is None:
                for j in range(i + 1, min(i + 4, len(lines))):
                    if OPT_MARK.match(lines[j]) or TRIM_PAREN.match(lines[j]):
                        break
                    price = won_br(lines[j])
                    if price is not None:
                        break
            if oname and price is not None and 0 <= price <= 20_000_000:
                # 옵션명에서 꼬리 잡음 제거
                oname = re.sub(r'\s*\[[^\]]*\]\s*$', '', oname).strip()
                if oname and not NOISE.search(oname):
                    cur['options'].append({'name': oname, 'price': price})
        i += 1
    # 옵션 없는 트림 버림 + 중복 옵션 제거
    out = []
    for t in trims:
        seen = {}
        for o in t['options']:
            seen[o['name']] = o
        if seen:
            out.append({'trim': t['trim'], 'fuel': t.get('fuel', ''), 'options': list(seen.values())})
    return out


if __name__ == '__main__':
    pdf, model, outp = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
    payload = json.dumps({'model': model, 'trims': extract(pdf)}, ensure_ascii=False, indent=1)
    if outp:
        open(outp, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'wrote {outp}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
