import assert from 'node:assert/strict';
import { createLatestRequest, createSharedJsonReader, gridWindow } from '../web/js/danbooru_runtime.js';

const requests=createLatestRequest();
const first=requests.begin();
const second=requests.begin();
assert.equal(first.signal.aborted,true);
assert.equal(first.isCurrent(),false,'an older response must not replace a newer search');
assert.equal(second.isCurrent(),true);
requests.cancel();
assert.equal(second.isCurrent(),false);
assert.equal(second.signal.aborted,true);

let calls=0,resolveRead;
const read=createSharedJsonReader(()=>{calls++;return new Promise(resolve=>{resolveRead=resolve;});});
const one=read('/settings');const two=read('/settings');
await Promise.resolve();
assert.equal(calls,1,'identical node reads must share the in-flight request');
resolveRead({success:true,settings:{nested:{value:1}}});
const [a,b]=await Promise.all([one,two]);
a.settings.nested.value=2;
assert.equal(b.settings.nested.value,1,'Vue state must not be shared between nodes');
assert.equal((await read('/settings')).settings.nested.value,1);
assert.equal(calls,1);
read.invalidate('/settings');
const fresh=read('/settings');await Promise.resolve();
assert.equal(calls,2);resolveRead({success:true,settings:{}});await fresh;

assert.deepEqual(gridWindow({count:1000,width:500,height:400,scrollTop:0,minWidth:150,rowHeight:230,gap:10,overscan:1}),
  {columns:3,start:0,end:9,top:0,bottom:79440});
const middle=gridWindow({count:1000,width:500,height:400,scrollTop:2400,minWidth:150,rowHeight:230,gap:10,overscan:1});
assert.equal(middle.start,27);assert.equal(middle.end,39);
assert.equal(middle.top,2160);
assert.ok(middle.end-middle.start<20,'loaded pages must not create unbounded card DOM');
assert.equal(gridWindow({count:1,width:100,height:300,scrollTop:500}).start,0);
assert.equal(gridWindow({count:0,width:100,height:300,scrollTop:500}).end,0);
console.log('Danbooru request ownership, shared reads and windowed grid: PASS');
