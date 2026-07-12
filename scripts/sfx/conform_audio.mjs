// Shared sampled-SFX conformance primitives. The bulk CLI, deterministic UI
// generator, and Studio publisher can all use this module without importing a
// command with top-level side effects.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  classify,
  DURATION_THRESHOLD,
  LOSSLESS_EXTENSIONS,
  NORM_TOLERANCE,
  TARGET_BITRATE,
  TARGET_LUFS,
  TARGET_PEAK_DBFS,
  TARGET_SAMPLE_RATE,
} from './sfx_conform_rules.mjs';
import { hasRunnableFfprobe, resolveFfmpegPath, resolveFfprobePath } from './toolchain.mjs';

export const SFX_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.aiff',
  '.aif',
  '.ogg',
  '.opus',
  '.m4a',
]);

function run(binary, args, options = {}) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', options.capture ? 'pipe' : 'ignore', options.capture ? 'pipe' : 'ignore'],
    });
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(detail || `${basename(binary)} failed`);
  }
}

export function probeSfxAudio(file, ffprobePath) {
  const resolvedFfprobe = resolveFfprobePath(ffprobePath);
  if (!hasRunnableFfprobe(resolvedFfprobe)) {
    return probeSfxAudioWithFfmpeg(file, resolveFfmpegPath());
  }
  const output = run(
    resolvedFfprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    { capture: true },
  );
  const info = JSON.parse(output);
  const stream = info.streams?.find((value) => value.codec_type === 'audio');
  const duration = Number.parseFloat(info.format?.duration ?? '0');
  // Container overhead dominates very short MP3s, so format.bit_rate can report
  // well above the actual encoded stream rate. The stream value is the quality
  // contract; retain the format value only as a fallback for codecs that omit it.
  const bitrate = Math.round(
    Number.parseInt(stream?.bit_rate ?? info.format?.bit_rate ?? '0', 10) / 1000,
  );
  const sampleRate = Number.parseInt(stream?.sample_rate ?? '0', 10);
  if (!(duration > 0) || !(sampleRate > 0)) {
    throw new Error(`ffprobe returned invalid audio metadata for ${basename(file)}`);
  }
  return {
    duration,
    bitrate,
    sampleRate,
    codec: stream?.codec_name ?? '',
    channels: Number(stream?.channels) || 0,
  };
}

function secondsFromDuration(value) {
  const match = String(value).match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function channelsFromStream(stream) {
  if (/\bmono\b/i.test(stream)) return 1;
  if (/\bstereo\b/i.test(stream)) return 2;
  const match = stream.match(/,\s*(\d+)\s+channels?\b/i);
  return match ? Number(match[1]) : 0;
}

function probeSfxAudioWithFfmpeg(file, ffmpegPath) {
  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-nostdin', '-i', file, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || `${basename(ffmpegPath)} failed`).trim());
  }
  const report = String(result.stderr ?? '');
  const stream = report.match(/Stream #.*Audio:\s*([^\n]+)/i)?.[1] ?? '';
  const duration = secondsFromDuration(report.match(/Duration:\s*([^,\n]+)/i)?.[1] ?? '');
  const sampleRate = Number(stream.match(/\b(\d+)\s*Hz\b/i)?.[1] ?? 0);
  const bitrate = Number(stream.match(/,\s*(\d+)\s*kb\/s\b/i)?.[1] ?? 0);
  if (!(duration > 0) || !(sampleRate > 0)) {
    throw new Error(`ffmpeg returned invalid audio metadata for ${basename(file)}`);
  }
  return {
    duration,
    bitrate,
    sampleRate,
    codec: stream.split(',')[0]?.trim().split(/\s+/)[0] ?? '',
    channels: channelsFromStream(stream),
  };
}

function captureFfmpegReport(file, filter, ffmpegPath) {
  const resolvedFfmpeg = resolveFfmpegPath(ffmpegPath);
  const result = spawnSync(
    resolvedFfmpeg,
    ['-hide_banner', '-nostdin', '-i', file, '-af', filter, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || `${basename(resolvedFfmpeg)} failed`).trim());
  }
  return String(result.stderr ?? '');
}

