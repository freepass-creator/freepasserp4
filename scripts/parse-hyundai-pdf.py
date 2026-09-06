# -*- coding: utf-8 -*-
"""
현대 공식 가격표 PDF 텍스트(tmp/newcar-pdf/hy_*.txt) → 트림별 옵션. (사장님 2026-09-06 「현대기아 얼른 마무리」)
  포맷: 트림헤더 「(캘리그래피)」·「(프리미엄)」 아래 「▶ 옵션명\n[price]」 (트림별 유료옵션).
  트림별로 살 수 있는 옵션이 다르므로 트림 스코프로 뽑는다. 엔진선택 품목도 옵션으로.
출력: {model:{trim:[{name,price}], ...}}  → tmp/hyundai-pdf-options.json
  ※ 코덱스 검증용 재료. 가격은 [ ] 대괄호라 정확. 이름은 ▶ 뒤 실명.
사용: python scripts/parse-hyundai-pdf.py
"""
import re, glob, os, json

PRICE = re.compile(r'^\[([0-9,]+)\]$')
TRIM = re.compile(r'^\(([가-힣A-Za-z0-9 .]+)\)$')  # (캘리그래피) 등

def parse(path):
    lines = open(path, encoding='utf-8', errors='ignore').read().split('\n')
    trims = {}
    cur = None
    pending_name = None
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        mt = TRIM.match(s)
        if mt and len(mt.group(1)) <= 20:
            cur = mt.group(1).strip()
            trims.setdefault(cur, [])
            pending_name = None
            continue
        if s.startswith('▶'):
            nm = s.lstrip('▶').strip().rstrip('\t ')
            nm = re.sub(r'\s+', ' ', nm)
            pending_name = nm[:40] if nm else pending_name
            continue
        m = PRICE.match(s)
        if m and cur is not None and pending_name:
            price = int(m.group(1).replace(',', ''))
            if 50000 <= price <= 30000000:
                trims[cur].append({'name': pending_name, 'price': price})
            pending_name = None
    # 빈 트림 제거
    return {t: o for t, o in trims.items() if o}

if __name__ == '__main__':
    out = {}
    for pdf in sorted(glob.glob('tmp/newcar-pdf/hy_*.txt')):
        model = os.path.basename(pdf)[3:-4]  # hy_grandeur.txt -> grandeur
        r = parse(pdf)
        if r:
            out[model] = r
    json.dump(out, open('tmp/hyundai-pdf-options.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    tot_trims = sum(len(v) for v in out.values())
    tot_opts = sum(len(o) for v in out.values() for o in v.values())
    print(f'현대 {len(out)}모델 · 옵션있는 트림 {tot_trims} · 옵션셀 {tot_opts}')
    for m, v in out.items():
        print(f"  {m}: 트림 {len(v)} ({', '.join(list(v.keys())[:4])})")
