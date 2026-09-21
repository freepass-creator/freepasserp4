/** Offline shared F01/F86 dry-run. Never writes to Sheets or re-publishes data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { planSheetContract, type SheetContractSnapshot } from '../lib/domain/sheet-contract-plan';
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv.includes('--apply')) throw new Error('HOLD: no approved formatting-only workflow; direct production writes forbidden');
const input = arg('snapshot');
const output = arg('out');
if (!input || !output) throw new Error('Required: --snapshot=<normalized read-only snapshot> --out=<new plan file>');
const plan = planSheetContract(JSON.parse(readFileSync(input, 'utf8')) as SheetContractSnapshot);
writeFileSync(output, JSON.stringify(plan, null, 2), { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ status: plan.status, holds: plan.holds, diff: plan.diff, output }, null, 2));
if (plan.status === 'HOLD') process.exitCode = 2;
