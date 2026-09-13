import {readFile} from 'node:fs/promises';
import {evaluate} from '../src/evaluation.mjs';

const [goldPath,predictionPath]=process.argv.slice(2);
if(!goldPath||!predictionPath){
  console.error('用法：node scripts/evaluate.mjs <人工金标准.json> <预测结果.json>');
  process.exitCode=1;
}else{
  try{
    const gold=JSON.parse(await readFile(goldPath,'utf8'));
    const prediction=JSON.parse(await readFile(predictionPath,'utf8'));
    console.log(JSON.stringify(evaluate(gold,prediction),null,2));
  }catch(error){console.error('评估失败：'+error.message);process.exitCode=1;}
}
