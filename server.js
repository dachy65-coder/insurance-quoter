const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const QUOTE_URL = 'https://www.agentinsure.com/compare/auto-insurance-home-insurance/whitestoneins/quote.aspx';

app.get('/', (req, res) => res.json({ status: 'Insurance Quoter Server Running' }));

app.post('/get-quote', async (req, res) => {
  const data = req.body;
  console.log('Quote request received:', data.firstName, data.lastName);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // STEP 1
    console.log('Step 1: Getting Started...');
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.click('input[value="No"]').catch(() => {});
    await page.waitForSelector('input[id*="FirstName"], input[name*="FirstName"]', { timeout: 10000 });
    const fnameEl = await page.$('input[id*="FirstName"], input[name*="FirstName"]');
    if (fnameEl) { await fnameEl.click({ clickCount: 3 }); await fnameEl.type(data.firstName); }
    const lnameEl = await page.$('input[id*="LastName"], input[name*="LastName"]');
    if (lnameEl) { await lnameEl.click({ clickCount: 3 }); await lnameEl.type(data.lastName); }
    const emailEl = await page.$('input[id*="Email"], input[name*="Email"], input[type="email"]');
    if (emailEl) { await emailEl.click({ clickCount: 3 }); await emailEl.type(data.email); }
    const phoneParts = data.phone.replace(/\D/g, '');
    const phoneInputs = await page.$$('input[id*="Phone"], input[name*="Phone"]');
    if (phoneInputs.length >= 3) {
      await phoneInputs[0].click({ clickCount: 3 }); await phoneInputs[0].type(phoneParts.slice(0, 3));
      await phoneInputs[1].click({ clickCount: 3 }); await phoneInputs[1].type(phoneParts.slice(3, 6));
      await phoneInputs[2].click({ clickCount: 3 }); await phoneInputs[2].type(phoneParts.slice(6, 10));
    }
    const addrEl = await page.$('input[id*="Address"], input[name*="Address"]');
    if (addrEl) { await addrEl.click({ clickCount: 3 }); await addrEl.type(data.address); }
    const cityEl = await page.$('input[id*="City"], input[name*="City"]');
    if (cityEl) { await cityEl.click({ clickCount: 3 }); await cityEl.type(data.city); }
    await page.select('select[id*="State"], select[name*="State"]', data.state).catch(() => {});
    const zipEl = await page.$('input[id*="Zip"], input[name*="Zip"]');
    if (zipEl) { await zipEl.click({ clickCount: 3 }); await zipEl.type(data.zip); }
    await page.click('input[value="Auto"]').catch(() => {});
    await page.click('input[value="Continue"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
    console.log('Step 1 done:', page.url());

    // STEP 2
    console.log('Step 2: Driver...');
    await page.waitForTimeout(1500);
    const dFname = await page.$('input[id*="FirstName"], input[name*="FirstName"]');
    if (dFname) { await dFname.click({ clickCount: 3 }); await dFname.type(data.firstName); }
    const dLname = await page.$('input[id*="LastName"], input[name*="LastName"]');
    if (dLname) { await dLname.click({ clickCount: 3 }); await dLname.type(data.lastName); }
    const dobParts = data.dob.split('/');
    const dobInputs = await page.$$('input[id*="DOB"], input[id*="Dob"], input[name*="DOB"]');
    if (dobInputs.length >= 3) {
      await dobInputs[0].click({ clickCount: 3 }); await dobInputs[0].type(dobParts[0] || '01');
      await dobInputs[1].click({ clickCount: 3 }); await dobInputs[1].type(dobParts[1] || '01');
      await dobInputs[2].click({ clickCount: 3 }); await dobInputs[2].type(dobParts[2] || '1990');
    }
    await page.select('select[id*="Gender"], select[name*="Gender"]', data.gender).catch(() => {});
    await page.select('select[id*="Marital"], select[name*="Marital"]', data.maritalStatus).catch(() => {});
    await page.select('select[id*="LicenseState"], select[name*="LicenseState"]', data.state).catch(() => {});
    await page.click('input[value="Next"], button[value="Next"]').catch(() => page.click('input[type="submit"]'));
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const nextBtn = await page.$('input[value="Next"], button[value="Next"]');
    if (nextBtn) {
      await nextBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    }
    console.log('Step 2 done:', page.url());

    // STEP 3
    console.log('Step 3: Vehicle...');
    await page.waitForTimeout(1500);
    await page.click('input[value*="year"], input[value*="Year"]').catch(() => {});
    await page.select('select[id*="Year"], select[name*="Year"]', String(data.vehicleYear)).catch(() => {});
    await page.waitForTimeout(800);
    await page.select('select[id*="Make"], select[name*="Make"]', data.vehicleMake).catch(() => {});
    await page.waitForTimeout(800);
    await page.select('select[id*="Model"], select[name*="Model"]', data.vehicleModel).catch(() => {});
    await page.waitForTimeout(800);
    const bodyStyleSel = await page.$('select[id*="BodyStyle"], select[name*="BodyStyle"]');
    if (bodyStyleSel) {
      const firstOpt = await page.evaluate(sel => {
        const opts = sel.querySelectorAll('option');
        return opts.length > 1 ? opts[1].value : '';
      }, bodyStyleSel);
      if (firstOpt) await page.select('select[id*="BodyStyle"], select[name*="BodyStyle"]', firstOpt);
    }
    const inspSel = await page.$('select[id*="Inspection"], select[name*="Inspection"]');
    if (inspSel) {
      const firstOpt = await page.evaluate(sel => {
        const opts = sel.querySelectorAll('option');
        return opts.length > 1 ? opts[1].value : '';
      }, inspSel);
      if (firstOpt) await page.select('select[id*="Inspection"], select[name*="Inspection"]', firstOpt);
    }
    await page.click('input[value="Owned"]').catch(() => {});
    await page.click('input[value="FullCoverage"], input[value="Full"]').catch(() => {});
    await page.click('input[value="No"]').catch(() => {});
    const purchaseInputs = await page.$$('input[id*="Purchase"], input[name*="Purchase"]');
    if (purchaseInputs.length >= 3) {
      await purchaseInputs[0].click({ clickCount: 3 }); await purchaseInputs[0].type('01');
      await purchaseInputs[1].click({ clickCount: 3 }); await purchaseInputs[1].type('01');
      await purchaseInputs[2].click({ clickCount: 3 }); await purchaseInputs[2].type(String(data.vehicleYear));
    }
    await page.click('input[value="Next"], button[value="Next"]').catch(() => page.click('input[type="submit"]'));
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const vNextBtn = await page.$('input[value="Next"], button[value="Next"]');
    if (vNextBtn) {
      await vNextBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    }
    console.log('Step 3 done:', page.url());

    // STEP 4
    console.log('Step 4: Incidents...');
    await page.waitForTimeout(1000);
    await page.click('input[value="Next"], button[value="Next"]').catch(() => page.click('input[type="submit"]'));
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    console.log('Step 4 done:', page.url());

    // STEP 5
    console.log('Step 5: Final page...');
    await page.waitForTimeout(1500);
    await page.select('select[id*="Residence"], select[name*="Residence"]', 'OwnHome').catch(() => {});
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const startInputs = await page.$$('input[id*="PolicyStart"], input[id*="EffectiveDate"], input[name*="Start"]');
    if (startInputs.length >= 3) {
      await startInputs[0].click({ clickCount: 3 }); await startInputs[0].type(mm);
      await startInputs[1].click({ clickCount: 3 }); await startInputs[1].type(dd);
      await startInputs[2].click({ clickCount: 3 }); await startInputs[2].type(yyyy);
    }
    await page.select('select[id*="Duration"], select[name*="Duration"]', '6').catch(() => {});
    await page.select('select[id*="CurrentInsurer"], select[name*="CurrentInsurer"]', data.currentInsurer || 'None').catch(() => {});
    const expInputs = await page.$$('input[id*="Expir"], input[id*="Renew"], input[name*="Expir"]');
    if (expInputs.length >= 3) {
      await expInputs[0].click({ clickCount: 3 }); await expInputs[0].type(mm);
      await expInputs[1].click({ clickCount: 3 }); await expInputs[1].type(dd);
      await expInputs[2].click({ clickCount: 3 }); await expInputs[2].type(yyyy);
    }
    const yesRadios = await page.$$('input[type="radio"][value="Yes"]');
    for (const radio of yesRadios) {
      await radio.click().catch(() => {});
    }
    await page.click('input[type="submit"], button[type="submit"], input[value="Submit"]').catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    console.log('Submitted! Now on:', page.url());

    // WAIT FOR QUOTES
    console.log('Waiting for quotes...');
    let quotes = [];
    let attempts = 0;
    while (attempts < 12) {
      await page.waitForTimeout(5000);
      attempts++;
      quotes = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tr');
        const results = [];
        rows.forEach(row => {
          const img = row.querySelector('img');
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const carrier = img ? img.alt : cells[0].innerText.trim();
            const term = cells[1] ? cells[1].innerText.trim() : '';
            const monthly = cells[2] ? cells[2].innerText.trim() : '';
            if (carrier && monthly && monthly.includes('$')) {
              results.push({ carrier, term, monthly });
            }
          }
        });
        return results;
      });
      console.log('Attempt ' + attempts + ': found ' + quotes.length + ' quotes');
      if (quotes.length > 0) break;
    }

    await browser.close();

    if (quotes.length === 0) {
      return res.status(200).json({ success: false, message: 'Quotes still calculating. Try again shortly.', quotes: [] });
    }

    console.log('Success! Returning ' + quotes.length + ' quotes');
    res.json({ success: true, quotes });

  } catch (err) {
    console.error('Error:', err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
