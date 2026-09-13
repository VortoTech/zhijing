import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {askTopic} from '../src/ask.mjs';
import {createServer} from '../src/server.mjs';

const dir=new URL('../data/examples/',import.meta.url);
async function examples(){
  let files=[];
  try{files=(await readdir(dir)).filter(f=>f.endsWith('.json'));}catch{return [];}
  return Promise.all(files.map(async f=>({file:f,data:JSON.parse(await readFile(new URL(f,dir),'utf8'))})));
}
async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
const ask=(base,body)=>fetch(base+'/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('保存的示例：文件名与问题对应，对比完整，每段原话都能在原文里逐字找到',async()=>{
  for(const {file,data} of await examples()){
    assert.equal(file,askTopic(data.question,{queries:[]}).id+'.json');
    assert.equal(data.comparison.status,'complete');
    const byId=new Map(data.records.map(r=>[r.id,r]));
    const evidence=[...data.comparison.sides.flatMap(s=>s.reasons.flatMap(r=>r.evidence)),...data.comparison.forks.flatMap(f=>f.branches.flatMap(b=>b.evidence))];
    assert.ok(evidence.length>0);
    for(const e of evidence){
      const record=byId.get(e.recordId);
      assert.ok(record,`${file}：来源 ${e.recordId} 不在记录里`);
      assert.ok((e.kind==='comment'?record.comments[e.commentIndex]:record.text).includes(e.text),`${file}：原话不在原文里`);
    }
  }
});

test('保存的示例秒开：不需要实时凭据、不调上游；带 refresh 才走实时',async()=>{
  const [first]=await examples();
  if(!first)return;
  const deps={fetchTopic:async()=>assert.fail('不应检索'),classify:async()=>assert.fail('不应分类'),planQuestion:async()=>assert.fail('不应规划')};
  await serve(createServer({},deps),async base=>{
    const res=await ask(base,{question:first.data.question});
    assert.equal(res.status,200);
    const data=await res.json();
    assert.equal(data.meta.saved,true);
    assert.equal(data.meta.sessionKey,'ask:'+first.data.question);
    assert.equal(data.comparison.status,'complete');
    assert.equal((await ask(base,{question:first.data.question,refresh:true})).status,503);
  });
});
