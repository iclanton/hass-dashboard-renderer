function getEnvironmentVariableForPage<TValue extends string>(
  key: string,
  suffix: string
): TValue | undefined;
function getEnvironmentVariableForPage<TValue extends string>(
  key: string,
  suffix: string,
  fallbackValue: TValue
): TValue;
function getEnvironmentVariableForPage<TValue extends string>(
  key: string,
  suffix: string,
  fallbackValue?: TValue
): TValue | undefined {
  const value: TValue | undefined = process.env[key + suffix] as TValue | undefined;
  if (value !== undefined) {
    return value;
  }

  return (fallbackValue ?? process.env[key]) as TValue | undefined;
}

function getNumberEnvironmentVariableForPage(key: string, suffix: string): number | undefined;
function getNumberEnvironmentVariableForPage(key: string, suffix: string, fallbackValue: number): number;
function getNumberEnvironmentVariableForPage(
  key: string,
  suffix: string,
  fallbackValue?: number
): number | undefined {
  let value: string | undefined = process.env[key + suffix];
  if (value !== undefined) {
    return Number.parseInt(value, 10);
  } else if (fallbackValue !== undefined) {
    return fallbackValue;
  } else {
    value = process.env[key];
    if (value !== undefined) {
      return Number.parseInt(value, 10);
    }
  }
}

function getEnvironmentVariable(key: string): string | undefined;
function getEnvironmentVariable(key: string, required: true): string;
function getEnvironmentVariable(key: string, required?: boolean): string | undefined {
  const value: string | undefined = process.env[key] as string | undefined;
  if (required && value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getNumberEnvironmentVariable(key: string): number | undefined;
function getNumberEnvironmentVariable(key: string, required: true): number;
function getNumberEnvironmentVariable(key: string, required?: boolean): number | undefined {
  const value: string | undefined = process.env[key];
  if (value === undefined) {
    if (required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  } else {
    return Number.parseInt(value, 10);
  }
}

export interface IPageRenderingConfig {
  grayscaleDepth: number;
  removeGamma: boolean;
  blackLevel: string;
  whiteLevel: string;
  dither: boolean;
  colorMode: 'GrayScale' | 'TrueColor';
}

export interface IPageConfig {
  screenShotUrl: string;
  includeCacheBreakQuery: boolean;
  imageFormat: 'png' | 'jpeg';
  outputPath: string;
  renderingDelay: number;
  renderingScreenSize: {
    height: number;
    width: number;
  };
  rotation: number;
  pageRenderingConfig: IPageRenderingConfig | undefined;
  prefersColorScheme: 'light' | 'dark';
  scaling: number;
  batteryWebHook: string | undefined;
}

function getPagesConfig(): IPageConfig[] {
  const pages: IPageConfig[] = [];
  let i: number = 0;
  while (++i) {
    const suffix: string = i === 1 ? '' : `_${i}`;
    const screenShotUrl: string | undefined = process.env[`HA_SCREENSHOT_URL${suffix}`];
    if (!screenShotUrl) {
      break;
    }

    const pageRenderingConfig: IPageRenderingConfig | undefined =
      getEnvironmentVariableForPage('LEAVE_IMAGE_UNMODIFIED', suffix) === 'true'
        ? undefined
        : {
            grayscaleDepth: getNumberEnvironmentVariableForPage('GRAYSCALE_DEPTH', suffix) ?? 8,
            removeGamma: getEnvironmentVariableForPage('REMOVE_GAMMA', suffix) === 'true' ?? false,
            blackLevel: getEnvironmentVariableForPage('BLACK_LEVEL', suffix) ?? '0%',
            whiteLevel: getEnvironmentVariableForPage('WHITE_LEVEL', suffix) ?? '100%',
            dither: getEnvironmentVariableForPage('DITHER', suffix) === 'true' ?? false,
            colorMode: getEnvironmentVariableForPage('COLOR_MODE', suffix) ?? 'GrayScale'
          };

    pages.push({
      screenShotUrl,
      includeCacheBreakQuery:
        getEnvironmentVariableForPage('INCLUDE_CACHE_BREAK_QUERY', suffix) === 'true' || false,
      imageFormat: getEnvironmentVariableForPage('IMAGE_FORMAT', suffix) ?? 'png',
      outputPath: getEnvironmentVariableForPage('OUTPUT_PATH', suffix, `output/cover${suffix}`),
      renderingDelay: getNumberEnvironmentVariableForPage('RENDERING_DELAY', suffix) ?? 0,
      renderingScreenSize: {
        height: getNumberEnvironmentVariableForPage('RENDERING_SCREEN_HEIGHT', suffix) ?? 800,
        width: getNumberEnvironmentVariableForPage('RENDERING_SCREEN_WIDTH', suffix) ?? 600
      },
      pageRenderingConfig,
      rotation: getNumberEnvironmentVariableForPage('ROTATION', suffix) ?? 0,
      prefersColorScheme: getEnvironmentVariableForPage('PREFERS_COLOR_SCHEME', suffix) ?? 'light',
      scaling: getNumberEnvironmentVariableForPage('SCALING', suffix) ?? 1,
      batteryWebHook: getEnvironmentVariableForPage('HA_BATTERY_WEBHOOK', suffix)
    });
  }

  return pages;
}

export interface IConfig {
  baseUrl: string;
  accessToken: string;
  cronJob: string;
  eagerRender: boolean;
  useImageMagick: boolean;
  pages: IPageConfig[];
  port: number;
  renderingTimeout: number;
  browserLaunchTimeout: number;
  language: string;
  debug: boolean;
  ignoreCertificateErrors: boolean;
}

const config: IConfig = {
  baseUrl: getEnvironmentVariable('HA_BASE_URL', true),
  accessToken: getEnvironmentVariable('HA_ACCESS_TOKEN', true),
  cronJob: getEnvironmentVariable('CRON_JOB') ?? '* * * * *',
  eagerRender: getEnvironmentVariable('EAGER_RERENDER') === 'true',
  useImageMagick: getEnvironmentVariable('USE_IMAGE_MAGICK') === 'true',
  pages: getPagesConfig(),
  port: getNumberEnvironmentVariable('PORT') ?? 5000,
  renderingTimeout: getNumberEnvironmentVariable('RENDERING_TIMEOUT') ?? 10000,
  browserLaunchTimeout: getNumberEnvironmentVariable('BROWSER_LAUNCH_TIMEOUT') ?? 30000,
  language: getEnvironmentVariable('LANGUAGE') ?? 'en',
  debug: getEnvironmentVariable('DEBUG') === 'true',
  ignoreCertificateErrors: getEnvironmentVariable('UNSAFE_IGNORE_CERTIFICATE_ERRORS') === 'true'
};

export default config;
