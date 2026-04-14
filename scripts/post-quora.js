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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
  Chrome/120.0.0.0 Safari/537.36');

    console.log('Logging in to Quora...');
    await page.goto('https://www.quora.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email, { delay: 60 });
    await sleep(500);
    await page.type('input[type="password"]', password, { delay: 60 });
    await sleep(500);
    await page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(3000);
    console.log('Logged in!');

    console.log('Navigating to question:', questionUrl);
    await page.goto(questionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const [answerBtn] = await page.$x('//button[contains(., "Answer")]');
    if (answerBtn) {
      await answerBtn.click();
      console.log('Answer button clicked');
    } else {
      await page.click('button[class*="answer"]').catch(() => {});
    }
    await sleep(2500);

    const editor = await page.$('[contenteditable="true"]');
    if (editor) {
      await editor.click();
      await sleep(500);
      await page.keyboard.type(answerText, { delay: 15 });
      console.log('Answer typed!');
    } else {
      console.log('Editor not found');
      process.exit(1);
    }
    await sleep(1000);

    const [submitBtn] = await page.$x('//button[contains(., "Submit") or contains(., "Post")]');
    if (submitBtn) {
      await submitBtn.click();
      console.log('Answer submitted!');
    }

    await sleep(3000);
    await browser.close();
  })();
