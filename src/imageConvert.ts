import type { ChildProcess } from 'node:child_process';
import { Async, Executable, type IWaitForExitResult } from '@rushstack/node-core-library';

import type { IPageConfig, IPageRenderingConfig } from './config';

const IMAGEMAGICK_BIN_NAME: string = 'magick';
const GAMMA_ARG_NAME: string = '-gamma';
const DITHER_ARGS: string[] = ['-dither', 'FloydSteinberg'];
const NO_DITHER_ARGS: string[] = ['+dither'];
const BACKGROUND_COLOR_ARGS: string[] = ['-background', 'white'];
const ROTATE_ARG_NAME: string = '-rotate';
const TYPE_ARG_NAME: string = '-type';
const LEVEL_ARG_NAME: string = '-level';
const DEPTH_ARG_NAME: string = '-depth';
const QUALITY_ARGS: string[] = ['-quality', '100'];
const STDIN_ARG_NAME: string = '-';
const SEVEN_COLOR_REMAP_ARGS: string[] = ['-remap', `${__dirname}/palettes/7-color.png`];

const REMOVED_GAMMA_VALUE: number = 1.0 / 2.2;

const TIMEOUT_MS: number = 5 * 1000; // 5 seconds

export async function convertImageAsync(
  imageData: Buffer,
  pageConfig: Pick<IPageConfig, 'rotation' | 'imageFormat'>,
  renderingConfig: IPageRenderingConfig
): Promise<Buffer> {
  const { rotation, imageFormat } = pageConfig;
  const { removeGamma, dither, colorMode, blackLevel, whiteLevel, grayscaleDepth } = renderingConfig;

  const normalizedColorMode: string = colorMode === 'SevenColor' ? 'TrueColor' : colorMode;

  // prettier-ignore
  const imageMagickArgs: string[] = [
    TYPE_ARG_NAME, normalizedColorMode,
    ...QUALITY_ARGS,
    STDIN_ARG_NAME,
    GAMMA_ARG_NAME, removeGamma ? `${REMOVED_GAMMA_VALUE},${REMOVED_GAMMA_VALUE},${REMOVED_GAMMA_VALUE}`:'1,1,1',
    ...(dither ? DITHER_ARGS : NO_DITHER_ARGS),
    ...BACKGROUND_COLOR_ARGS,
    ROTATE_ARG_NAME, String(rotation),
    LEVEL_ARG_NAME, `${blackLevel},${whiteLevel}`,
    DEPTH_ARG_NAME, String(grayscaleDepth),
    ...(colorMode === 'SevenColor' ? SEVEN_COLOR_REMAP_ARGS : []),
    `${imageFormat}:-`
  ];

  const imageMagickProcess: ChildProcess = Executable.spawn(IMAGEMAGICK_BIN_NAME, imageMagickArgs);

  const stdinStream: NodeJS.WritableStream | null = imageMagickProcess.stdin;
  if (!stdinStream) {
    throw new Error(`ImageMagick process stdin is not available.`);
  }

  await new Promise<void>((resolve, reject) => {
    function callback(err: Error | null): void {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }

    if (!stdinStream.write(imageData)) {
      stdinStream.once('drain', callback);
    } else {
      process.nextTick(callback);
    }
  });

  stdinStream.end();

  const imageMagickResult: IWaitForExitResult<Buffer> | undefined = await Promise.race([
    Executable.waitForExitAsync(imageMagickProcess, {
      encoding: 'buffer'
    }),
    Async.sleepAsync(TIMEOUT_MS).then(() => undefined)
  ]);

  if (!imageMagickResult) {
    imageMagickProcess.kill('SIGKILL');
    throw new Error(`ImageMagick process timed out after ${TIMEOUT_MS} ms.`);
  }

  const { stdout, stderr, exitCode, signal } = imageMagickResult;

  if (exitCode !== 0) {
    throw new Error(`ImageMagick process exited with code ${exitCode}. Stderr: ${stderr.toString()}`);
  }

  if (signal) {
    throw new Error(`ImageMagick process was killed by signal: ${signal}. Stderr: ${stderr.toString()}`);
  }

  if (stderr.length > 0) {
    console.warn(`ImageMagick process produced stderr output: ${stderr.toString()}`);
  }

  return stdout;
}
