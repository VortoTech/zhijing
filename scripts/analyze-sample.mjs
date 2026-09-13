// 样本可行性分析：给定一份探针原始数据和话题包，报告这个信号到底有多少。
//
// 不需要模型，也不需要凭据。它做的是「上界扫描」：把每条记录的评论过一遍
// 机械实质过滤（空话/附和/太短直接排除），数出**最多**可能有多少条实质异议。
// 真实分类只会比这个数字更少，不会更多。
//
// 用途：
//   1. 判断一个新话题值不值得上线，不用先花钱跑模型。
//   2. 作为负对照——信息型问题应该显著低于观点型问题，否则 422 拦截就没有依据。
//
// 用法：node scripts/analyze-sample.mjs data/raw/r-job.json first-job

import {readFile} from 'node:fs/promises';
import {dedupe} from '../src/pipeline/extract.mjs';
import {looksLikeEmptyPraise} from '../src/pipeline/verify.mjs';
import {buildReadingMap, FLAG_RATIO_THRESHOLD} from '../src/engine.mjs';
import {loadTopics, findTopic} from '../src/topics.mjs';

const root = new URL('../', import.meta.url);
const [, , rawPath, topicId] = process.argv;
if (!rawPath || !topicId) {
  console.error('用法：node scripts/analyze-sample.mjs <raw.json> <topicId>');
  process.exit(1);
}

const raw = JSON.parse(await readFile(new URL(rawPath, root), 'utf8'));
const topic = findTopic(await loadTopics(), topicId);

// 接口不保证按赞数返回，先排序再截断（否则高赞高讨论的条目会被上限切掉）。
const ordered = [...raw].sort((a, b) => (b.VoteUpCount ?? 0) - (a.VoteUpCount ?? 0));
const records = dedupe(ordered, {limit: 60});

// 上界扫描：不做语义判断，只排除明显不含信息的评论。
const comments = records.flatMap(r => r.comments);
const substantive = comments.filter(text => !looksLikeEmptyPraise(text));
const withSubstantive = records.filter(r => r.comments.some(text => !looksLikeEmptyPraise(text)));

const commentBearing = records.filter(r => r.comments.length).length;
const coverage = records.length ? commentBearing / records.length : 0;

// 顺带验证引擎能直接吃下提取层记录（没有 objections / claim）。
// 这是上界扫描的前提：诊断必须能在花钱跑模型之前跑。
buildReadingMap(records, {topic});

const pct = v => `${(v * 100).toFixed(1)}%`;

console.log(`话题      ${topic.id}  (${topic.kind}) — ${topic.title}`);
console.log(`数据      ${rawPath}  ${raw.length} 条原始 → 去重取前 ${records.length} 条`);
console.log('');
console.log('【评论数量】决定信号够不够');
console.log(`有精选评论的条目      ${commentBearing}/${records.length} = ${pct(coverage)}`);
console.log(`评论总数              ${comments.length}`);
console.log('');
console.log('【评论质量】决定信号干不干净');
console.log(`过机械实质过滤的评论  ${substantive.length}  (${pct(comments.length ? substantive.length / comments.length : 0)})`);
console.log(`至少有一条候选异议的   ${withSubstantive.length}/${records.length} = ${pct(records.length ? withSubstantive.length / records.length : 0)}`);
console.log('');
console.log(`话题声明覆盖率        ${topic.verified?.commentCoverage ?? '（未声明）'}`);

const declared = topic.verified?.commentCoverage;
if (declared != null) {
  const gap = Math.abs(coverage - declared);
  console.log(`与声明值的差          ${(gap * 100).toFixed(1)} 个百分点 → ${gap <= 0.06 ? '一致' : '不一致，需要复核声明值'}`);
}

// 机械实质过滤非常宽松：观点型样本里它放过 53%，而人工标注后的真实密度是 8%。
// 所以这个数字只能当**筛除**用，不能当**通过**用。
const upper = records.length ? withSubstantive.length / records.length : 0;
console.log('');
console.log(`标记密度上界（宽松）   ${withSubstantive.length}/${records.length} = ${pct(upper)}`);
console.log(upper < FLAG_RATIO_THRESHOLD
  ? `→ 上界已经低于门槛（${pct(FLAG_RATIO_THRESHOLD)}）。即使模型全部判对也撑不起三态标记，可以据此排除，不必配置凭据。`
  : '→ 上界高于门槛。但机械过滤过于宽松（观点型样本里真实密度只有上界的约六分之一），'
    + '这个结果**不能**用来判定话题可用，只能说明「不能据此排除」。是否可用必须靠真实分类。');