export function measureSfxTruePeakDb(file, ffmpegPath) {
  const report = captureFfmpegReport(file, 'ebur128=peak=true', ffmpegPath);
  const match = report.match(/True peak:\s*Peak:\s*(-?inf|[-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*dBFS/i);
  if (!match || match[1].toLowerCase() === '-inf') {
    throw new Error(`ebur128 true-peak parse failed for ${basename(file)}`);
  }
  return Number.parseFloat(match[1]);
}

export function measureSfxLufs(file, ffmpegPath) {
  const report = captureFfmpegReport(file, 'ebur128=peak=true', ffmpegPath);
  const matches = [...report.matchAll(/I:\s*(-?inf|[-\d.]+)\s*LUFS/gi)];
  const value = matches.at(-1)?.[1];
  if (!value || value.toLowerCase() === '-inf') {
    throw new Error(`ebur128 parse failed for ${basename(file)}`);
  }
  return Number.parseFloat(value);
}

const LONG_FORM_LIMIT_DB = -1;
const LONG_FORM_LIMIT = Number((10 ** (LONG_FORM_LIMIT_DB / 20)).toFixed(8));

function filterNumber(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function buildSfxConformArgs({ inputFile, outputFile, duration, gainDb }) {
  const normBranch = duration < DURATION_THRESHOLD ? 'peak' : 'lufs';
  if (!Number.isFinite(gainDb)) throw new Error('SFX conformance requires a finite gain');
  const filters = [`volume=${filterNumber(gainDb)}dB`];
  if (normBranch === 'lufs') {
    // Sustained material can have a crest factor that makes -14 LUFS exceed a
    // safe codec peak. A fixed limiter controls only that true-peak edge while
    // the iterative linear gain below closes the integrated-loudness error.
    // This remains an overall-level/peak operation, never a timing or EQ edit.
    filters.push(`alimiter=limit=${LONG_FORM_LIMIT}:attack=5:release=50:level=false:latency=true`);
  }
  filters.push(`aformat=sample_rates=${TARGET_SAMPLE_RATE}`);
  return {
    normBranch,
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      inputFile,
      '-af',
      filters.join(','),
      '-ar',
      String(TARGET_SAMPLE_RATE),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      `${TARGET_BITRATE}k`,
      '-write_xing',
      '1',
      '-map_metadata',
      '-1',
      outputFile,
    ],
  };
}

/** Conform one source to an MP3 without changing or deleting the input file. */
export function conformSfxAudio({ inputFile, outputFile, duration, ffmpegPath, peakDb = null }) {
  const normBranch = duration < DURATION_THRESHOLD ? 'peak' : 'lufs';
  const measuredInput =
    normBranch === 'peak'
      ? Number.isFinite(peakDb)
        ? peakDb
        : measureSfxTruePeakDb(inputFile, ffmpegPath)
      : measureSfxLufs(inputFile, ffmpegPath);
  const target = normBranch === 'peak' ? TARGET_PEAK_DBFS : TARGET_LUFS;
  let gainDb = target - measuredInput;
  const temporary = join(
    dirname(outputFile),
    `.${basename(outputFile, extname(outputFile))}.${process.pid}.${randomBytes(6).toString('hex')}.tmp.mp3`,
  );
  const attempts = [];
  try {
    for (let attempt = 0; attempt < 16; attempt++) {
      const plan = buildSfxConformArgs({
        inputFile,
        outputFile: temporary,
        duration,
        gainDb,
      });
      run(ffmpegPath, plan.args);
      const measuredOutput =
        normBranch === 'peak'
          ? measureSfxTruePeakDb(temporary, ffmpegPath)
          : measureSfxLufs(temporary, ffmpegPath);
      const error = target - measuredOutput;
      attempts.push({ gainDb: filterNumber(gainDb), measuredOutput, error });
      if (Math.abs(error) <= NORM_TOLERANCE) {
        renameSync(temporary, outputFile);
        return {
          outputFile,
          normBranch,
          inputLevel: measuredInput,
          outputLevel: measuredOutput,
          gainDb: filterNumber(gainDb),
          attempts,
        };
      }
      // MP3 true-peak measurements are quantized and a limiter makes sustained
      // loudness response non-linear. A damped correction avoids oscillating
      // across the tolerance window while still converging quickly.
      gainDb += error * 0.5;
    }
    throw new Error(
      `${normBranch} conformance did not reach ${target} within ${NORM_TOLERANCE}: ${JSON.stringify(attempts)}`,
    );
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function inspectSfxConformance(file, { ffmpegPath, ffprobePath }) {
  const resolvedFfmpeg = resolveFfmpegPath(ffmpegPath);
  const stats = probeSfxAudio(file, ffprobePath);
  const isLossless = LOSSLESS_EXTENSIONS.has(extname(file).toLowerCase());
  const preliminary = classify({ ...stats, isLossless });
  if (preliminary.reject) return { ...stats, isLossless, ...preliminary, peakDb: null, lufs: null };
  const peakDb =
    preliminary.normBranch === 'peak' ? measureSfxTruePeakDb(file, resolvedFfmpeg) : null;
  const lufs = preliminary.normBranch === 'lufs' ? measureSfxLufs(file, resolvedFfmpeg) : null;
  return {
    ...stats,
    isLossless,
    peakDb,
    lufs,
    ...classify({ ...stats, isLossless, peakDb, lufs }),
  };
}
