// 为离线样本生成「先确认这几件事」：npm run build:conditions -- first-job
// 会调用一次模型；结果写入 data/conditions-<话题>.json，引文已逐字校验。
import {readFile,writeFile} from 'node:fs/promises';
import {extractConditions} from '../src/pipeline/conditions.mjs';

const id=process.argv[2]||'first-job';
const root=new URL('../',import.meta.url);
const topic=JSON.parse(await readFile(new URL(`topics/${id}.json`,root),'utf8'));
const snapshot=JSON.parse(await readFile(new URL(`data/snapshot-${id}.json`,root),'utf8'));

const result=await extractConditions(snapshot.records,topic,process.env);
if(result.status!=='complete'||!result.conditions.length){
  console.error(`整理失败或为空：${result.status}`);
  process.exit(1);
}
await writeFile(new URL(`data/conditions-${id}.json`,root),JSON.stringify({
  topicId:id,
  builtAt:new Date().toISOString(),
  model:process.env.AI_MODEL||null,
  status:'complete',
  conditions:result.conditions
},null,2)+'\n');
console.log(result.conditions.map((c,i)=>`${i+1}. ${c.label}（${c.evidence.length} 条原话）`).join('\n'));
