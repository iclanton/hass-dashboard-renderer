import path from 'node:path';
import http, { type ClientRequest } from 'node:http';
import https, { type RequestOptions } from 'node:https';

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { FileSystem } from '@rushstack/node-core-library';

import config, { type IPageConfig } from './config';
import { convertImageAsync } from './imageConvert';

const {
  pages,
  ignoreCertificateErrors,
  debug,
  port,
  browserLaunchTimeout,
  baseUrl,
  renderingTimeout,
  accessToken,
  language,
  eagerRender,
  longLivedPageMode,
  cronTime
} = config;

interface IBatteryStoreEntry {
  batteryLevel: number | undefined;
  isCharging: boolean;
}

// keep state of current battery level and whether the device is charging
const batteryStoreByPageIndex: Map<number, IBatteryStoreEntry> = new Map();

// For puppeteer
declare const localStorage: { setItem(key: string, value: string): void };

function getPageUrl(pageConfig: IPageConfig): string {
  const { screenShotUrl, includeCacheBreakQuery } = pageConfig;
  let url: string = `${baseUrl}${screenShotUrl}`;
  if (includeCacheBreakQuery) {
    url += `?${Date.now()}`;
  }

  return url;
}

let longLivedPages: Page[] | undefined;

(async () => {
  if (pages.length === 0) {
    return console.error('Please check your configuration');
  }

  for (let i: number = 0; i < pages.length; i++) {
    const { rotation }: IPageConfig = pages[i];
    if (rotation % 90 > 0) {
      return console.error(`Invalid rotation value for entry ${i + 1}: ${rotation}`);
    }
  }

  console.log('Starting browser...');
  const puppeteerArgs: string[] = ['--disable-dev-shm-usage', '--no-sandbox', `--lang=${language}`];
  if (ignoreCertificateErrors) {
    puppeteerArgs.push('--ignore-certificate-errors');
  }

  const browser: Browser = await puppeteer.launch({
    args: puppeteerArgs,
    defaultViewport: null,
    timeout: browserLaunchTimeout,
    headless: !debug
  });

  console.log(`Visiting '${baseUrl}' to login...`);
  const page: Page = await browser.newPage();
  await page.goto(baseUrl, {
    waitUntil: ['domcontentloaded', 'load', 'networkidle0'],
    timeout: renderingTimeout
  });

  const hassTokens: Record<string, string> = {
    hassUrl: baseUrl,
    access_token: accessToken,
    token_type: 'Bearer'
  };

  console.log("Adding authentication entry to browser's local storage...");
  await page.evaluate(
    (hassTokens, selectedLanguage) => {
      localStorage.setItem('hassTokens', hassTokens);
      localStorage.setItem('selectedLanguage', selectedLanguage);
    },
    JSON.stringify(hassTokens),
    JSON.stringify(language)
  );

  await page.close();

  if (longLivedPageMode) {
    console.log('Long-lived page mode enabled, creating pages...');
    longLivedPages = [];
    for (let i: number = 0; i < pages.length; i++) {
      const pageConfig: IPageConfig = pages[i];
      const page: Page = await getPageFromConfigAsync(browser, pageConfig);
      longLivedPages.push(page);
    }

    console.log(`Created ${longLivedPages.length} long-lived pages.`);
  }

  if (debug) {
    console.log('Debug mode active, will only render once in non-headless model and keep page open');
    await renderAndConvertAsync(browser);
  } else {
    if (eagerRender) {
      console.log('Eager render configured, so skipping initial render and disabling cronjob...');
      for (let pageIndex: number = 0; pageIndex < pages.length; pageIndex++) {
        const { outputPath } = pages[pageIndex];
        try {
          await FileSystem.deleteFolderAsync(path.dirname(outputPath));
        } catch (e) {
          if (!FileSystem.isNotExistError(e)) {
            console.error(`Failed to delete ${outputPath}: ${e}`);
          }
        }
      }
    } else {
      console.log('Starting first render...');
      await renderAndConvertAsync(browser);
      console.log('Starting rendering cronjob...');
      const { CronJob } = await import('cron');
      // eslint-disable-next-line no-new
      new CronJob({
        cronTime,
        onTick: () => renderAndConvertAsync(browser),
        start: true
      });
    }
  }

  const httpServer: http.Server = http.createServer(
    async ({ url: requestUrl, headers: { host: requestHost }, method }, response) => {
      if (!requestUrl) {
        response.writeHead(400);
        response.end('No request URL');
        return;
      }

      // Parse the request
      const url: URL = new URL(requestUrl, `http://${requestHost}`);
      // Check the page number
      const pageNumberStr: string = url.pathname;
      // and get the battery level, if any
      // (see https://github.com/sibbl/hass-lovelace-kindle-screensaver/README.md for patch to generate it on Kindle)
      const batteryLevelStr: string | null = url.searchParams.get('batteryLevel');
      const batteryLevel: number | undefined = batteryLevelStr ? parseInt(batteryLevelStr) : undefined;
      const isCharging: string | null = url.searchParams.get('isCharging');
      if (pageNumberStr.toUpperCase() === '/RELOAD' && method === 'POST') {
        console.log('Received reload request');
        await renderAndConvertAsync(browser);
        response.writeHead(200);
        response.end('Reloaded');
        return;
      }

      const pageNumber: number = pageNumberStr === '/' ? 1 : parseInt(pageNumberStr.substring(1));
      if (isFinite(pageNumber) === false || pageNumber > pages.length || pageNumber < 1) {
        console.log(`Invalid request: ${requestUrl} for page ${pageNumber}`);
        response.writeHead(400);
        response.end('Invalid request');
        return;
      }
      try {
        // Log when the page was accessed
        const now: Date = new Date();
        console.log(`${now.toISOString()}: Image ${pageNumber} was accessed`);

        const pageIndex: number = pageNumber - 1;
        const pageConfig: IPageConfig = pages[pageIndex];
        const { outputPath, imageFormat } = pageConfig;
        let imageData: Buffer | undefined;
        let lastModifiedTime: string;
        if (eagerRender) {
          console.log('Eager render requested. Rerendering...');
          imageData = await renderAndConvertPageAsync(browser, pageConfig, pageIndex);
          lastModifiedTime = new Date().toUTCString();
        } else {
          const outputPathWithExtension: string = `${outputPath}.${imageFormat}`;
          const [data, stat] = await Promise.all([
            FileSystem.readFileToBufferAsync(outputPathWithExtension),
            FileSystem.getStatisticsAsync(outputPathWithExtension)
          ]);
          imageData = data;
          lastModifiedTime = new Date(stat.mtime).toUTCString();
        }

        if (imageData) {
          response.writeHead(200, {
            'Content-Type': `image/${imageFormat}`,
            'Content-Length': Buffer.byteLength(imageData),
            'Last-Modified': lastModifiedTime
          });
          response.end(imageData);
        } else {
          response.writeHead(500);
          response.end('Failed to render image');
        }

        let pageBatteryStore: IBatteryStoreEntry | undefined = batteryStoreByPageIndex.get(pageIndex);
        if (!pageBatteryStore) {
          pageBatteryStore = {
            batteryLevel: undefined,
            isCharging: false
          };

          batteryStoreByPageIndex.set(pageIndex, pageBatteryStore);
        }

        if (batteryLevel && !isNaN(batteryLevel) && batteryLevel >= 0 && batteryLevel <= 100) {
          if (batteryLevel !== pageBatteryStore.batteryLevel) {
            pageBatteryStore.batteryLevel = batteryLevel;
            console.log(`New battery level: ${batteryLevel} for page ${pageNumber}`);
          }

          if ((isCharging === 'Yes' || isCharging === '1') && pageBatteryStore.isCharging !== true) {
            pageBatteryStore.isCharging = true;
            console.log(`Battery started charging for page ${pageNumber}`);
          } else if ((isCharging === 'No' || isCharging === '0') && pageBatteryStore.isCharging !== false) {
            console.log(`Battery stopped charging for page ${pageNumber}`);
            pageBatteryStore.isCharging = false;
          }
        }
      } catch (e) {
        console.error(e);
        response.writeHead(404);
        response.end('Image not found');
      }
    }
  );

  httpServer.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
})().catch((e) => {
  console.error(e);
});

