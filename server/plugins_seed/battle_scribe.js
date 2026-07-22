// Battle Scribe: a personal damage and healing meter.
// Segments combat automatically: a pull starts on your first hit and closes
// after 6 quiet seconds. Shows live DPS, the top abilities of the current
// pull, and remembers your best pull this session.

var IDLE_MS = 6000;
var TOP_ABILITIES = 5;

var panel = woc.ui.panel({ id: 'meter', title: 'Battle Scribe' });
var me = null;
var pull = null;
var best = null;

function newPull(now) {
  return { start: now, last: now, damage: 0, healing: 0, byAbility: {} };
}

function pullSeconds(p) {
  return Math.max(1, (p.last - p.start) / 1000);
}

function endPull() {
  if (!pull) return;
  if (!best || pull.damage / pullSeconds(pull) > best.damage / pullSeconds(best)) best = pull;
  pull = null;
  render();
}

woc.on('combat', function (ev) {
  if (!me) me = woc.player();
  if (!me) return;
  var now = Date.now();
  if (ev.kind === 'damage' && ev.sourceId === me.id) {
    if (!pull) pull = newPull(now);
    pull.last = now;
    pull.damage += ev.amount;
    var name = ev.ability || 'Attack';
    pull.byAbility[name] = (pull.byAbility[name] || 0) + ev.amount;
    render();
  } else if (ev.kind === 'heal' && ev.targetId === me.id && pull) {
    pull.last = now;
    pull.healing += ev.amount;
  }
});

woc.on('tick', function (snapshot) {
  me = snapshot;
  if (pull && Date.now() - pull.last > IDLE_MS) endPull();
});

woc.on('death', function () {
  endPull();
});

function barRows(p) {
  var entries = [];
  for (var name in p.byAbility) entries.push([name, p.byAbility[name]]);
  entries.sort(function (a, b) {
    return b[1] - a[1];
  });
  entries = entries.slice(0, TOP_ABILITIES);
  var max = entries.length ? entries[0][1] : 1;
  var html = '';
  for (var i = 0; i < entries.length; i++) {
    var pct = Math.round((entries[i][1] / max) * 100);
    html +=
      '<div style="margin:2px 0"><div style="display:flex;justify-content:space-between;gap:8px">' +
      '<span>' + woc.util.esc(entries[i][0]) + '</span>' +
      '<span>' + woc.util.formatNumber(entries[i][1]) + '</span></div>' +
      '<div style="height:4px;background:#3a2f1b;border-radius:2px">' +
      '<div style="height:4px;width:' + pct + '%;background:#c9a227;border-radius:2px"></div>' +
      '</div></div>';
  }
  return html;
}

function summaryLine(label, p) {
  var dps = p.damage / pullSeconds(p);
  return (
    '<div style="display:flex;justify-content:space-between;gap:8px">' +
    '<b>' + woc.util.esc(label) + '</b>' +
    '<span>' + woc.util.formatNumber(Math.round(dps)) + ' dps</span></div>'
  );
}

function render() {
  var html = '';
  if (pull) {
    html += summaryLine('This pull', pull) + barRows(pull);
  } else {
    html += '<div>Waiting for a pull...</div>';
  }
  if (best) {
    html += '<hr style="border-color:#3a2f1b">' + summaryLine('Best pull', best);
  }
  panel.body.innerHTML = html;
}

render();
