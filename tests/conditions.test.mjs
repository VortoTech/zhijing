import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {verifyConditions,extractConditions} from '../src/pipeline/conditions.mjs';

const env={AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
const reply=content=>async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
const records=[
  {id:'a1',title:'考研还是工作 - 知乎',voteUp:10,text:'如果家里经济压力大，建议先工作。读研要三年没有收入。',comments:['本科985就不用读研了','说得好']},
  {id:'a2',title:'无关标题',voteUp:99,text:'别的内容',comments:[]}
];
const topic={id:'t',title:'考研还是工作',focusTerms:['考研'],excerptTerms:[]};

test('条件：只保留逐字出现的引文，映射回来源，丢弃没有证据的条件',async()=>{
  const result=await extractConditions(records,topic,env,{request:reply({conditions:[
    {label:'家庭经济压力大不大？',hint:'原话说压力大先工作',evidence:[
      {id:'r0',kind:'answer',quote:'如果家里经济压力大，建议先工作'},
      {id:'r0',kind:'answer',quote:'这句是编的不在原文里'}
    ]},
    {label:'本科是不是985？',evidence:[{id:'r0',kind:'comment',commentIndex:0,quote:'本科985就不用读研了'}]},
    {label:'来源不存在',evidence:[{id:'r9',kind:'answer',quote:'别的内容别的内容'}]},
    {label:'评论下标越界',evidence:[{id:'r0',kind:'comment',commentIndex:5,quote:'本科985就不用'}]}
  ]})});
  assert.equal(result.status,'complete');
  assert.deepEqual(result.conditions.map(c=>c.label),['家庭经济压力大不大？','本科是不是985？']);
  assert.deepEqual(result.conditions[0].evidence,[{recordId:'a1',kind:'answer',commentIndex:null,quote:'如果家里经济压力大，建议先工作'}]);
  assert.deepEqual(result.conditions[1].evidence,[{recordId:'a1',kind:'comment',commentIndex:0,quote:'本科985就不用读研了'}]);
  assert.equal(result.conditions[1].hint,'');
});

test('条件：最多 6 个、每个最多 3 条证据，过长标签与重复引文丢弃',()=>{
  const sources=new Map([['r0',records[0]]]);
  const text=records[0].text;
  const conditions=[
    {label:'很'.repeat(30),evidence:[{id:'r0',kind:'answer',quote:text.slice(0,8)}]},
    {label:'证据太多',evidence:[0,1,2,3,4].map(i=>({id:'r0',kind:'answer',quote:text.slice(i,i+7)}))},
    ...Array.from({length:8},(_,i)=>({label:'条件'+i,evidence:[{id:'r0',kind:'answer',quote:text.slice(10+i,18+i)}]})),
    {label:'重复引文',evidence:[{id:'r0',kind:'answer',quote:text.slice(0,7)}]}
  ];
  const out=verifyConditions({conditions},sources);
  assert.equal(out.length,6);
  assert.ok(!out.some(c=>c.label.startsWith('很')));
  assert.equal(out[0].evidence.length,3);
  assert.ok(!out.some(c=>c.label==='重复引文'));
});

test('条件：模型两次失败返回 failed 不抛错；没有相关来源返回 empty',async()=>{
  let calls=0;
  const failing=await extractConditions(records,topic,env,{request:async()=>{calls++;throw new Error('down');}});
  assert.deepEqual(failing,{status:'failed',conditions:[]});
  assert.equal(calls,2);
  const empty=await extractConditions([records[1]],topic,env,{request:async()=>assert.fail('不应调用模型')});
  assert.equal(empty.status,'empty');
});

test('离线样本的条件文件：每条引文都能在对应回答或评论里逐字找到',async()=>{
  const file=new URL('../data/conditions-first-job.json',import.meta.url);
  try{await access(file);}catch{return;}
  const conditions=JSON.parse(await readFile(file,'utf8'));
  const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url),'utf8'));
  const byId=new Map(snapshot.records.map(r=>[r.id,r]));
  assert.ok(conditions.conditions.length>0);
  for(const c of conditions.conditions)for(const e of c.evidence){
    const record=byId.get(e.recordId);
    assert.ok(record,`来源 ${e.recordId} 不在样本里`);
    const source=e.kind==='comment'?record.comments[e.commentIndex]:record.text;
    assert.ok(source.includes(e.quote),`引文不在原文里：${e.quote}`);
  }
});
