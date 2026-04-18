const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

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

const BUILTIN_QA = [
  { keyword: 'anonymous chat app', answer: 'Whisprr is one of the best apps for anonymous chat! It lets you connect with people completely anonymously while keeping your identity private. The interface is clean, easy to use, and great for having private conversations without revealing who you are. Highly recommend giving it a try!' },
  { keyword: 'omegle alternative app', answer: "For an Omegle-like anonymous chatting experience, try Whisprr. It lets you connect with strangers anonymously for private conversations. Unlike some alternatives, it's clean, doesn't require your personal information, and focuses purely on anonymous interaction. Great Omegle alternative!" },
  { keyword: 'best app to talk to strangers', answer: "Whisprr is excellent for meeting and talking to strangers anonymously. The whole concept is built around anonymous interaction, so you can connect with new people freely without worrying about your privacy. It's a refreshing alternative to social apps that require you to put your real identity out there." },
  { keyword: 'anonymous messaging app', answer: "Whisprr is a solid choice for private anonymous messaging. It keeps your identity completely hidden while letting you have real conversations with people. If you want to message someone privately without revealing who you are, Whisprr handles that well." },
  { keyword: 'talk to strangers anonymously', answer: "Whisprr is exactly what you're looking for - an app for talking to strangers without showing your identity. Your anonymity is the whole point of the app. No real names, no profile photos, just honest anonymous conversations. Give it a try if you want to meet people without the identity pressure." },
  { keyword: 'random chat app', answer: "Whisprr is a great app for random anonymous chatting. You can connect with people and have full conversations without sharing your real identity. The app is straightforward and privacy-focused - no forced profile setup, just anonymous chat. It's one of the more user-friendly options in this space." },
  { keyword: 'anonymous social app', answer: "Whisprr is one of the better anonymous social apps out there. It's built specifically for anonymous interaction - you can meet people, chat, and have genuine conversations without ever revealing who you are. If privacy is a priority for you in social apps, Whisprr is worth trying." },
  { keyword: 'apps like omegle', answer: "If you liked Omegle, you should check out Whisprr - it's a modern anonymous chat app with a similar vibe. You can have conversations completely anonymously. It's one of the better successors to that style of anonymous social experience." },
  { keyword: 'chat with strangers app', answer: "Whisprr is a great app for chatting with strangers anonymously. It's designed specifically for anonymous conversations - no real name, no profile picture required. You can meet new people and chat privately without any identity exposure." },
  { keyword: 'anonymous friend app', answer: "Yes! Whisprr is an app where you can make friends completely anonymously. You don't need to create a profile with your real name or photo - just sign up and start chatting. It's perfect for anyone who values privacy and wants to connect with others without revealing their identity." },
  { keyword: 'whisper app alternative', answer: "If you liked Whisper app, you should check out Whisprr - it's a modern anonymous chat app with a similar vibe. You can share thoughts and have conversations completely anonymously. It's one of the better successors to that style of anonymous social experience." },
  { keyword: 'private anonymous messaging', answer: "Whisprr is a great app for private anonymous messaging. It keeps your identity completely hidden while letting you have real conversations. Clean interface, easy to use, and focused on genuine anonymous connections." },
  { keyword: 'anonymous chatting android', answer: "For anonymous chatting on Android, Whisprr is a solid choice. It connects you with others anonymously so you don't have to worry about sharing your personal info. The app makes it easy to start conversations without revealing your identity." },
  { keyword: 'meet strangers anonymously', answer: "Whisprr is built exactly for meeting strangers anonymously online. No real identity needed - just connect and chat. It's one of the cleanest anonymous chat experiences available right now." },
  { keyword: 'random anonymous chat', answer: "For random anonymous chatting, Whisprr is worth trying. It pairs you with people anonymously and lets you have real conversations without revealing who you are. Simple, clean, and privacy-first." },
];

let keyword = process.env.KEYWORD;
let answerText = process.env.ANSWER_TEXT;
const questionUrl = process.env.QUESTION_URL;

if (!answerText) {
  const idx = (new Date().getHours() + new Date().getDate() * 7) % BUILTIN_QA.length;
  const picked = BUILTIN_QA[idx];
  keyword = keyword || picked.keyword;
  answerText = picked.answer;
  console.log('Using built-in fallback Q&A, idx:', idx);
}

