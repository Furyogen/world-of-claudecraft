import { Sim } from './src/sim/sim.ts';
import { recalcPlayerStats } from './src/sim/entity.ts';
const CLASSES9 = ['warrior','paladin','shaman','rogue','hunter','druid','mage','priest','warlock'];
const FORMS = [null,'form_cat','form_bear','form_travel','form_moonkin'];
const out = [];
for (const cls of CLASSES9) for (const lvl of [1,5,10,15,20]) {
  const sim = new Sim({ seed: 11, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(lvl);
  const p = sim.player, meta = sim.meta(p.id);
  for (const form of FORMS) {
    p.auras.length = 0;
    if (form) p.auras.push({id:form,name:form,kind:form,remaining:3600,duration:3600,value:1,sourceId:p.id,school:'physical'});
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
    out.push([cls,lvl,form??'none',p.attackPower,p.stats.str,p.stats.agi,p.armor,p.critChance,p.dodgeChance].join('|'));
  }
}
console.log(out.join('\n'));
