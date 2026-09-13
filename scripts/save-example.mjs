// 把一个示例问题的实时结果存成离线文件，首页点示例时秒开：npm run save:example -- "考研还是直接工作"
// 会实际调用知乎检索和模型；结果写入 data/examples/ask-<hash>.json。对比图的原话由程序按编号从原文取出。
import {writeFile,mkdir} from 'node:fs/promises';
import {normalizeQuestion,planQuestion,askTopic,widenFocus} from '../src/ask.mjs';
import {fetchTopic} from '../src/pipeline/fetch.mjs';
import {classify} from '../src/pipeline/classify.mjs';
import {extractComparison} from '../src/pipeline/compare.mjs';

const question=normalizeQuestion(process.argv[2]||'');
const env=process.env;
const planned=await planQuestion(question,env);
if(planned.kind==='informational'){
  console.error('这是查资料类问题，不适合做示例。');
  process.exit(1);
}
const fetched=await fetchTopic(askTopic(question,planned),env);
if(fetched.meta.failedQueries){
  console.error(`检索有 ${fetched.meta.failedQueries} 路失败，请稍后重试。`);
  process.exit(1);
}
const topic=widenFocus(askTopic(question,planned),fetched.records);

// 示例要求分析完整；不完整时只重跑分析，检索结果复用。
let records,comparison;
for(let attempt=1;attempt<=3;attempt++){
  [records,comparison]=await Promise.all([classify(fetched.records,topic,env),extractComparison(fetched.records,topic,env)]);
  const incomplete=records.filter(r=>['failed','partial'].includes(r.analysis?.status)).length;
  if(comparison.status==='complete'&&!incomplete)break;
  console.error(`第 ${attempt} 次不完整：对比 ${comparison.status}，分析未完成 ${incomplete} 条。`);
  if(attempt===3)process.exit(1);
}

const root=new URL('../',import.meta.url);
await mkdir(new URL('data/examples/',root),{recursive:true});
await writeFile(new URL(`data/examples/${topic.id}.json`,root),JSON.stringify({
  question,
  savedAt:new Date().toISOString(),
  model:env.AI_MODEL||null,
  topic,
  records,
  comparison,
  meta:{...fetched.meta,mode:'live',question,planned:planned.planned}
},null,2)+'\n');

const [A,B]=comparison.options;
console.log(`已保存 ${topic.id}.json · ${A} ｜ ${B} · 理由 ${comparison.sides.map(s=>s.reasons.length).join('+')} · 分叉 ${comparison.forks.length} · 被读者反驳的回答 ${records.filter(r=>r.objections?.length).length}`);
comparison.forks.forEach((f,i)=>console.log(`  ${i+1}. ${f.label}  ${f.branches.map(b=>`${b.when}→${b.lean}`).join(' ｜ ')}`));
