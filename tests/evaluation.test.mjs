import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../src/evaluation.mjs';

const objection={commentIndex:0,type:'counter_example'};
const gold={name:'synthetic-test-only',records:[{id:'a',sourceHash:'hash-a',objections:[objection]},{id:'b',sourceHash:'hash-b',objections:[objection]}]};
test('评估遗漏不缩小分母，误分类同时产生误检和漏检',()=>{
  const result=evaluate(gold,{records:[{id:'a',sourceHash:'hash-a',analysis:{status:'complete'},objections:[objection,{commentIndex:1,type:'off_topic'}]}]});
  assert.equal(result.tp,1);assert.equal(result.fp,1);assert.equal(result.fn,1);
  assert.equal(result.precision,0.5);assert.equal(result.recall,0.5);assert.equal(result.completionRate,0.5);
});
test('评估拒绝来源变化、重复记录和范围不一致',()=>{
  assert.throws(()=>evaluate(gold,{records:[{id:'a',sourceHash:'changed',objections:[]}]}),/来源版本/);
  assert.throws(()=>evaluate(gold,{records:[{id:'c',sourceHash:'x',objections:[]}]}),/范围/);
  assert.throws(()=>evaluate(gold,{records:[{id:'a'},{id:'a'}]}),/重复/);
});
test('无预测不报告虚假的百分之百准确率',()=>{
  const result=evaluate(gold,{records:[]});
  assert.equal(result.precision,null);assert.equal(result.recall,0);assert.equal(result.completionRate,0);
});
