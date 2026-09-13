import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {dedupe} from '../src/pipeline/extract.mjs';
import {looksLikeEmptyPraise} from '../src/pipeline/verify.mjs';
import {buildReadingMap, FLAG_RATIO_THRESHOLD} from '../src/engine.mjs';
import {loadTopics, findTopic} from '../src/topics.mjs';

const root = new URL('../', import.meta.url);

async function sample(path) {
  const raw = JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const ordered = [...raw].sort((a, b) => (b.VoteUpCount ?? 0) - (a.VoteUpCount ?? 0));
  const records = dedupe(ordered, {limit: 60});
  const commentBearing = records.filter(r => r.comments.length).length;
  const candidates = records.filter(r => r.comments.some(t => !looksLikeEmptyPraise(t))).length;
  return {
    records,
    total: records.length,
    coverage: commentBearing / records.length,
    commentQuality: records.flatMap(r => r.comments).filter(t => !looksLikeEmptyPraise(t)).length
      / records.flatMap(r => r.comments).length,
    upperBound: candidates / records.length
  };
}

// 早期探针的原始数据（data/raw/）含知乎回答摘要与评论原文，不放进公开仓库；本地有数据时才跑依赖它的测试。
const RAW = ['data/raw/r-job.json', 'data/raw/r-luohu.json'];
const hasRaw = (await Promise.all(RAW.map(p => access(new URL(p, root)).then(() => true, () => false)))).every(Boolean);
const job = hasRaw ? await sample(RAW[0]) : null;
const luohu = hasRaw ? await sample(RAW[1]) : null;
const rawTest = (name, fn) => test(name, {skip: hasRaw ? false : '公开仓库不含 data/raw 原始探针数据'}, fn);
const topics = await loadTopics();

test('引擎必须能直接吃下提取层记录（没有 objections / claim）', () => {
  // 上界扫描和实时分类前的诊断都依赖这一点：不能因为还没分类就崩。
  const extractLayer = [{id: 'x', title: 't', text: '正文够长的一段话。', comments: [], url: 'https://www.zhihu.com/a'}];
  assert.doesNotThrow(() => buildReadingMap(extractLayer, {topic: findTopic(topics, 'first-job')}));
  const map = buildReadingMap(extractLayer, {topic: findTopic(topics, 'first-job')});
  assert.equal(map.records[0].trust.id, 'no_signal');
  assert.deepEqual(map.records[0].objections, []);
  assert.deepEqual(map.records[0].boundary, []);
});

test('缺 comments 字段也不崩', () => {
  const bare = [{id: 'x', title: 't', text: '正文够长的一段话。', url: 'https://www.zhihu.com/a'}];
  assert.doesNotThrow(() => buildReadingMap(bare, {topic: findTopic(topics, 'first-job')}));
});

rawTest('观点型样本：评论覆盖率过半', () => {
  assert.ok(job.coverage > 0.5, `实际 ${job.coverage}`);
});

rawTest('信息型样本：评论覆盖率显著更低', () => {
  assert.ok(luohu.coverage < 0.2, `实际 ${luohu.coverage}`);
  assert.ok(job.coverage - luohu.coverage > 0.3, '两类问题的覆盖率应拉开明显差距');
});

rawTest('两类的评论质量接近——差距来自数量而不是质量', () => {
  // 这条是边界论证的关键：信息型不是评论更水，是根本没有评论。
  assert.ok(Math.abs(job.commentQuality - luohu.commentQuality) < 0.15,
    `观点型 ${job.commentQuality} vs 信息型 ${luohu.commentQuality}`);
});

rawTest('信息型样本的标记密度上界低于门槛——422 拦截有数据依据', () => {
  // 即使模型把每条候选都判对，也到不了门槛。所以拒绝不是保守，是算术。
  assert.ok(luohu.upperBound < FLAG_RATIO_THRESHOLD,
    `上界 ${luohu.upperBound} 应低于门槛 ${FLAG_RATIO_THRESHOLD}`);
});

rawTest('观点型样本的上界高于门槛，因此上界只能用于排除、不能用于放行', () => {
  assert.ok(job.upperBound > FLAG_RATIO_THRESHOLD);
  // 但真实密度远低于上界（人工标注实测 8.3%），说明机械过滤过于宽松。
  assert.ok(job.upperBound > 0.4, '上界应当明显宽松');
});

rawTest('话题包声明的覆盖率与实测一致', () => {
  for (const [id, measured] of [['first-job', job.coverage], ['luohu-tax', luohu.coverage]]) {
    const declared = findTopic(topics, id).verified.commentCoverage;
    assert.ok(declared != null, `${id} 应声明覆盖率`);
    assert.ok(Math.abs(measured - declared) <= 0.06,
      `${id} 声明 ${declared} 实测 ${measured} 差距过大`);
  }
});

test('信息型话题仍被引擎拒绝，与负对照结论一致', async () => {
  const {createServer} = await import('../src/server.mjs');
  const server = createServer({});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/reading-map`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({topicId: 'luohu-tax'})
    });
    assert.equal(res.status, 422);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