async function renderAndConvertAsync(browser: Browser): Promise<void> {
  for (let pageIndex: number = 0; pageIndex < pages.length; pageIndex++) {
    const pageConfig: IPageConfig = pages[pageIndex];
    const image: Buffer | undefined = await renderAndConvertPageAsync(browser, pageConfig, pageIndex);
    if (!eagerRender) {
      if (image) {
        const { outputPath: configOutputPath, imageFormat } = pageConfig;
        const outputPath: string = `${configOutputPath}.${imageFormat}`;
        await FileSystem.writeFileAsync(outputPath, image, { ensureFolderExists: true });
      } else {
        console.log(`Failed to render page ${pageIndex + 1}. Falling back to existing image, if one exists.`);
      }
    }
  }
}

async function renderAndConvertPageAsync(
  browser: Browser,
  pageConfig: IPageConfig,
  pageIndex: number
): Promise<Buffer | undefined> {
  const { batteryWebHook, pageRenderingConfig } = pageConfig;
  const pageBatteryStore: IBatteryStoreEntry | undefined = batteryStoreByPageIndex.get(pageIndex);
  const longLivedPage: Page | undefined = longLivedPages?.[pageIndex];

  const url: string = getPageUrl(pageConfig);
  console.log(`Rendering ${url} to image...`);
  let image: Buffer | undefined = await renderUrlToImageAsync(browser, pageConfig, longLivedPage);
  if (image) {
    if (pageRenderingConfig) {
      console.log(`Converting rendered screenshot of ${url} to grayscale...`);
      image = await convertImageAsync(image, pageConfig, pageRenderingConfig);
    }

    console.log(`Finished ${url}`);

    if (pageBatteryStore?.batteryLevel !== undefined && batteryWebHook) {
      sendBatteryLevelToHomeAssistant(pageIndex, pageBatteryStore, batteryWebHook);
    }

    return image;
  }
}

