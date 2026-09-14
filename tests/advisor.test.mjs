import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildGuidance} from '../public/advisor.js';

const block=JSON.parse(await readFile(new URL('../data/compare-first-job.json',import.meta.url),'utf8'));

test('未选择条件时只邀请用户补充情况，不给答案',()=>{
  const result=buildGuidance(block,{});
  assert.equal(result.state,'empty');
  assert.equal(result.picked.length,0);
  assert.equal(result.remaining.length,block.forks.length);
  assert.doesNotMatch(result.message,/应该选|更适合你/);
});

test('单侧相关时明确是阅读线索而不是结论',()=>{
  const result=buildGuidance(block,{0:0});
  assert.equal(result.state,'focused');
  assert.equal(result.groups.length,1);
  assert.equal(result.groups[0].option,block.forks[0].branches[0].lean);
  assert.ok(result.groups[0].evidence.length>0);
  assert.match(result.message,/相关/);
  assert.match(result.message,/不代表/);
});

test('条件牵动两边时不做机械多数票',()=>{
  const opposite=block.forks.findIndex((f,index)=>index>0&&f.branches.some(b=>b.lean!==block.forks[0].branches[0].lean));
  const branch=block.forks[opposite].branches.findIndex(b=>b.lean!==block.forks[0].branches[0].lean);
  const result=buildGuidance(block,{0:0,[opposite]:branch});
  assert.equal(result.state,'mixed');
  assert.equal(result.groups.length,2);
  assert.match(result.message,/哪个条件更重要/);
  assert.doesNotMatch(result.message,/胜率|推荐指数|应该选/);
});
