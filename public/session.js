// 当前结果只属于一个话题和模式，失效结果不能被筛选操作恢复。
export function createReadingSession(){
  let revision=0,current=null,controller=null;
  return {
    begin(key){
      controller?.abort();controller=new AbortController();current=null;
      return {revision:++revision,key,signal:controller.signal};
    },
    accept(ticket,data){
      if(ticket.revision!==revision||ticket.signal.aborted)return false;
      if(`${data.topic?.id}:${data.meta?.mode}`!==ticket.key)return false;
      current=data;return true;
    },
    active(ticket){return ticket.revision===revision;},
    get(){return current;},
    cancel(){controller?.abort();current=null;revision++;}
  };
}
