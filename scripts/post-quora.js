const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

const email = process.env.QUORA_EMAIL;
const password = process.env.QUORA_PASSWORD;
const questionUrl = process.env.QUESTION_URL;
const answerText = process.env.ANSWER_TEXT;
const quoraCookies = process.env.QUORA_COOKIES;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function startXvfb() {
  try {
    execSync('pkill Xvfb || true', { stdio: 'ignore' });
    execSync('Xvfb :99 -screen 0 1280x800x24 -ac &', { stdio: 'ignore', shell: true });
    execSync('sleep 2');
    process.env.DISPLAY = ':99';
    console.log('Xvfb started on :99');
  } catch (e) {
    console.log('Xvfb start failed:', e.message);
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

// Wait for Quora answer button to appear (confirms question page loaded + logged in)
async function waitForAnswerButton(page, maxWait = 45000) {
  console.log('Waiting for Answer button...');
  try {
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        return btns.some(b => b.textContent.trim() === 'Answer' || b.getAttribute('aria-label') === 'Answer');
      },
      { timeout: maxWait }
    );
    console.log('Answer button appeared!');
    return true;
  } catch (e) {
    console.log('Answer button not found after', maxWait, 'ms');
    return false;
  }
}

(async () => {
  startXvfb();

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/google-chrome-stable',
    protocolTimeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      '--disable-features=IsolateOrigins',
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

  // --- AUTH PATH ---
  if (quoraCookies) {
    // Cookie path: skip login page entirely
    console.log('QUORA_COOKIES found — using cookie-based auth');
    try {
      const cookies = JSON.parse(quoraCookies);
      // Fix cookie domains: add leading dot so cookies work on www.quora.com
      const fixedCookies = cookies.map(c => ({
        ...c,
        domain: c.domain.startsWith('.') ? c.domain : ('.' + c.domain.replace(/^www\./, ''))
      }));
      // Navigate first to get Cloudflare clearance
      await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForCloudflare(page, 60000);
      await page.setCookie(...fixedCookies);
      console.log('Injected', fixedCookies.length, 'cookies with fixed domains');
      // Reload to activate session
      await page.goto('https://www.quora.com/', { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(5000);
      console.log('Post-cookie URL:', page.url());
      // Verify login
      const isLoggedIn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const hasSignIn = btns.some(el => el.textContent.trim() === 'Sign In');
        return !hasSignIn;
      });
      console.log('Login verified:', isLoggedIn);
      if (!isLoggedIn) {
        const html = await page.evaluate(() => document.body.innerHTML.substring(0, 1000));
        console.log('Homepage HTML:', html);
        await browser.close();
        process.exit(1);
      }
    } catch (e) {
      console.log('Cookie injection failed:', e.message);
      await browser.close();
      process.exit(1);
    }
  } else {
    // Login form path
    console.log('No QUORA_COOKIES — using login form');
    await page.goto('https://www.quora.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const cfPassed = await waitForCloudflare(page, 60000);
    if (!cfPassed) {
      console.log('ERROR: Cloudflare did not resolve');
      await browser.close();
      process.exit(1);
    }
    await sleep(2000);

    const emailSelectors = [
      'input[type="email"]', 'input[name="email"]',
      'input[placeholder*="mail" i]', 'input.qu-borderAll'
    ];
    let emailInput = null;
    for (const sel of emailSelectors) {
      try {
        emailInput = await page.waitForSelector(sel, { timeout: 5000 });
        if (emailInput) { console.log('Email input:', sel); break; }
      } catch (e) {}
    }
    if (!emailInput) {
      console.log('No email input. HTML:', await page.evaluate(() => document.body.innerHTML.substring(0, 2000)));
      await browser.close();
      process.exit(1);
    }

    await emailInput.click({ clickCount: 3 });
    await page.keyboard.type(email, { delay: 80 });
    await sleep(700);

    let pwdInput = null;
    for (const sel of ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="assword" i]']) {
      pwdInput = await page.$(sel);
      if (pwdInput) { console.log('Password input:', sel); break; }
    }
    if (!pwdInput) {
      console.log('No password input!');
      await browser.close();
      process.exit(1);
    }

    await pwdInput.click({ clickCount: 3 });
    await page.keyboard.type(password, { delay: 80 });
    await sleep(700);

    console.log('Waiting for Turnstile...');
    await page.waitForFunction(
      () => {
        const inp = document.querySelector('input[name="cf-turnstile-response"]');
        return inp && inp.value && inp.value.length > 0;
      },
      { timeout: 20000 }
    ).catch(() => console.log('Turnstile did not solve, submitting anyway'));

    const loginBtn = await page.$('button[type="submit"]') || await page.$('.qu-bg--blue');
    if (loginBtn) { await loginBtn.click(); console.log('Clicked login'); }
    else { await page.keyboard.press('Enter'); console.log('Pressed Enter'); }

    try {
      await page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 25000 });
    } catch (e) { console.log('Still on login after wait. URL:', page.url()); }
    await sleep(4000);
    console.log('Post-login URL:', page.url());

    const signInVisible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Sign In')
    );
    if (signInVisible) {
      console.log('ERROR: Login failed — Sign In still visible');
      await browser.close();
      process.exit(1);
    }
    console.log('Login verified');
  }

  // --- NAVIGATE TO QUESTION via search (avoids Cloudflare re-challenge on direct URL) ---
  const canonicalUrl = questionUrl.replace('https://www.quora.com/unanswered/', 'https://www.quora.com/');
  // Extract slug for search
  const slug = canonicalUrl.split('/').pop().replace(/-/g, ' ');
  console.log('Searching for question:', slug);

  // Strategy 1: Use Quora search to find question, then click (SPA navigation)
  let answerFound = false;
  try {
    await page.goto(`https://www.quora.com/search?q=${encodeURIComponent(slug)}&type=question`, {
      waitUntil: 'networkidle2', timeout: 60000
    });
    await waitForCloudflare(page, 30000);
    await sleep(5000);
    console.log('Search URL:', page.url());

    // Dump all question-style links for debugging
    const allLinks = await page.evaluate(() => {
      const seen = new Set();
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }))
        .filter(l => {
          const path = l.href.replace('https://www.quora.com', '');
          // Question URLs must: have 3+ hyphens, no sub-paths, not be nav pages
          const hyphenCount = (path.match(/-/g) || []).length;
          const isNavPage = /^\/(notifications|profile|settings|bookmarks|drafts|following|followers|answer|edit|ask|topics|spaces|login|signup|about)/.test(path);
          const isQuestionLike = path.match(/^\/[A-Za-z][A-Za-z0-9-]{15,}$/) && hyphenCount >= 3 && !isNavPage;
          if (!isQuestionLike) return false;
          if (seen.has(l.href)) return false;
          seen.add(l.href);
          return l.text.length > 10;
        })
        .slice(0, 5);
    });
    console.log('Candidate question links:', JSON.stringify(allLinks));

    if (allLinks.length > 0) {
      const firstHref = allLinks[0].href;
      console.log('Clicking question link:', firstHref);
      // Use evaluate to click via href to ensure correct element
      await page.evaluate((href) => {
        const link = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === href);
        if (link) link.click();
      }, firstHref);
      await sleep(6000);
      console.log('After click URL:', page.url());
      answerFound = await waitForAnswerButton(page, 30000);
    } else {
      console.log('No question links found in search results');
    }
  } catch(e) {
    console.log('Search strategy failed:', e.message);
  }

  // Strategy 2: Direct URL (last resort)
  if (!answerFound) {
    console.log('Falling back to direct URL navigation...');
    await page.goto(canonicalUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await waitForCloudflare(page, 60000);
    console.log('Direct URL:', page.url());
    await sleep(5000);
    answerFound = await waitForAnswerButton(page, 40000);
  }

  if (!answerFound) {
    console.log('Answer button never appeared. Page state:');
    const html = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
    console.log('HTML:', html);
    await browser.close();
    process.exit(1);
  }

  // --- FIND AND CLICK ANSWER BUTTON ---
  const answerBtn = await page.evaluateHandle(() => {
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    return all.find(el => el.textContent.trim() === 'Answer' || el.getAttribute('aria-label') === 'Answer') || null;
  });
  await answerBtn.click();
  console.log('Clicked Answer button');
  await sleep(3000);

  // --- TYPE ANSWER ---
  await sleep(2000);
  const editor = await page.$('[contenteditable="true"]');
  if (!editor) {
    console.log('Editor not found. HTML:', await page.evaluate(() => document.body.innerHTML.substring(0, 3000)));
    await browser.close();
    process.exit(1);
  }

  await editor.click();
  await sleep(1000);
  // Use execCommand to insert text (faster than keyboard simulation, avoids protocol timeout)
  await page.evaluate((el, text) => {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }, editor, answerText);
  console.log('Answer typed!');
  await sleep(2000);

  // --- SUBMIT ---
  const submitBtns = await page.$$('button');
  for (const btn of submitBtns) {
    const text = await page.evaluate(el => el.textContent.trim(), btn);
    if (text === 'Submit' || text === 'Post') {
      await btn.click();
      console.log('Submitted answer!');
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
