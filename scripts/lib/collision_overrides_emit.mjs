// Shared emit + validation for the Collision Master override table: used by
// scripts/gen_collision_overrides.mjs (CLI) and the vite dev save endpoint
// (vite.config.ts collisionMasterSavePlugin), so both write byte-identical
// modules. Pure: no filesystem access here.

const ASSET_ID_RE = /^[a-z0-9_]+\/[a-z0-9_.-]+$/i;
const MAX_BOXES = 64;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 4) => {
  const p = 10 ** places;
  return Math.round(v * p) / p;
};

/** Validate one override entry; returns an error string or null. */
export function validateOverride(assetId, o) {
  if (!ASSET_ID_RE.test(assetId)) return `bad asset id: ${assetId}`;
  if (!o || typeof o !== 'object') return `${assetId}: not an object`;
  if (o.mode !== 'baked' && o.mode !== 'basic' && o.mode !== 'none') {
    return `${assetId}: bad mode`;
  }
  if (o.shape !== undefined && o.shape !== 'square') return `${assetId}: bad shape`;
  if (o.radius !== undefined && !(isNum(o.radius) && o.radius > 0 && o.radius <= 60)) {
    return `${assetId}: bad radius`;
  }
  if (o.boxes !== undefined) {
    if (!Array.isArray(o.boxes) || o.boxes.length > MAX_BOXES) return `${assetId}: bad boxes`;
    for (const b of o.boxes) {
      if (
        !b ||
        !isNum(b.x) ||
        !isNum(b.y) ||
        !isNum(b.z) ||
        !isNum(b.hx) ||
        !isNum(b.hy) ||
        !isNum(b.hz) ||
        b.hx <= 0 ||
        b.hy <= 0 ||
        b.hz <= 0 ||
        Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.z)) > 100 ||
        Math.max(b.hx, b.hy, b.hz) > 60 ||
        (b.ry !== undefined && !isNum(b.ry))
      ) {
        return `${assetId}: bad box`;
      }
    }
  }
  if (o.mode === 'baked' && (!o.boxes || o.boxes.length === 0)) {
    return `${assetId}: baked override needs boxes`;
  }
  return null;
}

/** Emit the generated TS module for an override map. Returns {source, errors}. */
export function emitCollisionOverridesModule(overrides) {
  const errors = [];
  const ids = Object.keys(overrides).sort();
  for (const id of ids) {
    const err = validateOverride(id, overrides[id]);
    if (err) errors.push(err);
  }
  const lines = [
    '// GENERATED from data/asset_collision_overrides.json - do not edit by hand.',
    "// Authored per-asset collision from the editor's Collision Master tool: the",
    '// dev server endpoint (/__collision_master/save) updates the JSON and this',
    '// module together; scripts/gen_collision_overrides.mjs regenerates it too.',
    "// An entry here is the asset's DEFAULT collision everywhere: authored boxes",
    '// beat the voxel bake (asset_collision.ts), and the mode/shape stamp fresh',
    '// placements (editor collision_defaults.ts).',
    '',
    "import type { MapHitbox } from './map_doc';",
    '',
    'export interface AssetCollisionOverride {',
    "  /** Placement default: 'baked' renders the authored boxes, 'basic' a circle",
    "   *  or square footprint, 'none' no collision. */",
    "  mode: 'baked' | 'basic' | 'none';",
    '  /** basic-mode footprint shape; absent = circle. */',
    "  shape?: 'square';",
    '  /** basic-mode radius/half-extent in model-space yards at scale 1; absent =',
    '   *  the fitted/derived auto radius. */',
    '  radius?: number;',
    '  /** Authored boxes (normalized model space, optional per-box yaw). Read in',
    "   *  'baked' mode; they replace the asset's voxel-baked set. */",
    '  boxes?: readonly MapHitbox[];',
    '}',
    '',
    'export const ASSET_COLLISION_OVERRIDES: Readonly<Record<string, AssetCollisionOverride>> = {',
  ];
  for (const id of ids) {
    const o = overrides[id];
    const parts = [`mode: '${o.mode}'`];
    if (o.shape === 'square') parts.push("shape: 'square'");
    if (o.radius !== undefined) parts.push(`radius: ${round(o.radius)}`);
    if (o.boxes !== undefined && o.boxes.length > 0) {
      const boxes = o.boxes
        .map((b) => {
          const fields = [
            `x: ${round(b.x)}`,
            `y: ${round(b.y)}`,
            `z: ${round(b.z)}`,
            `hx: ${round(b.hx)}`,
            `hy: ${round(b.hy)}`,
            `hz: ${round(b.hz)}`,
          ];
          if (b.ry !== undefined && b.ry !== 0) fields.push(`ry: ${round(b.ry)}`);
          return `{ ${fields.join(', ')} }`;
        })
        .join(', ');
      parts.push(`boxes: [${boxes}]`);
    }
    lines.push(`  '${id}': { ${parts.join(', ')} },`);
  }
  lines.push('};', '');
  return { source: lines.join('\n'), errors };
}
