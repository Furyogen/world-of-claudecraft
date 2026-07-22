// Chat Chimes: never miss your name again.
// Plays a soft chime and shows a toast when someone says your name in chat,
// and always chimes for whispers. Channels can be muted individually and the
// choices are remembered.

var CHANNELS = ['say', 'yell', 'whisper', 'party', 'guild', 'general', 'world', 'lfg'];

var panel = woc.ui.panel({ id: 'chimes', title: 'Chat Chimes' });
var muted = woc.storage.get('muted') || {};
var recent = [];

function mentioned(text, name) {
  if (!text || !name) return false;
  return text.toLowerCase().indexOf(name.toLowerCase()) !== -1;
}

woc.on('chat', function (ev) {
  var me = woc.player();
  if (!me || ev.from === me.name) return;
  var channel = ev.channel || 'say';
  if (muted[channel]) return;
  var isWhisper = channel === 'whisper';
  if (!isWhisper && !mentioned(ev.text, me.name)) return;
  woc.ui.sound('chime');
  woc.ui.toast((isWhisper ? 'Whisper from ' : 'Mentioned by ') + ev.from);
  recent.unshift({ from: ev.from, channel: channel });
  if (recent.length > 5) recent.pop();
  render();
});

function render() {
  var html = '<div style="margin-bottom:4px"><b>Listening on</b></div><div>';
  for (var i = 0; i < CHANNELS.length; i++) {
    var channel = CHANNELS[i];
    var off = muted[channel];
    html +=
      '<button type="button" data-ch="' + channel + '" style="cursor:pointer;margin:2px;' +
      (off ? 'opacity:0.45' : '') + '">' + woc.util.esc(channel) + '</button>';
  }
  html += '</div>';
  if (recent.length) {
    html += '<hr style="border-color:#3a2f1b"><div><b>Recent pings</b></div>';
    for (var j = 0; j < recent.length; j++) {
      html +=
        '<div>' + woc.util.esc(recent[j].from) +
        ' <span style="opacity:0.7">(' + woc.util.esc(recent[j].channel) + ')</span></div>';
    }
  }
  panel.body.innerHTML = html;
  var buttons = panel.body.querySelectorAll('[data-ch]');
  for (var k = 0; k < buttons.length; k++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var channel = btn.getAttribute('data-ch');
        muted[channel] = !muted[channel];
        woc.storage.set('muted', muted);
        render();
      });
    })(buttons[k]);
  }
}

render();
