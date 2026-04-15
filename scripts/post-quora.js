const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

const email = process.env.QUORA_EMAIL;
const password = process.env.QUORA_PASSWORD;
const questionUrl = process.env.QUESTION_URL;
const answerText = process.env.ANSWER_TEXT;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Start Xvfb from within the script so no workflow YAML changes needed.
// ubuntu-latest runners have Xvfb pre-installed.
function startXvfb() {
  try {
    execSync('pkill Xvfb || true', { stdio: 'ignore' });
    execSync('Xvfb :99 -screen 0 1280x800x24 -ac &', { stdio: 'ignore', shell: true });
    execSync('sleep 2');
    process.env.DISPLAY = ':99';
    console.log('Xvfb started on :99');
  } catch (e) {
    console.log('Xvfb start failed (may not be needed):', e.message);
  }
}

async function waitForCloudflare(page, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const title = await page.title();
    const url = page.url();
    if (!title.includes('Just a moment') && !url.includes('challenges.cloudflare.com')) {
      return true;
    }
    console.log('Waiting for Cloudflare... title:', title);
    await sleep(3000);
  }
  return false;
}

(async () => {
  // Start virtual display so Chrome runs non-headless (much harder to detect)
  startXvfb();

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  console.log('Navigating to Quora login...');
  await page.goto('https://www.quora.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('Page title:', await page.title());
  console.log('Page URL:', page.url());

  const cfPassed = await waitForCloudflare(page, 60000);
  if (!cfPassed) {
    console.log('ERROR: Cloudflare challenge did not resolve after 60s');
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
    console.log('Page HTML:', html);
    await browser.close();
    process.exit(1);
  }

  console.log('Cloudflare passed! URL:', page.url());
  await sleep(2000);

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, name: i.name, placeholder: i.placeholder, id: i.id,
      className: i.className.substring(0, 50)
    }))
  );
  console.log('Inputs found:', JSON.stringify(inputs));

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
      emailInput = await page.waitForSelector(sel, { timeout: 5000 });
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

  // If pre-loaded cookies are available, use them instead of login
  const quoraCookies = process.env.QUORA_COOKIES;
  if (quoraCookies) {
    try {
      const cookies = JSON.parse(quoraCookies);
      await page.setCookie(...cookies);
      console.log('Loaded', cookies.length, 'cookies from QUORA_COOKIES env');
      await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      console.log('Cookie-based auth URL:', page.url());
    } catch(e) {
      console.log('Cookie load failed, falling back to login:', e.message);
    }
  } else {
    // Login flow
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.type(email, { delay: 80 });
    await sleep(700);

    const pwdSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="assword" i]'
    ];
    let pwdInput = null;
    for (const sel of pwdSelectors) {
      pwdInput = await page.$(sel);
      if (pwdInput) { console.log('Found password input:', sel); break; }
    }
    if (!pwdInput) {
      console.log('No password input found!');
      await browser.close();
      process.exit(1);
    }

    await pwdInput.click({ clickCount: 3 });
    await page.keyboard.type(password, { delay: 80 });
    await sleep(700);

    // Wait for Cloudflare Turnstile to auto-solve before submitting
    console.log('Waiting for Turnstile to auto-solve...');
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        for (const input of inputs) {
          if (input.value && input.value.length > 0) return true;
        }
        return false;
      },
      { timeout: 20000 }
    ).catch(() => console.log('Turnstile did not auto-solve in 20s, submitting anyway'));

    const turnstileVal = await page.evaluate(() => {
      const inp = document.querySelector('input[name="cf-turnstile-response"]');
      return inp ? inp.value.substring(0, 30) + '...' : 'not found';
    });
    console.log('Turnstile value:', turnstileVal);

    const loginBtn = await page.$('button[type="submit"]') || await page.$('.qu-bg--blue');
    if (loginBtn) {
      await loginBtn.click();
      console.log('Clicked login button');
    } else {
      await page.keyboard.press('Enter');
      console.log('Pressed Enter to submit');
    }

    try {
      await page.waitForFunction(
        () => !window.location.href.includes('/login'),
        { timeout: 25000 }
      );
    } catch (e) {
      console.log('Still on login page after wait. URL:', page.url());
    }
    await sleep(4000);
    console.log('Post-login URL:', page.url());

    // Verify login actually worked (no "Sign In" button visible)
    const signInVisible = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.trim() === 'Sign In');
    });
    if (signInVisible) {
      console.log('ERROR: Login failed — Sign In button still visible');
      const loginHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
      console.log('Page HTML:', loginHtml);
      await browser.close();
      process.exit(1);
    }
    console.log('Login verified: Sign In button not visible');
  }

  // Verify login state
  const isLoggedIn = await page.evaluate(() => {
    return !document.querySelector('[href="/login"]') || !!document.querySelector('[class*="UserAvatar"]') || !!document.querySelector('[class*="avatar"]');
  });
  console.log('Logged in check:', isLoggedIn, '| URL:', page.url());

  console.log('Navigating to question:', questionUrl);
  await page.goto(questionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCloudflare(page, 30000);
  await sleep(5000);

  console.log('Question page URL:', page.url());

  // Dump all clickable elements for debugging
  const clickables = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"], span[role="button"]'));
    return els.slice(0, 30).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      text: el.textContent.trim().substring(0, 50),
      ariaLabel: el.getAttribute('aria-label')
    }));
  });
  console.log('Clickable elements:', JSON.stringify(clickables));

  // Try multiple strategies to find Answer button
  let answerBtn = null;

  // Strategy 1: button with text "Answer"
  const allBtnsCheck = await page.$$('button');
  for (const btn of allBtnsCheck) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    console.log('Button text:', text.substring(0, 40));
    if (text === 'Answer' || text.startsWith('Answer')) { answerBtn = btn; break; }
  }

  // Strategy 2: any element with role="button" containing "Answer"
  if (!answerBtn) {
    answerBtn = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll('[role="button"], button, a'));
      return all.find(el => el.textContent.trim() === 'Answer' || el.getAttribute('aria-label') === 'Answer') || null;
    });
    const isNull = await page.evaluate(el => el === null, answerBtn);
    if (isNull) answerBtn = null;
  }

  // Strategy 3: look for answer-related class names
  if (!answerBtn) {
    answerBtn = await page.$('[class*="AnswerButton"], [class*="answer-button"], [data-functional-selector*="answer"]');
  }

  if (answerBtn) {
    await answerBtn.click();
    console.log('Clicked Answer button');
  } else {
    // Strategy 4: try clicking where answer button typically is and see if editor appears
    console.log('Answer button not found via selectors — trying page screenshot dump');
    const bodyHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    console.log('Page HTML snippet:', bodyHtml);
    await browser.close();
    process.exit(1);
  }
  await sleep(3000);

  const editor = await page.$('[contenteditable="true"]');
  if (editor) {
    await editor.click();
    await sleep(500);
    await page.keyboard.type(answerText, { delay: 20 });
    console.log('Answer typed!');
  } else {
    console.log('Editor not found — dumping HTML');
    const bodyHtml = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    console.log('Page HTML:', bodyHtml);
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
