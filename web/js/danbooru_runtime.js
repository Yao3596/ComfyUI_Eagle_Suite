/** Small, renderer-independent helpers for the Danbooru workspace. */
export function createLatestRequest() {
  let version=0, controller=null;
  return {
    begin() {
      controller?.abort();
      const ownController=controller=new AbortController();
      const ownVersion=++version;
      return {signal:ownController.signal,isCurrent:()=>version===ownVersion&&!ownController.signal.aborted};
    },
    cancel() { ++version; controller?.abort(); controller=null; },
  };
}

export function createSharedJsonReader(fetcher=async url=>(await fetch(url)).json()) {
  const cache=new Map();
  const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
  const read=(url,{fresh=false,maxAge=5000}={})=>{
    let entry=cache.get(url);
    if(fresh||!entry||(entry.done&&Date.now()-entry.at>=maxAge)) {
      entry={done:false,at:0,promise:null};
      const current=entry;
      entry.promise=Promise.resolve().then(()=>fetcher(url)).then(value=>{
        if(cache.get(url)===current){current.done=true;current.at=Date.now();}
        return value;
      }).catch(error=>{if(cache.get(url)===current)cache.delete(url);throw error;});
      cache.set(url,entry);
    }
    return entry.promise.then(clone);
  };
  read.invalidate=url=>url?cache.delete(url):cache.clear();
  return read;
}

export function gridWindow({count=0,width=0,height=400,scrollTop=0,minWidth=160,rowHeight=180,gap=12,overscan=2}={}) {
  count=Math.max(0,Math.floor(Number(count)||0));
  const columns=Math.max(1,Math.floor(((Number(width)||0)+gap)/(minWidth+gap)));
  if(!count)return {columns,start:0,end:0,top:0,bottom:0};
  const rows=Math.ceil(count/columns),stride=rowHeight+gap;
  const first=Math.min(rows-1,Math.max(0,Math.floor(scrollTop/stride)));
  const startRow=Math.max(0,first-overscan);
  const endRow=Math.min(rows,Math.max(first+1,Math.ceil((scrollTop+Math.max(0,height))/stride))+overscan);
  return {columns,start:startRow*columns,end:Math.min(count,endRow*columns),top:startRow*stride,bottom:(rows-endRow)*stride};
}
