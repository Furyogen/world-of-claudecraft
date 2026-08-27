// Pull the realm's Realm Builder of the Month roll into the world at boot.
//
// This sits between main.ts and src/net/realm_builder_roll.ts so main.ts keeps
// only a call: it is a firewall, not a home for feature wiring.
//
// DELIBERATELY NOT AWAITED by the caller. The plaque catching up a moment late
// is nothing; a slow or missing endpoint holding a player at the loading screen
// is not. Everything downstream fails quiet, so there is no error path to
// handle here either.

import { apiUrl } from '../client_origin';
import { loadRealmBuilderRoll } from '../net/realm_builder_roll';

/** The one thing the roll needs from the renderer once a name lands. */
export interface RealmBuilderHonoureeSink {
  setRealmBuilderHonouree(name: string): void;
}

/**
 * Fetch the roll and re-bake the monument's projected name.
 *
 * Safe whether it lands before or after the town is built: an early return
 * simply leaves the shipped placeholder showing, and a late one re-bakes a
 * statue that is already standing.
 */
export function startRealmBuilderRollLoad(sink: RealmBuilderHonoureeSink): void {
  void loadRealmBuilderRoll(apiUrl('/api/realm-builder')).then((name) => {
    if (name) sink.setRealmBuilderHonouree(name);
  });
}
