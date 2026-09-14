import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n,translateEnglish} from '../public/i18n.js';
import {buildGuidance} from '../public/advisor.js';

test('language preference toggles and persists without a browser',()=>{
  const values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const i18n=createI18n(storage);
  assert.equal(i18n.language,'zh');
  assert.equal(i18n.text('发送'),'发送');
  i18n.toggle();
  assert.equal(i18n.language,'en');
  assert.equal(i18n.text('发送'),'Send');
  assert.equal(values.get('zhijing-language'),'en');
});

test('dynamic interface labels translate while source content remains unchanged',()=>{
  assert.equal(translateEnglish('已等待 12 秒'),'Waited 12 seconds');
  assert.equal(translateEnglish('知乎 · 观点 A'),'Zhihu · View A');
  assert.equal(translateEnglish('选高薪小公司'),'Choose High-paying small company');
  assert.equal(translateEnglish('反方挑战 · 知镜'),'Opposing challenge · Zhijing');
  assert.equal(translateEnglish('全部结果：60 条；取得评论：34 条；被反驳或补充前提：5 条；分析完成：34 条；未完成：0 条；无评论：26 条。'),'All results: 60; with comments: 34; challenged or qualified: 5; analysis complete: 34; incomplete: 0; without comments: 26.');
  assert.equal(translateEnglish('第一份工作选高薪小公司还是低薪大厂'),'第一份工作选高薪小公司还是低薪大厂');
});

test('guidance supports English without changing option source text',()=>{
  const block={status:'complete',options:['高薪小公司','低薪大厂'],forks:[{label:'更看重什么',branches:[{when:'成长速度',lean:'高薪小公司',evidence:[]}]}]};
  const empty=buildGuidance(block,{},'en');
  assert.equal(empty.title,'Start with a few situations that resemble yours');
  const picked=buildGuidance(block,{0:0},'en');
  assert.match(picked.title,/高薪小公司/);
  assert.match(picked.title,/Your selected situations/);
});
