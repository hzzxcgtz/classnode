import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from '../lib/project.mjs';

test('four Node test shards cover every file exactly once',t=>{
 const folder=mkdtempSync(path.join(tmpdir(),'cn-shards-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 for(let i=0;i<9;i++)writeFileSync(path.join(folder,`${i}.test.cjs`),`require('node:test')('SHARD_FILE_${i}',()=>{});`);
 const found=[];
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(let shard=1;shard<=4;shard++){
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-shard=${shard}/4`,'--test-concurrency=2','*.test.cjs'],{cwd:folder,env,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);found.push(...[...result.stdout.matchAll(/^# Subtest: SHARD_FILE_(\d+)$/gm)].map(match=>Number(match[1])));
 }
 assert.deepEqual(found.sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);
});

test('packaging waits for all regression shards and each shard retains its test logs',()=>{
 const workflow=readFileSync(path.join(root,'.github/workflows/build.yml'),'utf8');
 assert.match(workflow,/shard: \[1, 2, 3, 4\]/);
 assert.match(workflow,/needs: \[prep, regression\]/);
 assert.match(workflow,/--test-shard=\$\{\{ matrix.shard \}\}\/4 --test-concurrency=2/);
 assert.match(workflow,/regression-logs-shard-\$\{\{ matrix.shard \}\}/);
 assert.doesNotMatch(workflow,/run: pnpm test\s*\n/);
});
