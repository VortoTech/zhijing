import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTopic, loadTopics, findTopic, topicSummary} from '../src/topics.mjs';

function base(overrides = {}) {
  return {
    id: 'demo',
    title: '演示话题',
    kind: 'opinion',
    queries: ['q1', 'q2', 'q3', 'q4'],
    conditions: [{id: 'a', label: 'A'}, {id: 'b', label: 'B'}],
    situationFields: [],
    ...overrides
  };
}

test('合法话题包通过校验', () => {
  assert.doesNotThrow(() => validateTopic(base()));
});

test('query 少于 4 路被拒——单查询只有 10 条且无分页', () => {
  assert.throws(() => validateTopic(base({queries: ['a', 'b', 'c']})), /4-10 路 query/);
});

test('query 超过 10 路被拒', () => {
  const queries = Array.from({length: 11}, (_, i) => `q${i}`);
  assert.throws(() => validateTopic(base({queries})), /4-10 路 query/);
});

test('重复 query 被拒', () => {
  assert.throws(() => validateTopic(base({queries: ['a', 'a', 'b', 'c']})), /不能重复/);
});

test('kind 只接受 opinion 与 informational', () => {
  assert.throws(() => validateTopic(base({kind: 'news'})), /kind/);
});

test('条件少于 2 个被拒', () => {
  assert.throws(() => validateTopic(base({conditions: [{id: 'a', label: 'A'}]})), /2-4 个显式条件/);
});

test('话题 id 格式受限', () => {
  assert.throws(() => validateTopic(base({id: 'Bad_ID'})), /id 不合法/);
});

test('真实话题包都能加载，且 first-job 已标记已验证', async () => {
  const topics = await loadTopics();
  assert.ok(topics.length >= 2);
  const ids = topics.map(t => t.id);
  assert.ok(ids.includes('first-job'));
  const first = findTopic(topics, 'first-job');
  assert.equal(first.kind, 'opinion');
  assert.equal(first.verified.commentCoverage, 0.52);
  const summary = topicSummary(first);
  assert.ok(Array.isArray(summary.situationFields));
  assert.ok(summary.conditions.length >= 2);
});

test('kaoyan-vs-work 明确标注未验证', async () => {
  const topics = await loadTopics();
  const topic = findTopic(topics, 'kaoyan-vs-work');
  assert.equal(topic.verified.commentCoverage, null);
});

test('未知话题抛错', async () => {
  const topics = await loadTopics();
  assert.throws(() => findTopic(topics, 'nope'), /未找到该话题/);
});
