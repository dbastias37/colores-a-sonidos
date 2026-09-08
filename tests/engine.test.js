import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine } from '../src/audio/engine.js'
class Param { constructor(){this.value=0} setValueAtTime(v){this.value=v} linearRampToValueAtTime(v){this.value=v} setTargetAtTime(v){this.value=v} cancelScheduledValues(){} }
class Node {
  constructor(){this.gain=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();this.stopped=false}
  connect(){} disconnect(){this.disconnected=true} start(time,offset){this.startTime=time;this.offset=offset} stop(){this.stopped=true}
}
class Context {
  constructor(){this.state='running';this.currentTime=0;this.destination=new Node();this.created=[]}
  createGain(){return new Node()} createDynamicsCompressor(){return new Node()}
  createBufferSource(){const n=new Node();this.created.push(n);return n}
  resume(){this.state='running';return Promise.resolve()} close(){this.state='closed';return Promise.resolve()}
}
globalThis.AudioContext=Context
const stems=()=>({duration:32,buffers:{melody:{},harmony:{},drone:{}}})
test('play uses exactly three sources; pause/resume preserves time and releases old sources', async()=>{
 const engine=new AudioEngine();engine.load(stems());await engine.play()
 assert.equal(engine.sources.length,3);assert.ok(engine.sources.every(s=>s.loop))
 engine.context.currentTime=10.04;assert.equal(engine.position(),10)
 const old=engine.sources;engine.pause();assert.equal(engine.offset,10);assert.ok(old.every(s=>s.stopped))
 await engine.play();assert.equal(engine.sources.length,3);assert.ok(engine.sources.every(s=>s.offset===10))
 await engine.seek(6);assert.equal(engine.sources.length,3);assert.equal(engine.offset,6)
 engine.dispose();assert.equal(engine.stems,null);assert.equal(engine.sources.length,0)
})
test('pause cancels a pending play and loading another image clears the previous composition', async()=>{
 const engine=new AudioEngine();engine.load(stems())
 const promise=engine.play();engine.pause();await promise;assert.equal(engine.playing,false);assert.equal(engine.sources.length,0)
 await engine.play();const old=engine.sources;engine.load(stems());assert.ok(old.every(s=>s.stopped));assert.equal(engine.playing,false);assert.equal(engine.offset,0)
 engine.setMix('melody',2);assert.equal(engine.mix.melody,1)
 engine.clear();assert.equal(engine.stems,null);engine.dispose()
})
