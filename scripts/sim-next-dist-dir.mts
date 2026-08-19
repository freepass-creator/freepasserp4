import assert from 'node:assert/strict';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import nextConfig from '../next.config.mjs';

const previous = process.env.NEXT_DIST_DIR;
delete process.env.NEXT_DIST_DIR;
assert.equal(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir, '.next-dev');
assert.equal(nextConfig(PHASE_PRODUCTION_BUILD).distDir, '.next');
process.env.NEXT_DIST_DIR = '.next-qa';
assert.equal(nextConfig(PHASE_DEVELOPMENT_SERVER).distDir, '.next-qa');
if (previous === undefined) delete process.env.NEXT_DIST_DIR;
else process.env.NEXT_DIST_DIR = previous;

console.log('sim-next-dist-dir: PASS');
