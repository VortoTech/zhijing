import test from 'node:test';
import assert from 'node:assert/strict';
import {safeSourceUrl, extractItem, dedupe, toModelPayload} from '../src/pipeline/extract.mjs';

function item(overrides = {}) {
  return {
    ContentID: '1',
    ContentType: 'Answer',
    Title: '标题',
    ContentText: '这是一段足够长的正文内容，用来通过非空校验。',
    Url: 'https://www.zhihu.com/question/1/answer/2',
    VoteUpCount: 12,
    CommentCount: 3,
    AuthorName: '作者',
    AuthorBadgeText: '新知答主',
    AuthorityLevel: 5,
    CommentInfoList: [{Content: '第一条评论内容够长'}, {Content: '第二条评论内容够长'}],
    ...overrides
  };
}

test('只接受知乎的 https 链接', () => {
  assert.equal(safeSourceUrl('https://www.zhihu.com/x'), true);
  assert.equal(safeSourceUrl('https://zhuanlan.zhihu.com/p/1'), true);
  assert.equal(safeSourceUrl('http://www.zhihu.com/x'), false);
  assert.equal(safeSourceUrl('https://evil.com/x'), false);
  assert.equal(safeSourceUrl('https://zhihu.com.evil.com/x'), false);
  assert.equal(safeSourceUrl('javascript:alert(1)'), false);
  assert.equal(safeSourceUrl(''), false);
});

test('非知乎来源整条被拒', () => {
  assert.equal(extractItem(item({Url: 'https://evil.com/x'})), null);
});

test('缺少正文或 id 被拒', () => {
  assert.equal(extractItem(item({ContentText: ''})), null);
  assert.equal(extractItem(item({ContentID: ''})), null);
  assert.equal(extractItem(null), null);
});

test('正文超长被截断到 12000', () => {
  const record = extractItem(item({ContentText: '字'.repeat(20000)}));
  assert.equal(record.text.length, 12000);
});

test('评论最多取 3 条，每条截断到 400', () => {
  const record = extractItem(item({
    CommentInfoList: Array.from({length: 8}, (_, i) => ({Content: `评论${i}-` + '字'.repeat(600)}))
  }));
  assert.equal(record.comments.length, 3);
  assert.ok(record.comments.every(c => c.length <= 400));
});

test('空评论被过滤', () => {
  const record = extractItem(item({CommentInfoList: [{Content: '  '}, {Content: '有效评论内容'}]}));
  assert.deepEqual(record.comments, ['有效评论内容']);
});

test('标题缺失时给兜底名', () => {
  assert.equal(extractItem(item({Title: ''})).title, '未命名内容');
});

test('去重按 ContentID，且保留首次出现', () => {
  const records = dedupe([
    item({ContentID: 'a', VoteUpCount: 1}),
    item({ContentID: 'b', VoteUpCount: 2}),
    item({ContentID: 'a', VoteUpCount: 99})
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].voteUp, 1);
});

test('去重受 limit 约束', () => {
  const many = Array.from({length: 30}, (_, i) => item({ContentID: `id-${i}`}));
  assert.equal(dedupe(many, {limit: 7}).length, 7);
});

test('送模型的载荷不含作者与赞数——防止模型用身份推断主张', () => {
  const [record] = dedupe([item()]);
  const [payload] = toModelPayload([record]);
  assert.deepEqual(Object.keys(payload).sort(), ['comments', 'id', 'text', 'title']);
  assert.equal(payload.author, undefined);
  assert.equal(payload.voteUp, undefined);
  assert.equal(payload.badge, undefined);
  assert.deepEqual(payload.comments[0], {index: 0, text: '第一条评论内容够长'});
});
