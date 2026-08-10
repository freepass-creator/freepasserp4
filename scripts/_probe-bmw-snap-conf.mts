import { writeFileSync, readFileSync } from 'node:fs';
import { snapToMaster, applySnap } from '../lib/domain/vehicle-master-match';

const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = master.entries || master;
const cases = [
  { fuel_type: '가솔린', model: 'BMW 120i', year: '2021' },
  { fuel_type: '가솔린', model: 'BMW 220i', year: '2021' },
  { fuel_type: '가솔린', maker: 'BMW', model: '1시리즈', sub_model: '1시리즈 F40', trim_name: '120i 스포츠', year: '2021' },
  { fuel_type: '가솔린', maker: 'BMW', model: '2시리즈', sub_model: '2시리즈 그란쿠페 F44', trim_name: '220i 어드밴티지', year: '2021' },
];
const out = cases.map((c) => {
  const res = snapToMaster(c as any, entries);
  const applied = res ? applySnap(c as any, res, { source: 'probe' }) : null;
  return {
    in: c,
    conf: res?.confidence,
    maker: applied?.maker,
    model: applied?.model,
    sub: applied?.sub_model,
    variant: applied?.variant,
    trim: applied?.trim_name,
  };
});
writeFileSync('tmp/inf-bmw-snap-probe.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('ok');
