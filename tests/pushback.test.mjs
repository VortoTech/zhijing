import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pushbackFor} from '../src/engine.mjs';

const record={id:'a',text:'公司给你的薪资，就是他们心目中你的价值。你肯定应该选认可你更高价值的那一个雇主。',comments:['x','y'],objections:[
  {commentIndex:1,type:'adds_condition',typeLabel:'补充适用条件',targetClaim:'',commentText:'y'},
  {commentIndex:0,type:'off_topic',typeLabel:'答非所问',targetClaim:'公司给你的薪资，就是他们心目中你的价值',commentText:'x'}
]};

test('原话下的读者反驳：与被引用句重合的标为针对这句并排在前',()=>{
  const direct=pushbackFor(record,{recordId:'a',kind:'answer',text:'公司给你的薪资，就是他们心目中你的价值。'});
  assert.deepEqual(direct.map(o=>[o.type,o.direct]),[['off_topic',true],['adds_condition',false]]);
  const other=pushbackFor(record,{recordId:'a',kind:'answer',text:'你肯定应该选认可你更高价值的那一个雇主。'});
  assert.equal(other.length,2);
  assert.ok(other.every(o=>!o.direct));
});

test('评论本身、缺少来源或没有异议时不挂反驳',()=>{
  assert.deepEqual(pushbackFor(record,{recordId:'a',kind:'comment',text:'x'}),[]);
  assert.deepEqual(pushbackFor(null,{kind:'answer',text:'公司给你的薪资'}),[]);
  assert.deepEqual(pushbackFor({...record,objections:[]},{kind:'answer',text:'公司给你的薪资'}),[]);
});

test('离线示例：对比图里至少有一句原话挂着评论区反驳（演示用的突出点）',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url),'utf8'));
  const comparison=JSON.parse(await readFile(new URL('../data/compare-first-job.json',import.meta.url),'utf8'));
  const byId=new Map(snapshot.records.map(r=>[r.id,r]));
  const evidence=[...comparison.sides.flatMap(s=>s.reasons.flatMap(r=>r.evidence)),...comparison.forks.flatMap(f=>f.branches.flatMap(b=>b.evidence))];
  assert.ok(evidence.some(e=>pushbackFor(byId.get(e.recordId),e).length>0));
});
