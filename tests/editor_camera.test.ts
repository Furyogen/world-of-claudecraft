import { describe, expect, it } from 'vitest';
import { EditorCamera } from '../src/editor/3d/editor_camera';

describe('editor camera drag direction', () => {
  it('follows a rightward pointer drag by default', () => {
    const orbit = new EditorCamera();
    orbit.orbit(20, 0);
    expect(orbit.pose().pos.x).toBeGreaterThan(0);

    const pan = new EditorCamera();
    pan.pan(20, 0);
    expect(pan.target.x).toBeGreaterThan(0);

    const look = new EditorCamera();
    look.look(20, 0);
    expect(look.pose().target.x).toBeGreaterThan(0);
  });
});
