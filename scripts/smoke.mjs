// 默认只读离线接口；--live 必须显式指定，可能消耗知乎与模型额度。
import assert from 'node:assert/strict';

const live=process.argv.includes('--live');
const base=process.env.ZHIJING_BASE_URL||'http://127.0.0.1:4318';
try{
  const config=await (await fetch(base+'/api/config',{signal:AbortSignal.timeout(10000)})).json();
  if(live&&!config.liveReady)throw new Error('实时凭据或话题试用开关未就绪');
  const start=Date.now();
  const res=await fetch(base+'/api/reading-map',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({topicId:'first-job',mode:live?'live':'snapshot'}),
    signal:AbortSignal.timeout(130000)
  });
  if(!res.ok)throw new Error('阅读接口失败：HTTP '+res.status);
  const data=await res.json();
  assert.equal(data.meta.mode,live?'live':'snapshot');
  assert.equal(data.topic.id,'first-job');
  assert.ok(data.records.length>0);
  assert.equal(data.records.length,data.diagnostics.total);
  if(live)assert.equal(data.records.length,data.meta.selectedCount);
  for(const r of data.records){
    for(const o of r.objections){
      assert.equal(o.commentText,r.comments[o.commentIndex]);
      if(o.targetClaim)assert.ok(r.text.includes(o.targetClaim));
    }
    if(['partial','failed'].includes(r.analysis?.status)&&!r.objections.length)assert.equal(r.trust.id,'incomplete');
  }
  const incomplete=data.diagnostics.analysisIncomplete||0,failedQueries=data.meta.failedQueries||0;
  console.log(JSON.stringify({mode:data.meta.mode,requestId:data.meta.requestId,durationMs:Date.now()-start,records:data.records.length,flagged:data.diagnostics.flagged,incomplete,failedQueries,complete:!incomplete&&!failedQueries},null,2));
  if(incomplete||failedQueries)process.exitCode=2;
}catch(error){console.error('冒烟检查失败：'+error.message);process.exitCode=1;}
