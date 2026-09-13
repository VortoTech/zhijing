// 为离线样本生成对比图：npm run build:comparison -- first-job ["整理时用的问题说法"]
// 会调用一次模型；结果写入 data/compare-<话题>.json，引文由程序按编号从原文取出。
// 话题标题把两件事混在一起时（如「高薪还是成长」其实对应「小公司还是大厂」），可以给出更贴近原话的问法。
import {readFile,writeFile} from 'node:fs/promises';
import {extractComparison} from '../src/pipeline/compare.mjs';

const id=process.argv[2]||'first-job';
const question=process.argv[3]||null;
const root=new URL('../',import.meta.url);
const topic=JSON.parse(await readFile(new URL(`topics/${id}.json`,root),'utf8'));
const snapshot=JSON.parse(await readFile(new URL(`data/snapshot-${id}.json`,root),'utf8'));

const result=await extractComparison(snapshot.records,question?{...topic,title:question}:topic,process.env);
if(result.status!=='complete'){
  console.error(`整理失败：${result.status}`);
  process.exit(1);
}
await writeFile(new URL(`data/compare-${id}.json`,root),JSON.stringify({
  topicId:id,
  builtAt:new Date().toISOString(),
  model:process.env.AI_MODEL||null,
  question:question||topic.title,
  ...result
},null,2)+'\n');
const [A,B]=result.options;
console.log(`选项：${A} ｜ ${B}`);
for(const side of result.sides)console.log(`选${side.option}的人说：${side.reasons.map(r=>r.label).join('、')||'（无）'}`);
result.forks.forEach((f,i)=>console.log(`${i+1}. ${f.label}  ${f.branches.map(b=>`${b.when}→${b.lean}`).join(' ｜ ')}`));
