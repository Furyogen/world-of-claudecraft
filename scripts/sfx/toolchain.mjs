import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

function pathExists(path) {
  return typeof path === 'string' && path.length > 0 && existsSync(path);
}

function commandWorks(command) {
  if (typeof command !== 'string' || command.length === 0) return false;
  const result = spawnSync(command, ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return !result.error && result.status === 0;
}

export function resolveFfmpegPath(preferred = null) {
  if (pathExists(preferred) || commandWorks(preferred)) return preferred;
  if (process.env.WOC_SFX_DISABLE_STATIC_TOOLCHAIN === '1') return preferred || 'ffmpeg';
  if (pathExists(ffmpegStatic)) return ffmpegStatic;
  return preferred || 'ffmpeg';
}

export function resolveFfprobePath(preferred = null) {
  if (pathExists(preferred) || commandWorks(preferred)) return preferred;
  if (process.env.WOC_SFX_DISABLE_STATIC_TOOLCHAIN === '1') return preferred || 'ffprobe';
  if (pathExists(ffprobeStatic?.path)) return ffprobeStatic.path;
  return preferred || 'ffprobe';
}

export function hasRunnableFfprobe(preferred = null) {
  const resolved = resolveFfprobePath(preferred);
  return pathExists(resolved) || commandWorks(resolved);
}
