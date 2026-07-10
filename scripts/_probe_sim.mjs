import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const b = await puppeteer.launch({ executablePath: EDGE, headless:'new', args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'], defaultViewport:{width:1600,height:1000}});
const p = await b.newPage();
const PORT=process.env.PORT||'5174';
await p.goto('http://localhost:'+PORT,{waitUntil:'networkidle0',timeout:40000});
const c=(s)=>p.evaluate((x)=>document.querySelector(x)?.click(),s);
await new Promise(r=>setTimeout(r,500)); await c('#btn-offline'); await new Promise(r=>setTimeout(r,300));
await p.type('#char-name','Zed'); await c('#offline-select .mini-class[data-class="warrior"]'); await c('#btn-start-offline');
await p.waitForFunction(()=>window.__game?.sim?.player,{timeout:45000}); await new Promise(r=>setTimeout(r,1500));
const api = await p.evaluate(()=>{
  const g=window.__game; const sim=g.sim;
  return {
    gameKeys:Object.keys(g).slice(0,40),
    simMethods:['setDungeonDifficulty','enterDungeon','applyAura','spawnMob','ctx'].map(k=>k+':'+typeof sim[k]),
    ctxMethods: sim.ctx? ['createMob','addEntity','applyAura','instances','entities','nextId'].map(k=>k+':'+typeof sim.ctx[k]) : 'no ctx',
    hasMOBS: !!(g.MOBS||sim.MOBS),
  };
});
console.log(JSON.stringify(api,null,1));
await b.close();
