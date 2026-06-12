import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@pointless/shared';

type Browser = import('playwright').Browser;

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ args: ['--no-sandbox'] });
      browser.on('disconnected', () => (browserPromise = null));
      return browser;
    })();
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

export class PdfUnavailableError extends Error {}

/** Render the local print page for a deck to a PDF buffer. */
export async function renderDeckPdf(printUrl: string): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new PdfUnavailableError(
      `PDF export needs Chromium. Install it with: npx playwright install --with-deps chromium (${(err as Error).message})`
    );
  }
  const page = await browser.newPage({ viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT } });
  try {
    await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    return await page.pdf({
      width: `${SLIDE_WIDTH}px`,
      height: `${SLIDE_HEIGHT}px`,
      printBackground: true,
    });
  } finally {
    await page.close();
  }
}
