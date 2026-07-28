'use client';

import React from 'react';
import { Check, Copy } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { copyText } from '@/lib/clipboard';
import { Btn } from './buttons';
import { C, FS, R } from './tokens';
import { useIsMobile } from '@/lib/use-mobile';

export function CopyBlock({ text, label = '양식 복사' }: { text: string; label?: string }) {
  const mobile = useIsMobile();
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    if (!await copyText(text)) return;
    haptic.success();
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1 }} />
        <Btn
          size="sm"
          variant={done ? 'solid' : 'ghost'}
          mobileIcon={done ? <Check size={18} /> : <Copy size={18} />}
          title={done ? '복사됨' : label}
          onClick={copy}
        >{done ? '복사됨' : label}</Btn>
      </div>
      <pre style={{
        margin: 0,
        padding: mobile ? '12px 13px' : '11px 12px',
        border: `1px dashed ${C.line}`,
        borderRadius: R,
        background: C.taupeBg,
        fontFamily: 'inherit',
        fontSize: mobile ? FS.body : FS.sub,
        lineHeight: 1.75,
        color: C.ink,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </pre>
    </div>
  );
}
