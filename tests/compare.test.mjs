import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {buildSnippets,verifyComparison,extractComparison} from '../src/pipeline/compare.mjs';

const env={AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
const reply=content=>async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
const records=[
  {id:'a1',title:'考研还是工作 - 知乎',voteUp:10,text:'读研要三年没有收入。如果家里经济压力大，建议先工作。考研能提升学历门槛，拿到更好的岗位。',comments:['本科985就不用读研了','说得好']},
  {id:'a2',title:'无关标题',voteUp:99,text:'别的内容，别的内容，别的内容。',comments:[]}
];
const topic={id:'t',title:'考研还是工作',focusTerms:['考研'],excerptTerms:[]};

test('切句编号：只取相关来源，句子与评论都能在原文里逐字找到',()=>{
  const {sources,snippets}=buildSnippets(records,topic);
  assert.equal(sources.length,1);
  assert.deepEqual([...snippets.keys()],['r0s0','r0s1','r0s2','r0c0','r0c1']);
  for(const s of snippets.values()){
    const record=records.find(r=>r.id===s.recordId);
    assert.ok((s.kind==='comment'?record.comments[s.commentIndex]:record.text).includes(s.text));
  }
  assert.match(sources[0].sentences[0],/^r0s0\|/);
});

test('校验：无效编号、同向分支、两边共用原话、选项之外的分支都丢弃；分支按选项顺序排列',()=>{
  const {snippets}=buildSnippets(records,topic);
  const out=verifyComparison({
    options:['考研','工作'],
    sides:[
      {option:'考研',reasons:[{label:'提升学历',evidence:['r0s2','r9s9']}]},
      {option:'工作',reasons:[{label:'没有收入',evidence:['r0s0']},{label:'无证据',evidence:['bogus']}]}
    ],
    forks:[
      {label:'家里经济压力大吗？',branches:[{when:'压力大',lean:'工作',evidence:['r0s1']},{when:'本科985',lean:'考研',evidence:['r0c0']}]},
      {label:'同向',branches:[{when:'甲',lean:'考研',evidence:['r0s0']},{when:'乙',lean:'考研',evidence:['r0s1']}]},
      {label:'共用原话',branches:[{when:'甲',lean:'考研',evidence:['r0s0']},{when:'乙',lean:'工作',evidence:['r0s0']}]},
      {label:'选项之外',branches:[{when:'甲',lean:'出国',evidence:['r0s0']},{when:'乙',lean:'工作',evidence:['r0s1']}]}
    ]
  },snippets);
  assert.deepEqual(out.options,['考研','工作']);
  assert.deepEqual(out.sides[0].reasons,[{label:'提升学历',evidence:[{recordId:'a1',kind:'answer',commentIndex:null,text:'考研能提升学历门槛，拿到更好的岗位。'}]}]);
  assert.equal(out.sides[1].reasons.length,1);
  assert.equal(out.forks.length,1);
  assert.deepEqual(out.forks[0].branches.map(b=>b.lean),['考研','工作']);
  assert.deepEqual(out.forks[0].branches[0].evidence,[{recordId:'a1',kind:'comment',commentIndex:0,text:'本科985就不用读研了'}]);
});

test('整理：不是二选一返回 not_comparable；模型两次失败返回 failed；没有相关来源返回 empty',async()=>{
  assert.equal((await extractComparison(records,topic,env,{request:reply({options:['只有一个']})})).status,'not_comparable');
  let calls=0;
  const failing=await extractComparison(records,topic,env,{request:async()=>{calls++;throw new Error('down');}});
  assert.equal(failing.status,'failed');
  assert.equal(calls,2);
  assert.equal((await extractComparison([records[1]],topic,env,{request:async()=>assert.fail('不应调用模型')})).status,'empty');
});

test('离线样本的对比图：每段原话都能在对应回答或评论里逐字找到',async()=>{
  const file=new URL('../data/compare-first-job.json',import.meta.url);
  try{await access(file);}catch{return;}
  const comparison=JSON.parse(await readFile(file,'utf8'));
  const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url),'utf8'));
  const byId=new Map(snapshot.records.map(r=>[r.id,r]));
  assert.equal(comparison.status,'complete');
  const evidence=[...comparison.sides.flatMap(s=>s.reasons.flatMap(r=>r.evidence)),...comparison.forks.flatMap(f=>f.branches.flatMap(b=>b.evidence))];
  assert.ok(evidence.length>0);
  for(const e of evidence){
    const record=byId.get(e.recordId);
    assert.ok(record,`来源 ${e.recordId} 不在样本里`);
    assert.ok((e.kind==='comment'?record.comments[e.commentIndex]:record.text).includes(e.text),`原话不在原文里：${e.text}`);
  }
});
