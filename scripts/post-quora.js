const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

const questionUrl = process.env.QUESTION_URL;
const answerText = process.env.ANSWER_TEXT;

// Multi-account: pick a random account from available cookie sets
const cookieSets = [];
for (let i = 1; i <= 10; i++) {
  const key = i === 1 ? process.env.QUORA_COOKIES : process.env[`QUORA_COOKIES_${i}`];
  if (key) cookieSets.push(key);
}
if (cookieSets.length === 0) {
  console.log('ERROR: No QUORA_COOKIES found');
  process.exit(1);
}
const quoraCookies = cookieSets[Math.floor(Math.random() * cookieSets.length)];
console.log(`Using account ${cookieSets.indexOf(quoraCookies) + 1} of ${cookieSets.length}`);

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

  // Cookie auth
  console.log('Using cookie-based auth');
  try {
    const cookies = JSON.parse(quoraCookies);
    const fixedCookies = cookies.map(c => ({
      ...c,
      domain: c.domain.startsWith('.') ? c.domain : ('.' + c.domain.replace(/^www\./, ''))
    }));
    await page.goto('https://www.quora.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForCloudflare(page, 60000);
    await page.setCookie(...fixedCookies);
    console.log('Injected', fixedCookies.length, 'cookies');
    await page.goto('https://www.quora.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000);
    console.log('Post-cookie URL:', page.url());
    const isLoggedIn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      return !btns.some(el => el.textContent.trim() === 'Sign In');
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

  // Navigate to question via search
  const canonicalUrl = questionUrl.replace('https://www.quora.com/unanswered/', 'https://www.quora.com/');
  const slug = canonicalUrl.split('/').pop().replace(/-/g, ' ');
  console.log('Searching for question:', slug);

  let answerFound = false;
  try {
    await page.goto(`https://www.quora.com/search?q=${encodeURIComponent(slug)}&type=question`, {
      waitUntil: 'networkidle2', timeout: 60000
    });
    await waitForCloudflare(page, 30000);
    await sleep(5000);
    console.log('Search URL:', page.url());

    const allLinks = await page.evaluate(() => {
      const seen = new Set();
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) }))
        .filter(l => {
          const path = l.href.replace('https://www.quora.com', '');
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

  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    const btn = all.find(el => el.textContent.trim() === 'Answer' || el.getAttribute('aria-label') === 'Answer');
    if (btn) btn.click();
  });
  console.log('Clicked Answer button');

  try {
    await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
    console.log('Navigated after click:', page.url());
    await waitForCloudflare(page, 30000);
    await sleep(5000);
    const answerAgain = await waitForAnswerButton(page, 20000);
    if (answerAgain) {
      console.log('Clicking Answer button on question page');
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = all.find(el => el.textContent.trim() === 'Answer' || el.getAttribute('aria-label') === 'Answer');
        if (btn) btn.click();
      });
    }
  } catch(e) {
    console.log('No navigation occurred — expecting inline editor');
  }

  await sleep(3000);
  page.setDefaultTimeout(15000);
  const editor = await page.$('[contenteditable="true"]').catch(() => null);
  if (!editor) {
    console.log('Editor not found. HTML:', await page.evaluate(() => document.body.innerHTML.substring(0, 3000)).catch(() => 'eval failed'));
    await browser.close();
    process.exit(1);
  }

  await editor.click().catch(() => {});
  await sleep(1000);
  await page.evaluate((el, text) => {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }, editor, answerText);
  console.log('Answer typed!');
  await sleep(2000);

  const submitted = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.trim() === 'Submit' || b.textContent.trim() === 'Post');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log(submitted ? 'Submitted answer!' : 'Submit button not found');

  await sleep(3000);
  await browser.close();
  console.log('Done!');
})().catch(async err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
