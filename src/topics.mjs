import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const DIR=new URL('topics/',root);

export const KINDS=new Set(['opinion','informational']);

export function validateTopic(topic){
  if(!topic||typeof topic!=='object')throw new Error('话题包格式不正确');
  const {id,title,kind,queries,conditions,situationFields}=topic;
  if(typeof id!=='string'||!/^[a-z0-9-]{2,40}$/.test(id))throw new Error('话题 id 不合法');
  if(typeof title!=='string'||!title.trim())throw new Error('话题缺少标题');
  if(!KINDS.has(kind))throw new Error('话题 kind 必须是 opinion 或 informational');
  if(!Array.isArray(queries)||queries.length<4||queries.length>10)throw new Error('话题需要 4-10 路 query（单查询只有 10 条且无分页，必须多路扇出）');
  if(queries.some(q=>typeof q!=='string'||!q.trim()||q.length>60))throw new Error('query 必须是 60 字以内的非空字符串');
  if(new Set(queries).size!==queries.length)throw new Error('query 不能重复');
  if(!Array.isArray(conditions)||conditions.length<2||conditions.length>4)throw new Error('话题需要 2-4 个显式条件');
  if(conditions.some(c=>!c||typeof c.id!=='string'||typeof c.label!=='string'))throw new Error('条件需要 id 与 label');
  if(!Array.isArray(situationFields))throw new Error('话题缺少处境维度');
  if(topic.liveStatus!=null&&!['blocked','pilot','approved'].includes(topic.liveStatus))throw new Error('话题 liveStatus 不合法');
  return topic;
}

export function liveTopicEnabled(topic,env={}){
  return topic.kind==='opinion'&&(topic.liveStatus==='approved'||
    (topic.liveStatus==='pilot'&&env.ZHIJING_ENABLE_PILOT==='1'));
}

export async function loadTopics(){
  const files=(await readdir(DIR)).filter(f=>f.endsWith('.json')).sort();
  const topics=[];
  for(const file of files){
    const raw=await readFile(new URL(file,DIR),'utf8');
    topics.push(validateTopic(JSON.parse(raw)));
  }
  if(!topics.length)throw new Error('topics/ 下没有可用话题包');
  return topics;
}

export function findTopic(topics,id){
  const topic=topics.find(t=>t.id===id);
  if(!topic)throw new Error('未找到该话题');
  return topic;
}

export function topicSummary(topic){
  return {id:topic.id,title:topic.title,kind:topic.kind,liveStatus:topic.liveStatus||'blocked',verified:topic.verified||null,conditions:topic.conditions,situationFields:topic.situationFields};
}
