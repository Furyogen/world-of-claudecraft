import type { MapPresentationMode } from './types';

export type InteriorPresentationMode = Exclude<MapPresentationMode, 'blank' | 'sowfield'>;

/** Authored maps use a bounded, flat slate instead of the shipped overworld. */
export function isAuthoredMapPresentation(mode: MapPresentationMode | undefined): boolean {
  return mode !== undefined;
}

/** Authored maps must not inherit the overworld grass/dirt splat textures. */
export function usesPlainTerrainMaterial(mode: MapPresentationMode | undefined): boolean {
  return isAuthoredMapPresentation(mode) && mode !== 'sowfield';
}

/** Procedural world foliage is global-coordinate scenery, never authored-map content. */
export function usesProceduralOverworldFoliage(mode: MapPresentationMode | undefined): boolean {
  return !isAuthoredMapPresentation(mode);
}

/** Interior authoring stays local while borrowing the live room's visual grade. */
export function interiorPresentationMode(
  mode: MapPresentationMode | undefined,
): InteriorPresentationMode | null {
  return mode && mode !== 'blank' && mode !== 'sowfield' ? mode : null;
}