function sendBatteryLevelToHomeAssistant(
  pageIndex: number,
  batteryStore: IBatteryStoreEntry,
  batteryWebHook: string
): void {
  const batteryStatus: string = JSON.stringify(batteryStore);
  const options: RequestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(batteryStatus)
    },
    rejectUnauthorized: !ignoreCertificateErrors
  };
  const url: string = `${baseUrl}/api/webhook/${batteryWebHook}`;
  const httpLib: typeof import('http') | typeof import('https') = url.toLowerCase().startsWith('https')
    ? https
    : http;
  const req: ClientRequest = httpLib.request(url, options, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Update device ${pageIndex} at ${url} status ${res.statusCode}: ${res.statusMessage}`);
    }
  });
  req.on('error', (e) => {
    console.error(`Update ${pageIndex} at ${url} error: ${e.message}`);
  });
  req.write(batteryStatus);
  req.end();
}

async function getPageFromConfigAsync(browser: Browser, pageConfig: IPageConfig): Promise<Page> {
  const { prefersColorScheme, renderingScreenSize, rotation, scaling, renderingDelay } = pageConfig;
  const url: string = getPageUrl(pageConfig);
  console.log(`Creating page for ${url}...`);
  const page: Page = await browser.newPage();
  await page.emulateMediaFeatures([
    {
      name: 'prefers-color-scheme',
      value: `${prefersColorScheme}`
    }
  ]);

  let size: { width: number; height: number } = renderingScreenSize;
  if (rotation % 180 > 0) {
    size = {
      width: size.height,
      height: size.width
    };
  }

  await page.setViewport(size);
  const startTime: number = Date.now();
  await page.goto(url, {
    waitUntil: ['domcontentloaded', 'load'],
    timeout: renderingTimeout
  });

  const navigateTimeSpan: number = Date.now() - startTime;
  console.log(`Page ${url} loaded in ${navigateTimeSpan}ms`);

  const selectorWaitTimeout: number = Math.max(renderingTimeout - navigateTimeSpan, 1000);
  console.log(`Waiting for Home Assistant to render with timeout ${selectorWaitTimeout}ms...`);
  await page.waitForSelector('home-assistant', {
    timeout: selectorWaitTimeout
  });

  console.log(`Page ${url} rendered in ${Date.now() - startTime}ms`);

  await page.addStyleTag({
    content: `
        body {
          zoom: ${scaling * 100}%;
          overflow: hidden;
        }`
  });

  if (renderingDelay > 0) {
    console.log(`Waiting for ${renderingDelay}ms before taking screenshot...`);
    await page.waitForTimeout(renderingDelay);
  }

  return page;
}

async function renderUrlToImageAsync(
  browser: Browser,
  pageConfig: IPageConfig,
  longLivedPage: Page | undefined
): Promise<Buffer | undefined> {
  const { renderingScreenSize, rotation, imageFormat } = pageConfig;
  let page: Page | undefined;
  try {
    if (longLivedPage) {
      const longLivedPageUrl: string = longLivedPage.url();
      if (longLivedPage.isClosed()) {
        console.error(`Long-lived page for ${longLivedPageUrl} is closed, recreating...`);
        page = await getPageFromConfigAsync(browser, pageConfig);
      } else {
        console.log(`Using long-lived page for ${longLivedPageUrl}`);
        page = longLivedPage;
      }
    } else {
      page = await getPageFromConfigAsync(browser, pageConfig);
    }

    await page.bringToFront();

    let size: { width: number; height: number } = renderingScreenSize;
    if (rotation % 180 > 0) {
      size = {
        width: size.height,
        height: size.width
      };
    }

    return (await page.screenshot({
      type: imageFormat,
      captureBeyondViewport: false,
      clip: {
        x: 0,
        y: 0,
        ...size
      },
      encoding: 'binary'
    })) as Buffer;
  } catch (e) {
    console.error('Failed to render', e);
  } finally {
    if (debug === false && !longLivedPage) {
      await page?.close();
    }
  }
}
