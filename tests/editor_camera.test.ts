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

  it('caps fly speed when the camera is zoomed far out', () => {
    const camera = new EditorCamera();
    camera.dist = 600;
    camera.fly(1, 0, 0, 1);

    expect(camera.target.length()).toBeLessThanOrEqual(112.001);
  });

  it('normalizes diagonal flight to the same speed as straight flight', () => {
    const straight = new EditorCamera();
    straight.fly(1, 0, 0, 1);

    const diagonal = new EditorCamera();
    diagonal.fly(1, 1, 1, 1);

    expect(diagonal.target.length()).toBeCloseTo(straight.target.length(), 6);
  });

  it('limits one extreme wheel event to a controlled zoom step', () => {
    const camera = new EditorCamera();
    camera.dist = 70;
    camera.zoom(10_000);

    expect(camera.dist).toBeLessThan(90);
  });
});
