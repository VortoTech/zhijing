// 离线评分：金标准必须独立人工核对；不能用模型输出给自己打分。
export function evaluate(gold,prediction){
  if(!Array.isArray(gold.records)||!gold.records.length||!Array.isArray(prediction.records))throw new Error('评估需要非空 gold.records 和 prediction.records');
  const predicted=new Map();
  for(const r of prediction.records){
    if(predicted.has(r.id))throw new Error('预测记录 id 重复');
    predicted.set(r.id,r);
  }
  const seen=new Set();let tp=0,fp=0,fn=0,completed=0;
  const perRecord=[];
  const keys=items=>{
    if(!Array.isArray(items))throw new Error('异议标注必须是数组');
    return new Set(items.map(o=>{
      if(!Number.isInteger(o.commentIndex)||o.commentIndex<0||typeof o.type!=='string')throw new Error('异议标注格式不正确');
      return `${o.commentIndex}:${o.type}`;
    }));
  };
  for(const expected of gold.records){
    if(!expected.id||seen.has(expected.id)||!expected.sourceHash)throw new Error('金标准需要唯一 id 与 sourceHash');
    seen.add(expected.id);
    const actual=predicted.get(expected.id);
    if(actual&&actual.sourceHash!==expected.sourceHash)throw new Error('来源版本不一致，不能评分');
    const want=keys(expected.objections),got=keys(actual?.objections||[]);
    let correct=0,extra=0,missed=0;
    for(const key of got)want.has(key)?correct++:extra++;
    for(const key of want)if(!got.has(key))missed++;
    tp+=correct;fp+=extra;fn+=missed;
    if(actual&&actual.analysis?.status==='complete')completed++;
    perRecord.push({id:expected.id,tp:correct,fp:extra,fn:missed,status:actual?.analysis?.status||'unknown'});
  }
  if([...predicted.keys()].some(id=>!seen.has(id)))throw new Error('预测包含金标准以外的记录，请先对齐评估范围');
  return {dataset:gold.name||'unnamed',records:gold.records.length,tp,fp,fn,
    precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,
    completed,completionRate:completed/gold.records.length,perRecord,
    note:'按评论下标与类型评分；不自动证明目标句关联正确或评论观点成立。漏回记录计入漏检，不从分母删除。'};
}
