// Draws the player's own dot icons on an enemy nameplate: tile, artwork, cooldown
// swipe, school-tinted border and countdown, one icon per slot. A painter-side
// drawing helper the canvas surface calls, the drawNameplateLootIcon shape, so
// nameplate_canvas.ts stays a compositor rather than growing another method bank.
//
// The row's geometry and its slot records come from the pure
// nameplate_dots_core.ts; nothing is decided here.

import type { TextSpriteStyle } from '../ui/text_sprite_cache';
import {
  NAMEPLATE_DOT_GAP,
  NAMEPLATE_DOT_SIZE,
  NAMEPLATE_DOT_TIMER_STEP,
  type NameplateDotsPlan,
  nameplateDotRowWidth,
} from './nameplate_dots_core';

/** The dot-row countdown. Small, heavy and stroked so a one-decimal number stays
 *  readable against grass, stone or a lit VFX. */
export const NAMEPLATE_DOT_TIME_STYLE: TextSpriteStyle = {
  font: '700 7px Arial, sans-serif',
  fill: '#eeeeee',
  stroke: '#000',
  lineWidth: 1.5,
};

// The countdown turns amber in an aura's final seconds, the one colour change in
// the row. It is REDUNDANT with the number itself shrinking toward zero, so a
// player who cannot separate the two colours loses nothing (and forced-colors
// collapses both to CanvasText, which is why the number is the real cue).
const TIME_EXPIRING_FILL = '#ffcf40';
const TIME_EXPIRING_SEC = 4;

// Magic-school tints for the icon border, byte-identical to the --color-debuff-*
// tokens the DOM aura strips use (src/styles/tokens.css), so one school reads the
// same on a nameplate, on the target frame and in the Target dots frame.
const SCHOOL_TINTS: Readonly<Record<string, string>> = {
  fire: '#e8722a',
  frost: '#4aa3df',
  arcane: '#3f8cff',
  shadow: '#9b59d0',
  nature: '#35a835',
  holy: '#d8b56b',
  physical: '#c0392b',
};
const SCHOOL_DEFAULT_TINT = '#c0392b';
const TILE_FILL = '#0e1118';
const SWIPE_FILL = 'rgba(4, 6, 10, 0.62)';
const TILE_RADIUS = 2;

/** What the row borrows from the canvas surface: its rounded-rect pen, its image
 *  cache, its text-sprite cache, and its forced-colors state. Injected rather
 *  than imported so this module owns no cache of its own. */
export interface NameplateDotRowHost {
  forcedColors(): boolean;
  roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void;
  drawImage(url: string, x: number, y: number, size: number): void;
  drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    style: TextSpriteStyle,
    fill: string,
  ): void;
}

/**
 * Draw `plan`'s icons centred on `centerX`, with `topY` as the row's top edge in
 * plate units (the caller has already subtracted nameplateDotRowHeight).
 */
export function drawNameplateDotRow(
  ctx: CanvasRenderingContext2D,
  plan: NameplateDotsPlan,
  centerX: number,
  topY: number,
  host: NameplateDotRowHost,
): void {
  const forced = host.forcedColors();
  let x = centerX - nameplateDotRowWidth(plan.count) / 2;
  for (let i = 0; i < plan.count; i++) {
    const slot = plan.slots[i];
    host.roundedRect(ctx, x, topY, NAMEPLATE_DOT_SIZE, NAMEPLATE_DOT_SIZE, TILE_RADIUS);
    ctx.fillStyle = forced ? 'Canvas' : TILE_FILL;
    ctx.fill();

    if (slot.iconUrl) {
      ctx.save();
      host.roundedRect(ctx, x, topY, NAMEPLATE_DOT_SIZE, NAMEPLATE_DOT_SIZE, TILE_RADIUS);
      ctx.clip();
      host.drawImage(slot.iconUrl, x, topY, NAMEPLATE_DOT_SIZE);
      ctx.restore();
    }

    // Cooldown swipe: the SPENT part of the duration darkens clockwise from
    // twelve, so how much is left reads without parsing the number.
    if (slot.fraction < 1) {
      ctx.save();
      host.roundedRect(ctx, x, topY, NAMEPLATE_DOT_SIZE, NAMEPLATE_DOT_SIZE, TILE_RADIUS);
      ctx.clip();
      const cx = x + NAMEPLATE_DOT_SIZE / 2;
      const cy = topY + NAMEPLATE_DOT_SIZE / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(
        cx,
        cy,
        NAMEPLATE_DOT_SIZE,
        -Math.PI / 2 + Math.PI * 2 * slot.fraction,
        Math.PI * 1.5,
      );
      ctx.closePath();
      ctx.fillStyle = forced ? 'Canvas' : SWIPE_FILL;
      ctx.fill();
      ctx.restore();
    }

    host.roundedRect(
      ctx,
      x + 0.5,
      topY + 0.5,
      NAMEPLATE_DOT_SIZE - 1,
      NAMEPLATE_DOT_SIZE - 1,
      TILE_RADIUS,
    );
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = forced ? 'CanvasText' : (SCHOOL_TINTS[slot.school] ?? SCHOOL_DEFAULT_TINT);
    ctx.stroke();

    if (slot.timeText) {
      host.drawText(
        ctx,
        slot.timeText,
        x + NAMEPLATE_DOT_SIZE / 2,
        topY + NAMEPLATE_DOT_SIZE + NAMEPLATE_DOT_TIMER_STEP - 1,
        NAMEPLATE_DOT_TIME_STYLE,
        slot.remaining <= TIME_EXPIRING_SEC ? TIME_EXPIRING_FILL : NAMEPLATE_DOT_TIME_STYLE.fill,
      );
    }
    x += NAMEPLATE_DOT_SIZE + NAMEPLATE_DOT_GAP;
  }
}
