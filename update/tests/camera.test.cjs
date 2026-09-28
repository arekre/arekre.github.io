const assert = require('node:assert/strict');
const {CameraSession,coverCrop}=require('../camera.js');
(async()=>{
 for(const [sw,sh,dw,dh] of [[1920,1080,1027,1180],[720,1280,1027,1180],[1280,720,720,1280]]){
  const c=coverCrop(sw,sh,dw,dh);
  assert.ok(c.x>=0&&c.y>=0&&c.width<=sw+.00001&&c.height<=sh+.00001);
  assert.ok(Math.abs(c.width/c.height-dw/dh)<1e-10);
 }
 assert.throws(()=>coverCrop(0,1080,1027,1180));
 const pending=[];let stops=0;
 const stream=()=>({getTracks:()=>[{stop:()=>stops++}]});
 const camera=new CameraSession({getUserMedia:()=>new Promise(resolve=>pending.push(resolve))});
 const first=camera.open('user').catch(e=>e.name);camera.stop();pending.shift()(stream());
 assert.equal(await first,'AbortError');assert.equal(stops,1);assert.equal(camera.stream,null);
 const a=camera.open('user').catch(e=>e.name),b=camera.open('environment');
 pending.shift()(stream());const active=stream();pending.shift()(active);
 assert.equal(await a,'AbortError');assert.equal(await b,active);assert.equal(camera.stream,active);
 camera.stop();assert.equal(stops,3);
 console.log('PASS: crop 3 aspect ratios, invalid size, late permission, concurrent requests, track cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