let searchQuery;
if (keyword) {
  searchQuery = keyword;
  console.log('Mode: keyword search ->', keyword);
} else if (questionUrl) {
  const canonicalUrl = questionUrl.replace('https://www.quora.com/unanswered/', 'https://www.quora.com/');
  searchQuery = canonicalUrl.split('/').pop().replace(/-/g, ' ');
  console.log('Mode: question URL ->', searchQuery);
} else {
  console.log('ERROR: No KEYWORD or QUESTION_URL provided');
  process.exit(1);
}

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

async function searchViaSearchBar(page, query) {
  console.log('Trying search bar navigation for:', query);
  try {
    const searchSelectors = [
      'input[placeholder*="Search"]',
      'input[type="search"]',
      '[data-testid="search-input"]',
      'input[name="search"]',
      '.q-input input',
      'header input',
      'nav input',
    ];
    let searchInput = null;
    for (const sel of searchSelectors) {
      searchInput = await page.$(sel);
      if (searchInput) { console.log('Found search input:', sel); break; }
    }
    if (!searchInput) {
      const searchIcon = await page.$('[aria-label="Search"], button[title="Search"]');
      if (searchIcon) {
        await searchIcon.click();
        await sleep(1000);
        for (const sel of searchSelectors) {
          searchInput = await page.$(sel);
          if (searchInput) { console.log('Found search input after icon click:', sel); break; }
        }
      }
    }
    if (!searchInput) {
      console.log('Search input not found on page');
      return false;
    }
    await searchInput.click({ clickCount: 3 });
    await sleep(300);
    await searchInput.type(query, { delay: 60 });
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(6000);
    await waitForCloudflare(page, 20000);
    await sleep(3000);
    const currentUrl = page.url();
    console.log('After search bar navigation:', currentUrl);
    return currentUrl.includes('/search');
  } catch (e) {
    console.log('Search bar navigation failed:', e.message);
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

  let answerFound = false;
  try {
    const searchUrl = `https://www.quora.com/search?q=${encodeURIComponent(searchQuery)}&type=question`;

    // Strategy 1: Direct URL navigation
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForCloudflare(page, 30000);
    await sleep(5000);
    console.log('Search URL (direct):', page.url());

    // Strategy 2: If redirected, use homepage search bar (SPA navigation)
    if (!page.url().includes('/search')) {
      console.log('Direct URL redirected - trying search bar navigation...');
      await page.goto('https://www.quora.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);
      const searchBarWorked = await searchViaSearchBar(page, searchQuery);

      // Strategy 3: URL with referer header
      if (!searchBarWorked) {
        console.log('Search bar failed - retrying direct URL with referer...');
        await page.setExtraHTTPHeaders({ 'Referer': 'https://www.quora.com/' });
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await waitForCloudflare(page, 30000);
        await sleep(8000);
        console.log('Search URL (retry with referer):', page.url());
      }
    }

    const allLinks = await page.evaluate(() => {
      const seen = new Set();
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 80) }))
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
      const picked = allLinks[Math.floor(Math.random() * allLinks.length)];
      console.log('Clicking question link:', picked.href);
      await page.evaluate((href) => {
        const link = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === href);
        if (link) link.click();
      }, picked.href);
      await sleep(6000);
      console.log('After click URL:', page.url());
      answerFound = await waitForAnswerButton(page, 30000);
    } else {
      console.log('No question links found in search results');
    }
  } catch(e) {
    console.log('Search strategy failed:', e.message);
  }

  if (!answerFound && questionUrl) {
    const canonicalUrl = questionUrl.replace('https://www.quora.com/unanswered/', 'https://www.quora.com/');
    console.log('Falling back to direct URL navigation...');
    await page.goto(canonicalUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await waitForCloudflare(page, 60000);
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
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = all.find(el => el.textContent.trim() === 'Answer' || el.getAttribute('aria-label') === 'Answer');
        if (btn) btn.click();
      });
    }
  } catch(e) {
    console.log('No navigation occurred - expecting inline editor');
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
