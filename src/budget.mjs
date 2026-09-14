// 应用进程内的调用预算，不代表知乎平台账户的剩余额度。
export function dailyBudget(raw,fallback=200,now=Date.now){
  const parsed=Number(raw);
  const limit=Number.isSafeInteger(parsed)&&parsed>0?parsed:fallback;
  let day='',used=0;
  function snapshot(){
    const today=new Date(now()+8*3600*1000).toISOString().slice(0,10);
    if(today!==day){day=today;used=0;}
    return {day,limit,used,remaining:Math.max(0,limit-used),resetsAt:new Date(Date.parse(day+'T00:00:00+08:00')+86400000).toISOString()};
  }
  return {snapshot,take(){if(!snapshot().remaining)return false;used++;return true;}};
}
