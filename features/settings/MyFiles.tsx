'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Btn, ButtonLabel, C, CenterNote, FilterChips, FS, FW, ICON, ListGroup, Loading, NUM, R, SectionLabel,
} from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { listMyFiles, MY_FILE_KIND_LABEL, type MyFile, type MyFileKind } from '@/lib/domain/my-files';
import { fileSizeText } from '@/lib/format';
import { FileText, Image as ImageIcon, ExternalLink } from 'lucide-react';

type FilterKey = 'all' | MyFileKind;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'chat', label: MY_FILE_KIND_LABEL.chat },
  { key: 'contract', label: MY_FILE_KIND_LABEL.contract },
];

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 설정 › 내 문서 — 내가 올린 파일 «읽기 전용» 목록.
 *   Storage 는 목록 열람이 막혀 있어 RTDB 메타데이터에서 모은다(lib/domain/my-files.ts).
 *   ⚠ 삭제를 붙이지 말 것 — 계약에 붙은 서류를 여기서 지우면 그 계약 서류함이 깨진다.
 */
export function MyFiles({ uid }: { uid: string }) {
  const mobile = useIsMobile();
  const [files, setFiles] = useState<MyFile[] | null>(null);
  const [flt, setFlt] = useState<FilterKey>('all');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!uid) { setFiles([]); return; }
    setFiles(null); setFailed(false);
    listMyFiles(uid)
      .then((r) => { if (!cancelled) setFiles(r); })
      .catch((e) => {
        console.warn('내 문서 조회 실패:', e);
        if (!cancelled) { setFiles([]); setFailed(true); }
      });
    return () => { cancelled = true; };
  }, [uid]);

  const shown = useMemo(
    () => (files || []).filter((f) => flt === 'all' || f.kind === flt),
    [files, flt],
  );

  if (!uid) return null;

  return (
    <div>
      <SectionLabel>내 문서</SectionLabel>
      <div style={{ marginBottom: 8 }}>
        <FilterChips<FilterKey>
          value={flt}
          onChange={setFlt}
          options={FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count: f.key === 'all'
              ? (files || []).length
              : (files || []).filter((x) => x.kind === f.key).length,
          }))}
        />
      </div>

      {files === null ? (
        <ListGroup><Loading label="문서를 불러오는 중…" minHeight={120} /></ListGroup>
      ) : shown.length === 0 ? (
        <ListGroup>
          <CenterNote minHeight={120}>
            {failed ? '문서를 불러오지 못했습니다.' : '올린 문서가 없습니다.'}
          </CenterNote>
        </ListGroup>
      ) : (
        // 설정은 웹에서 2단 컬럼(column-count:2)이라 목록이 길어지면 그 칸만 늘어나 균형이 깨진다.
        // 자체 스크롤로 높이를 묶는다 — AdminSettlementSheet 와 같은 규격(모바일/웹 값 분리).
        <ListGroup>
          <div style={{ maxHeight: mobile ? 260 : 380, overflowY: 'auto' }}>
          {shown.map((f) => {
            const isImg = /^image\//.test(f.type);
            const meta = [MY_FILE_KIND_LABEL[f.kind], f.ownerLabel, fileSizeText(f.size), fmtDate(f.at)]
              .filter(Boolean).join(' · ');
            return (
              <div
                key={f.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderBottom: `1px solid ${C.line}`,
                }}
              >
                {isImg
                  ? <ImageIcon size={ICON.md} color={C.mute} aria-hidden />
                  : <FileText size={ICON.md} color={C.mute} aria-hidden />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    title={f.name}
                    style={{
                      fontSize: FS.body, fontWeight: FW.strong, color: C.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {f.name}
                  </div>
                  <div style={{ fontSize: FS.micro, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>
                    {meta}
                  </div>
                </div>
                <Btn size="sm" variant="ghost" href={f.url} title="새 탭에서 열기">
                  <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>열기</ButtonLabel>
                </Btn>
              </div>
            );
          })}
          </div>
        </ListGroup>
      )}

      <p style={{ margin: '8px 2px 0', fontSize: FS.micro, color: C.faint, lineHeight: 1.5, borderRadius: R }}>
        내가 올린 파일만 보입니다. 삭제는 파일이 등록된 원본 업무 화면에서 하세요.
        링크는 받은 사람이 열 수 있으니 외부 공유에 주의하세요.
      </p>
    </div>
  );
}
