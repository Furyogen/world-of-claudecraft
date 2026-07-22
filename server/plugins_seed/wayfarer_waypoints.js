// Wayfarer Waypoints: never lose a spot again.
// Save your current position under a name (that herb circuit, the rare spawn,
// the meeting stone) and the list shows a live distance to each one, nearest
// first. Waypoints stay saved between sessions.

var MAX_WAYPOINTS = 12;

var panel = woc.ui.panel({ id: 'waypoints', title: 'Wayfarer Waypoints' });
var waypoints = woc.storage.get('list') || [];
var here = null;

function save() {
  woc.storage.set('list', waypoints);
}

function distanceTo(wp) {
  if (!here) return null;
  var dx = wp.x - here.x;
  var dz = wp.z - here.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function compass(wp) {
  if (!here) return '';
  var dx = wp.x - here.x;
  var dz = wp.z - here.z;
  if (Math.abs(dx) < 2 && Math.abs(dz) < 2) return 'here';
  var ns = dz > 0 ? 'S' : 'N';
  var ew = dx > 0 ? 'E' : 'W';
  if (Math.abs(dz) < Math.abs(dx) / 2) return ew;
  if (Math.abs(dx) < Math.abs(dz) / 2) return ns;
  return ns + ew;
}

woc.on('tick', function (snapshot) {
  here = snapshot;
  render();
});

function render() {
  var rows = waypoints.slice();
  rows.sort(function (a, b) {
    return (distanceTo(a) || 0) - (distanceTo(b) || 0);
  });
  var html =
    '<div style="display:flex;gap:6px;margin-bottom:6px">' +
    '<input type="text" data-name maxlength="24" placeholder="Name this spot"' +
    ' style="flex:1;min-width:0">' +
    '<button type="button" data-add style="cursor:pointer">Mark</button></div>';
  if (!rows.length) {
    html += '<div>No waypoints yet. Stand somewhere memorable and press Mark.</div>';
  }
  for (var i = 0; i < rows.length; i++) {
    var wp = rows[i];
    var d = distanceTo(wp);
    var where = d === null ? '' : Math.round(d) + ' yd ' + compass(wp);
    html +=
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
      '<span>' + woc.util.esc(wp.name) + '</span>' +
      '<span style="white-space:nowrap">' + woc.util.esc(where) +
      ' <button type="button" data-del="' + woc.util.esc(wp.name) + '"' +
      ' aria-label="Remove ' + woc.util.esc(wp.name) + '" style="cursor:pointer">x</button>' +
      '</span></div>';
  }
  panel.body.innerHTML = html;

  var addBtn = panel.body.querySelector('[data-add]');
  var nameInput = panel.body.querySelector('[data-name]');
  if (addBtn && nameInput) {
    addBtn.addEventListener('click', function () {
      var spot = woc.player();
      var name = String(nameInput.value || '').trim().slice(0, 24);
      if (!spot || !name) return;
      if (waypoints.length >= MAX_WAYPOINTS) {
        woc.ui.toast('Waypoint list is full. Remove one first.');
        return;
      }
      waypoints.push({ name: name, x: spot.x, z: spot.z });
      save();
      woc.ui.sound('click');
      render();
    });
  }
  var dels = panel.body.querySelectorAll('[data-del]');
  for (var j = 0; j < dels.length; j++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-del');
        waypoints = waypoints.filter(function (wp) {
          return wp.name !== name;
        });
        save();
        render();
      });
    })(dels[j]);
  }
}

render();
