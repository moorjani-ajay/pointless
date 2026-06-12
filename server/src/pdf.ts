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

/**
 * Best-effort PDF of an arbitrary interactive document: render at a 16:9
 * laptop viewport and print what the initial view shows.
 */
export async function renderDeckPdf(url: string): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new PdfUnavailableError(
      `PDF export needs Chromium. Install it with: npx playwright install --with-deps chromium (${(err as Error).message})`
    );
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(800);
    return await page.pdf({ width: '1440px', height: '900px', printBackground: true });
  } finally {
    await page.close();
  }
}
