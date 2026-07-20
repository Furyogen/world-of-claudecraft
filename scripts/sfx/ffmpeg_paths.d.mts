export declare function resolveSfxTool(options: {
  overridePath?: string;
  staticPath?: string | null;
  extraStaticPaths?: readonly (string | null | undefined)[];
  fallback: string;
}): string;
export declare const FFMPEG_PATH: string;
export declare const FFPROBE_PATH: string;
