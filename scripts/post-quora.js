const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const email = process.env.QUORA_EMAIL;
const password = process.env.QUORA_PASSWORD;
const questionUrl = process.env.QUESTION_URL;
const answerText = process.env.ANSWER_TEXT;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log('Navigating to Quora login...');
  await page.goto('https://www.quora.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  console.log('Filling login form...');
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.type('input[type="email"]', email, { delay: 80 });
  await sleep(700);
  await page.type('input[type="password"]', password, { delay: 80 });
  await sleep(700);

  // Click login button instead of Enter (more reliable)
  const loginBtn = await page.$('button[type="submit"]') ||
                   await page.$('input[type="submit"]');
  if (loginBtn) {
    await loginBtn.click();
    console.log('Clicked login button');
  } else {
    await page.keyboard.press('Enter');
    console.log('Pressed Enter to login');
  }

  // Quora is SPA - don't use waitForNavigation, just wait for URL change
  console.log('Waiting for login to complete...');
  try {
    await page.waitForFunction(
      () => !window.location.href.includes('/login'),
      { timeout: 25000 }
    );
  } catch (e) {
    console.log('URL still on login, checking page state...');
  }
  await sleep(4000);
  console.log('Current URL:', page.url());

  console.log('Navigating to question:', questionUrl);
  await page.goto(questionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);

  // Find and click Answer button
  const buttons = await page.$$('button');
  let answerBtn = null;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.trim() === 'Answer' || text.trim().startsWith('Answer')) {
      answerBtn = btn;
      break;
    }
  }
  if (answerBtn) {
    await answerBtn.click();
    console.log('Answer button clicked');
  } else {
    console.log('Answer button not found, trying aria-label...');
    const ariaBtn = await page.$('[aria-label*="Answer"]');
    if (ariaBtn) await ariaBtn.click();
  }
  await sleep(3000);

  // Type answer in editor
  const editor = await page.$('[contenteditable="true"]');
  if (editor) {
    await editor.click();
    await sleep(500);
    await page.keyboard.type(answerText, { delay: 20 });
    console.log('Answer typed!');
  } else {
    console.log('Editor not found - taking screenshot for debug');
    await page.screenshot({ path: 'debug.png' });
    await browser.close();
    process.exit(1);
  }
  await sleep(1500);

  // Submit
  const allBtns = await page.$$('button');
  for (const btn of allBtns) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.trim().includes('Submit') || text.trim() === 'Post') {
      await btn.click();
      console.log('Answer submitted!');
      break;
    }
  }

  await sleep(3000);
  await browser.close();
  console.log('Done!');
})().catch(async err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
