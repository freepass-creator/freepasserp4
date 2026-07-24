import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// 자동차등록증 OCR — 로컬 GPU(easyocr, ocrenv). 업로드 이미지 → 파이썬 → 필드 추출.
// ⚠ 로컬 개발기(RTX 3060) 전용. 배포 환경엔 파이썬/CUDA 없으므로 미동작(그때는 클라우드 OCR로 대체).
export const runtime = 'nodejs';
export const maxDuration = 120;

const PY = process.env.OCR_PYTHON || 'C:\\dev\\ocrenv\\Scripts\\python.exe';

export async function POST(req: NextRequest) {
  // ⚠ 프로덕션 가드 — 로컬 GPU(Windows python) 전용. 배포환경(Vercel)엔 파이썬/CUDA 없어 spawn 실패·행 → 501로 명확히 차단.
  if (process.env.VERCEL || process.env.OCR_DISABLED === '1') {
    return NextResponse.json({ error: 'OCR은 로컬 개발 전용입니다(배포환경 미지원)' }, { status: 501 });
  }
  let dataUrl: string;
  try { ({ dataUrl } = await req.json()); } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }); }
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return NextResponse.json({ error: '이미지 데이터가 아닙니다' }, { status: 400 });
  const ext = (m[1].split('/')[1] || 'png').replace(/[^\w]/g, '');
  const buf = Buffer.from(m[2], 'base64');
  const tmp = join(tmpdir(), `fp4_reg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`);
  const script = join(process.cwd(), 'scripts', 'ocr_registration.py');
  try {
    await writeFile(tmp, buf);
    const out = await new Promise<string>((res, rej) => {
      const p = spawn(PY, [script, tmp], { windowsHide: true });
      let o = '', e = '';
      p.stdout.on('data', (d) => (o += d.toString('utf-8')));
      p.stderr.on('data', (d) => (e += d.toString('utf-8')));
      p.on('error', rej);
      p.on('close', (c) => (c === 0 ? res(o) : rej(new Error(e.slice(-400) || `exit ${c}`))));
    });
    const lastLine = out.trim().split('\n').filter(Boolean).pop() || '{}';
    const parsed = JSON.parse(lastLine);
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  } finally {
    unlink(tmp).catch(() => {});
  }
}
