// Sequencing policy for a BACKGROUND zone prewarm (the visible-zone streaming
// lane, no loading screen). Live gameplay frames keep rendering while the
// per-template compile loop awaits idle slots below, so the prewarm groups
// MUST stay invisible for that whole window: a visible group is a grid of
// freshly built rigs with no animation mixer running, a pile of T-posed
// characters stacked next to the player. Hiding them is safe for the compile:
// three's compile()/compileAsync() prepare materials via scene.traverse (not
// traverseVisible), so hidden objects still link their programs. The groups
// turn visible only for the synchronous warm pass, inside the same task, so
// no awaited frame can ever paint them.

export interface PrewarmGroupLike {
  visible: boolean;
  children: readonly unknown[];
}

export interface BackgroundPrewarmHooks {
  /** KHR_parallel_shader_compile is available: link programs off-thread first. */
  supportsAsyncCompile: boolean;
  /** Wait for an idle slot between compile units (the renderer's idleSlot). */
  idleSlot: () => Promise<void>;
  /**
   * Compile one prewarm template's programs (the renderer's webgl.compileAsync,
   * raced against its timeout). One template per idle slot: even compileAsync's
   * synchronous prologue is a measured multi-hundred-ms stall when handed a
   * whole zone's batch at once.
   */
  compileChild: (child: unknown) => Promise<void>;
  /** The synchronous warm pass; the groups are visible exactly for this call. */
  renderWarmPass: () => void;
}

export async function runBackgroundPrewarm(
  groups: readonly PrewarmGroupLike[],
  hooks: BackgroundPrewarmHooks,
): Promise<void> {
  for (const group of groups) group.visible = false;
  try {
    if (hooks.supportsAsyncCompile) {
      for (const group of groups) {
        for (const child of [...group.children]) {
          await hooks.idleSlot();
          await hooks.compileChild(child);
        }
      }
      await hooks.idleSlot();
    }
    for (const group of groups) group.visible = true;
    hooks.renderWarmPass();
  } finally {
    for (const group of groups) group.visible = false;
  }
}
