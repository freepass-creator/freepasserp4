/**
 * 계약서 실물 **학습** — 12부에서 «항목 이름»만 뽑아 공통/개별을 가른다.
 *
 * ★값은 읽지도 담지도 않는다. 실물에는 고객 성명·주민번호·연락처가 들어 있다.
 *   라벨만 세고 값은 버린다. 결과에도 값이 남지 않는다.
 *
 * 실물은 리포에 넣지 않는다(tmp/ 는 git 무시). 돌리려면 카톡 받은 파일에서
 * `tmp/contract-samples/` 로 복사해 두고 실행한다.
 *
 *   npx tsx scripts/learn-contract-labels.mts
 */
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
const DIR='tmp/contract-samples';
const S=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();
/** 라벨인가 — 값이 아니라 «항목 이름»만 남긴다. */
const isLabel=(t:string)=>{
  if(!t||t.length>28||t.length<2) return false;
  if(/^\d[\d,.\-\/]*$/.test(t)) return false;              // 숫자·금액
  if(/\d{2,3}-\d{3,4}-\d{4}/.test(t)) return false;        // 전화
  if(/\d{6}-\d{7}/.test(t)) return false;                  // 주민번호
  if(/^\d{2,4}[년.\-]/.test(t)) return false;              // 날짜
  if(/[가-힣]{2,3}(님)?$/.test(t)&&t.length<=4&&!/[료금액명일자]/.test(t)) return false; // 사람이름 의심
  return /[가-힣]/.test(t);
};
const norm=(t:string)=>t.replace(/[*※■□○●\[\]()]/g,'').replace(/\s+/g,'').replace(/[:：]/g,'').trim();
const byLabel=new Map<string,Set<string>>();
const perFile=new Map<string,number>();
for(const f of readdirSync(DIR).filter(x=>x.endsWith('.xlsx'))){
  const wb=XLSX.read(readFileSync(`${DIR}/${f}`),{type:'buffer'});
  const seen=new Set<string>();
  for(const name of wb.SheetNames){
    const ws=wb.Sheets[name]; if(!ws['!ref']) continue;
    const r=XLSX.utils.decode_range(ws['!ref']);
    for(let row=r.s.r; row<=Math.min(r.e.r,700); row++)
      for(let col=r.s.c; col<=Math.min(r.e.c,60); col++){
        const v=ws[XLSX.utils.encode_cell({r:row,c:col})]?.v;
        const t=S(v); if(!isLabel(t)) continue;
        const k=norm(t); if(k.length<2) continue;
        seen.add(k);
      }
  }
  perFile.set(f,seen.size);
  for(const k of seen){ if(!byLabel.has(k)) byLabel.set(k,new Set()); byLabel.get(k)!.add(f); }
}
const N=perFile.size;
console.log(`계약서 ${N}부 · 서로 다른 라벨 ${byLabel.size}\n`);
const rank=[...byLabel.entries()].map(([k,v])=>({k,n:v.size})).sort((a,b)=>b.n-a.n||a.k.localeCompare(b.k,'ko'));
console.log(`■ 모든 계약서에 있는 것 (${N}/${N})`);
rank.filter(x=>x.n===N).forEach(x=>console.log(`   ${x.k}`));
console.log(`\n■ 대부분에 있는 것 (${Math.ceil(N*0.6)}~${N-1}부)`);
rank.filter(x=>x.n>=Math.ceil(N*0.6)&&x.n<N).forEach(x=>console.log(`   ${String(x.n).padStart(2)}부  ${x.k}`));
console.log(`\n■ 절반쯤 (${Math.ceil(N*0.35)}~)`);
rank.filter(x=>x.n>=Math.ceil(N*0.35)&&x.n<Math.ceil(N*0.6)).forEach(x=>console.log(`   ${String(x.n).padStart(2)}부  ${x.k}`));
