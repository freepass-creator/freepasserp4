#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""사진에서 **차량번호판**을 읽는다 — 폴더가 그 차의 사진인지 확인하는 용도.

사용: python scripts/ocr_plate_folder.py <이미지경로...>
출력(stdout, 마지막 줄): {"results":[{"path":..., "plates":[...], "text":"..."}]}

★사장님 2026-08-20 「니가 OCR 이랑 전수검사해서 사진이랑 폴더 잘못된 거 찾아낼 수 있지 않나?」
  번호판 글자만 필요하므로 한국어+영문 리더를 한 번 만들어 여러 장을 이어서 읽는다(GPU 있으면 GPU).
  숫자·한글 사이 공백/오인식이 흔해 후보를 넓게 잡고 정규식으로 「12가3456」 꼴만 추린다.
"""
import sys, json, re, os, warnings

warnings.filterwarnings('ignore')
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

PLATE = re.compile(r'(\d{2,3})\s*([가-힣])\s*(\d{4})')
# 번호판에 쓰이는 한글은 정해져 있다 — 오인식(0↔O, 1↔I)은 숫자 쪽에서만 고친다.
DIGIT_FIX = str.maketrans({'O': '0', 'o': '0', 'D': '0', 'I': '1', 'l': '1', '|': '1', 'S': '5', 'B': '8', 'Z': '2'})


def plates_from(text: str):
    cleaned = text.translate(DIGIT_FIX)
    out = []
    for m in PLATE.finditer(cleaned):
        out.append(f'{m.group(1)}{m.group(2)}{m.group(3)}')
    return out


def main():
    paths = [p for p in sys.argv[1:] if os.path.exists(p)]
    if not paths:
        print(json.dumps({'results': [], 'error': 'no files'}, ensure_ascii=False))
        return
    import easyocr
    import torch
    reader = easyocr.Reader(['ko', 'en'], gpu=torch.cuda.is_available(), verbose=False)
    results = []
    for path in paths:
        try:
            # ⚠ 한글 경로는 OpenCV(imread)가 못 연다 — 바이트로 읽어 넘긴다.
            import numpy as np
            with open(path, 'rb') as fh:
                buf = np.frombuffer(fh.read(), dtype=np.uint8)
            import cv2
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is None:
                raise RuntimeError('이미지 디코드 실패')
            lines = reader.readtext(img, detail=0, paragraph=False)
            text = ' '.join(str(x) for x in lines)
            results.append({'path': path, 'plates': sorted(set(plates_from(text))), 'text': text[:400]})
        except Exception as exc:  # 한 장이 실패해도 나머지는 읽는다
            results.append({'path': path, 'plates': [], 'error': str(exc)[:200]})
    print(json.dumps({'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
