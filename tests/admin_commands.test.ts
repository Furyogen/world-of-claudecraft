import { describe, expect, it } from 'vitest';
import { parseAdminChatCommand, parseAdminTeleportArgs } from '../server/admin_commands';

describe('parseAdminChatCommand: the visibility toggle', () => {
  it('parses /invisible and /visible, case-insensitively', () => {
    expect(parseAdminChatCommand('/invisible')).toEqual({ kind: 'invisible' });
    expect(parseAdminChatCommand('/INVISIBLE')).toEqual({ kind: 'invisible' });
    expect(parseAdminChatCommand('  /visible  ')).toEqual({ kind: 'visible' });
  });

  it('ignores the toggles when they carry arguments', () => {
    // No argument form exists, so "/invisible Bob" is not this command at all;
    // it must fall through to ordinary chat rather than silently cloaking.
    expect(parseAdminChatCommand('/invisible Bob')).toBeNull();
    expect(parseAdminChatCommand('/visible please')).toBeNull();
  });
});

describe('parseAdminChatCommand: named targets', () => {
  it('accepts the quoted form for every named command', () => {
    expect(parseAdminChatCommand('/freeze "Bob"')).toEqual({ kind: 'freeze', name: 'Bob' });
    expect(parseAdminChatCommand('/unfreeze "Bob"')).toEqual({ kind: 'unfreeze', name: 'Bob' });
    expect(parseAdminChatCommand('/tpto "Bob"')).toEqual({ kind: 'tpto', name: 'Bob' });
    expect(parseAdminChatCommand('/tptome "Bob"')).toEqual({ kind: 'tptome', name: 'Bob' });
  });

  it('accepts a bare name and collapses inner whitespace', () => {
    expect(parseAdminChatCommand('/freeze Bob')).toEqual({ kind: 'freeze', name: 'Bob' });
    expect(parseAdminChatCommand('/tpto   Ashen   Vale ')).toEqual({
      kind: 'tpto',
      name: 'Ashen Vale',
    });
    expect(parseAdminChatCommand('/freeze "Ashen  Vale"')).toEqual({
      kind: 'freeze',
      name: 'Ashen Vale',
    });
  });

  it('reports a missing or malformed name as null, still claiming the command', () => {
    // Claimed (a command object) but nameless: the service answers with usage
    // instead of letting "/freeze" broadcast to the world as chat.
    expect(parseAdminChatCommand('/freeze')).toEqual({ kind: 'freeze', name: null });
    expect(parseAdminChatCommand('/unfreeze   ')).toEqual({ kind: 'unfreeze', name: null });
    expect(parseAdminChatCommand('/freeze ""')).toEqual({ kind: 'freeze', name: null });
    // A quoted name with trailing junk is rejected rather than truncated to "Bob".
    expect(parseAdminChatCommand('/tpto "Bob" extra')).toEqual({ kind: 'tpto', name: null });
  });

  it('keeps /tpto and /tptome from being read as /tp coordinates', () => {
    // The regression this ordering guards: an unanchored /tp rule would claim
    // "/tpto Bob" and try to parse "o Bob" as a position.
    expect(parseAdminChatCommand('/tpto Bob')).toEqual({ kind: 'tpto', name: 'Bob' });
    expect(parseAdminChatCommand('/tptome Bob')).toEqual({ kind: 'tptome', name: 'Bob' });
  });
});

describe('parseAdminTeleportArgs', () => {
  it('parses the documented comma form, with or without spaces', () => {
    expect(parseAdminTeleportArgs('-231, 1, 107')).toEqual({ x: -231, y: 1, z: 107 });
    expect(parseAdminTeleportArgs('-231,1,107')).toEqual({ x: -231, y: 1, z: 107 });
    expect(parseAdminTeleportArgs('  -231 ,  1 ,107 ')).toEqual({ x: -231, y: 1, z: 107 });
  });

  it('parses the space-separated and two-number forms', () => {
    expect(parseAdminTeleportArgs('-231 1 107')).toEqual({ x: -231, y: 1, z: 107 });
    // Two numbers mean (x, z): no height asked for, so the body lands on ground.
    expect(parseAdminTeleportArgs('-231, 107')).toEqual({ x: -231, y: null, z: 107 });
  });

  it('accepts fractional and explicitly signed coordinates', () => {
    expect(parseAdminTeleportArgs('+12.5, -3.25, 40')).toEqual({ x: 12.5, y: -3.25, z: 40 });
  });

  it('rejects anything that is not two or three plain numbers', () => {
    expect(parseAdminTeleportArgs('')).toBeNull();
    expect(parseAdminTeleportArgs('107')).toBeNull();
    expect(parseAdminTeleportArgs('1, 2, 3, 4')).toBeNull();
    expect(parseAdminTeleportArgs('1, two, 3')).toBeNull();
    expect(parseAdminTeleportArgs('1e5, 2, 3')).toBeNull();
    expect(parseAdminTeleportArgs('NaN, 2, 3')).toBeNull();
    expect(parseAdminTeleportArgs('Infinity, 2, 3')).toBeNull();
  });

  it('surfaces a malformed /tp as a claimed command with a null position', () => {
    expect(parseAdminChatCommand('/tp')).toEqual({ kind: 'tp', pos: null });
    expect(parseAdminChatCommand('/tp over there')).toEqual({ kind: 'tp', pos: null });
    expect(parseAdminChatCommand('/tp -231, 1, 107')).toEqual({
      kind: 'tp',
      pos: { x: -231, y: 1, z: 107 },
    });
  });
});

describe('parseAdminChatCommand: everything else is not ours', () => {
  it('returns null for ordinary chat and for neighbouring command families', () => {
    expect(parseAdminChatCommand('hello')).toBeNull();
    expect(parseAdminChatCommand('/freezer')).toBeNull();
    expect(parseAdminChatCommand('/tpx 1, 2')).toBeNull();
    expect(parseAdminChatCommand('/jail "Bob" 10')).toBeNull();
    expect(parseAdminChatCommand('/dev tp 10 20')).toBeNull();
  });
});
