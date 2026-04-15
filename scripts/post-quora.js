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
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Remove webdriver flag
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('Navigating to Quora login...');
  await page.goto('https://www.quora.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  console.log('Page URL:', page.url());
  console.log('Page title:', await page.title());

  // Log all visible inputs for debug
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, name: i.name, placeholder: i.placeholder, id: i.id, className: i.className.substring(0,50)
    }));
  });
  console.log('Inputs found:', JSON.stringify(inputs));

  // Try multiple selectors for email
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="mail" i]',
    'input[data-field-name="email"]',
    'input.qu-borderAll'
  ];

  let emailInput = null;
  for (const sel of emailSelectors) {
    try {
      emailInput = await page.waitForSelector(sel, { timeout: 3000 });
      if (emailInput) { console.log('Found email input:', sel); break; }
    } catch (e) {}
  }

  if (!emailInput) {
    console.log('No email input found. Page HTML snippet:');
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
    console.log(html);
    await browser.close();
    process.exit(1);
  }

  await emailInput.click({ clickCount: 3 });
  await page.keyboard.type(email, { delay: 80 });
  await sleep(700);

  // Password
  const pwdSelectors = ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="assword" i]'];
  let pwdInput = null;
  for (const sel of pwdSelectors) {
    pwdInput = await page.$(sel);
    if (pwdInput) { console.log('Found password input:', sel); break; }
  }
  if (!pwdInput) { console.log('No password input!'); await browser.close(); process.exit(1); }

  await pwdInput.click({ clickCount: 3 });
  await page.keyboard.type(password, { delay: 80 });
  await sleep(700);

  // Submit
  const loginBtn = await page.$('button[type="submit"]') || await page.$('.qu-bg--blue');
  if (loginBtn) {
    await loginBtn.click();
    console.log('Clicked login button');
  } else {
    await page.keyboard.press('Enter');
    console.log('Pressed Enter');
  }

  // Wait for URL change
  try {
    await page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 25000 });
  } catch (e) {
    console.log('Still on login page after wait. URL:', page.url());
  }
  await sleep(4000);
  console.log('Post-login URL:', page.url());

  console.log('Navigating to question...');
  await page.goto(questionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);

  // Click Answer button
  const buttons = await page.$$('button');
  let answerBtn = null;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text === 'Answer' || text.startsWith('Answer')) { answerBtn = btn; break; }
  }
  if (answerBtn) {
    await answerBtn.click();
    console.log('Clicked Answer button');
  }
  await sleep(3000);

  const editor = await page.$('[contenteditable="true"]');
  if (editor) {
    await editor.click();
    await sleep(500);
    await page.keyboard.type(answerText, { delay: 20 });
    console.log('Answer typed!');
  } else {
    console.log('Editor not found');
    await browser.close();
    process.exit(1);
  }
  await sleep(1500);

  const allBtns = await page.$$('button');
  for (const btn of allBtns) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text === 'Submit' || text === 'Post') {
      await btn.click();
      console.log('Submitted!');
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
