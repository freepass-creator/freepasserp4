#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""자동차등록증 OCR → 상품 필드 추출 (easyocr + GPU).
사용: python ocr_registration.py <image_or_pdf_path>
출력(stdout, 마지막 줄): {"raw":[...], "text":"...", "fields":{...}}
원본(raw/text)은 보존 — 필드는 best-effort. 정규화 최소.
PDF = 첫 페이지를 래스터화 후 OCR (pymupdf/fitz 필요).
"""
import sys, json, re, os

try:  # API(Node)가 한글을 정상 수신하도록 stdout/err을 UTF-8로 고정(Windows 콘솔 codepage 무관)
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

FUEL_MAP = {'휘발유': '가솔린', '무연휘발유': '가솔린', '경유': '디젤', '엘피지': 'LPG', 'lpg': 'LPG'}


def extract(text: str, lines):
    ns = re.sub(r'\s', '', text)
    f = {}
    m = re.search(r'(\d{2,3}[가-힣]\d{4})', ns)                       # 차량번호
    if m: f['car_number'] = m.group(1)
    m = re.search(r'\b([A-HJ-NPR-Z0-9]{17})\b', text.upper())         # 차대번호(VIN)
    if m: f['vin'] = m.group(1)
    m = re.search(r'(가솔린|휘발유|무연휘발유|경유|디젤|LPG|엘피지|하이브리드|전기|수소|CNG)', text, re.I)  # 연료
    if m: f['fuel_type'] = FUEL_MAP.get(m.group(1).lower(), FUEL_MAP.get(m.group(1), m.group(1)))
    m = re.search(r'(\d{3,4})\s*(?:cc|㏄|씨씨|cm)', text, re.I)        # 배기량
    if m: f['engine_cc'] = m.group(1)
    m = re.search(r'(\d{1,2})\s*인', text)                            # 승차정원
    if m: f['seats'] = m.group(1)
    m = re.search(r'(20\d{2}|19\d{2})[.\-\s년]+(\d{1,2})[.\-\s월]+(\d{1,2})', text)  # 최초등록일
    if m:
        y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1990 <= y <= 2027 and 1 <= mo <= 12 and 1 <= da <= 31:  # 오독 방어(날짜 유효성)
            f['first_registration_date'] = f"{y}-{mo:02d}-{da:02d}"
            f['year'] = str(y)
    m = re.search(r'(자가용|영업용|관용)', text)                       # 용도
    if m: f['usage'] = m.group(1)
    return f


def to_image_path(path: str) -> str:
    """PDF면 첫 페이지 PNG로 변환해 경로 반환. 이미지는 그대로."""
    if not path.lower().endswith('.pdf'):
        return path
    try:
        import fitz  # pymupdf
    except ImportError:
        raise RuntimeError('PDF OCR에는 pymupdf 필요: pip install pymupdf')
    doc = fitz.open(path)
    if doc.page_count < 1:
        raise RuntimeError('빈 PDF입니다')
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # ~144dpi 상당
    out = path + '.png'
    pix.save(out)
    doc.close()
    return out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'no image path'})); return
    src = sys.argv[1]
    png = None
    try:
        img = to_image_path(src)
        if img != src:
            png = img
        import easyocr
        reader = easyocr.Reader(['ko', 'en'], gpu=True, verbose=False)
        lines = reader.readtext(img, detail=0, paragraph=False)
    except Exception as e:
        print(json.dumps({'error': f'ocr failed: {e}'}, ensure_ascii=False)); return
    finally:
        if png and os.path.exists(png):
            try: os.remove(png)
            except OSError: pass
    text = ' '.join(lines)
    print(json.dumps({'raw': lines, 'text': text, 'fields': extract(text, lines)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
