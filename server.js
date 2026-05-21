const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const QUOTE_URL = 'https://www.agentinsure.com/compare/auto-insurance-home-insurance/whitestoneins/quote.aspx';

app.get('/', (req, res) => res.json({ status: 'Insurance Quoter Running' }));

async function waitForText(page, text, timeout = 20000) {
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout },
      text
    );
    return true;
  } catch (e) {
    console.log('Timeout waiting for text:', text);
    return false;
  }
}

async function clickSubmit(page) {
  await page.evaluate(() => {
    const selectors = [
      'input[value="Continue"]',
      'input[value="Next"]',
      'input[value="Submit"]',
      'input[type="submit"]',
      'button[type="submit"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
  });
}

async function typeField(page, id, value) {
  try {
    const el = await page.$('#' + id);
    if (!el || !value) return;
    await el.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await el.type(String(value), { delay: 20 });
    await page.keyboard.press('Tab');
  } catch(e) {
    console.log('typeField failed for', id, ':', e.message);
  }
}

async function clickId(page, id) {
  try {
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.click();
    }, id);
  } catch(e) {}
}

app.post('/get-quote', async (req, res) => {
  const data = req.body;
  const insurer = data.currentInsurer || 'None';
  console.log('Quote request:', data.firstName, data.lastName);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // STEP 1: Getting Started
    console.log('Step 1: Loading page...');
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForText(page, 'Getting Started');
    console.log('Step 1: Page loaded, filling form...');

    await page.evaluate((d) => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      document.querySelectorAll('input[type="text"],input[type="email"]').forEach(inp => {
        const id = (inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname'))  { inp.value=d.lastName;  inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email'))     { inp.value=d.email;     inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address') && !id.includes('email')) { inp.value=d.address; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city'))      { inp.value=d.city;      inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip'))       { inp.value=d.zip;       inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const ph = d.phone.replace(/\D/g,'');
      const phoneInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phoneInputs.length>=3) {
        phoneInputs[0].value=ph.slice(0,3); phoneInputs[1].value=ph.slice(3,6); phoneInputs[2].value=ph.slice(6,10);
        phoneInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true})));
      }
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('state')) { sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='Auto') r.click(); });
    }, data);

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await waitForText(page, 'Driver');
    console.log('Step 1 done');

    // STEP 2: Driver
    console.log('Step 2: Filling driver...');
    await page.waitForTimeout(1000);
    await page.evaluate((d) => {
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname'))  { inp.value=d.lastName;  inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const dob=d.dob.split('/');
      const dobInputs=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('dob')||(i.id||'').toLowerCase().includes('birth'));
      if(dobInputs.length>=3){ dobInputs[0].value=dob[0]||'01'; dobInputs[1].value=dob[1]||'01'; dobInputs[2].value=dob[2]||'1990'; dobInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('gender'))  { sel.value=d.gender;        sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('marital')) { sel.value=d.maritalStatus; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('license')) { sel.value=d.state;         sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, data);
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Driver Summary');
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Vehicle');
    console.log('Step 2 done');

    // STEP 3: Vehicle
    console.log('Step 3: Filling vehicle...');
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value&&r.value.toLowerCase().includes('year')) r.click(); });
    });
    await page.waitForTimeout(500);
    await page.evaluate((year) => {
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('year')) { sel.value=year; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, String(data.vehicleYear));
    await page.waitForTimeout(1500);
    await page.evaluate((make) => {
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('make')) { sel.value=make; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, data.vehicleMake.toUpperCase());
    await page.waitForTimeout(1500);
    await page.evaluate((model) => {
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('model')) {
          for(const opt of sel.options) { if(opt.text.toLowerCase().includes(model.toLowerCase())) { sel.value=opt.value; break; } }
          sel.dispatchEvent(new Event('change',{bubbles:true}));
        }
      });
    }, data.vehicleModel);
    await page.waitForTimeout(1000);
    await page.evaluate((d) => {
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('body')&&sel.options.length>1)    { sel.value=sel.options[1].value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('inspect')&&sel.options.length>1) { sel.value=sel.options[1].value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        if(r.value===d.ownership) r.click();
        if(d.coverage==='FullCoverage'  && r.value&&r.value.toLowerCase().includes('full')) r.click();
        if(d.coverage==='LiabilityOnly' && r.value&&r.value.toLowerCase().includes('liab')) r.click();
      });
      const today=new Date();
      const mm=String(today.getMonth()+1).padStart(2,'0');
      const dd=String(today.getDate()).padStart(2,'0');
      const yyyy=String(today.getFullYear());
      const purchaseInputs=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('purchase'));
      if(purchaseInputs.length>=3){ purchaseInputs[0].value=mm; purchaseInputs[1].value=dd; purchaseInputs[2].value=yyyy; purchaseInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
    }, data);
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Vehicle Summary');
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Incident');
    console.log('Step 3 done');

    // STEP 4: Incidents
    console.log('Step 4: Incidents...');
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Almost Done');
    console.log('Step 4 done');

    // STEP 5: Final Page
    // IMPORTANT: Set selects FIRST (they may trigger postbacks), then type text fields
    console.log('Step 5: Final page...');
    await page.waitForTimeout(2000);

    const today = new Date();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const ph   = data.phone.replace(/\D/g, '');

    // STEP 5A: Set all selects first and wait for any postbacks to settle
    console.log('Step 5: Setting selects...');
    await page.evaluate((state, insurer) => {
      function setSelect(id, matchFn) {
        const el = document.getElementById(id);
        if (!el) return;
        for (const o of el.options) {
          if (matchFn(o.value, o.text)) { el.value = o.value; break; }
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // State - set without triggering postback if possible
      const stateEl = document.getElementById('Applicant_State');
      if (stateEl) { stateEl.value = state; stateEl.dispatchEvent(new Event('change', { bubbles: true })); }

      // Ownership
      setSelect('CurrentAddress_Ownership', (v, t) =>
        v.toLowerCase().includes('own') || t.toLowerCase().includes('own'));

      // Policy term 6 months
      setSelect('AutoPolicyInfo_PolicyTerm', (v, t) => v === '6' || t.includes('6'));

      // Prior carrier
      if (insurer && insurer !== 'None') {
        setSelect('AutoPriorPolicyInfo_PriorCarrier', (v, t) =>
          v !== '-1' && t.toLowerCase().includes(insurer.toLowerCase()));
      }
    }, data.state, insurer);

    // Wait for any postbacks triggered by select changes
    await page.waitForTimeout(2000);

    // STEP 5B: Now type all text fields AFTER selects have settled
    console.log('Step 5: Typing text fields...');
    await typeField(page, 'Applicant_FirstName',    data.firstName);
    await typeField(page, 'Applicant_LastName',     data.lastName);
    await typeField(page, 'Applicant_AddressLine1', data.address);
    await typeField(page, 'Applicant_City',         data.city);
    await typeField(page, 'Applicant_Zip',          data.zip);
    await typeField(page, 'Applicant_Email',        data.email);
    await typeField(page, 'Applicant_HomePhone',    ph.slice(0, 3));
    await typeField(page, 'Applicant_HomePhone_1',  ph.slice(3, 6));
    await typeField(page, 'Applicant_HomePhone_2',  ph.slice(6, 10));
    await typeField(page, 'AutoPolicyInfo_EffectiveDate',   mm);
    await typeField(page, 'AutoPolicyInfo_EffectiveDate_1', dd);
    await typeField(page, 'AutoPolicyInfo_EffectiveDate_2', yyyy);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration',   mm);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration_1', dd);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration_2', yyyy);

    // STEP 5C: Acknowledgements
    await clickId(page, 'PolicyInfo_CreditCheckAuth_Yes');
    await clickId(page, 'Applicant_TermsAcceptance_Yes');
    await clickId(page, 'Applicant_QuoteAccuracyAcceptance_Yes');

    // Full debug log
    const filled = await page.evaluate(() => ({
      firstName: document.getElementById('Applicant_FirstName')?.value,
      lastName:  document.getElementById('Applicant_LastName')?.value,
      address:   document.getElementById('Applicant_AddressLine1')?.value,
      city:      document.getElementById('Applicant_City')?.value,
      state:     document.getElementById('Applicant_State')?.value,
      zip:       document.getElementById('Applicant_Zip')?.value,
      email:     document.getElementById('Applicant_Email')?.value,
      phone1:    document.getElementById('Applicant_HomePhone')?.value,
      phone2:    document.getElementById('Applicant_HomePhone_1')?.value,
      phone3:    document.getElementById('Applicant_HomePhone_2')?.value,
      ownership: document.getElementById('CurrentAddress_Ownership')?.value,
      term:      document.getElementById('AutoPolicyInfo_PolicyTerm')?.value,
      effDate:   document.getElementById('AutoPolicyInfo_EffectiveDate')?.value,
      expDate:   document.getElementById('AutoPriorPolicyInfo_Expiration')?.value,
      carrier:   document.getElementById('AutoPriorPolicyInfo_PriorCarrier')?.value,
      credit:    document.getElementById('PolicyInfo_CreditCheckAuth_Yes')?.checked,
      terms:     document.getElementById('Applicant_TermsAcceptance_Yes')?.checked,
      accuracy:  document.getElementById('Applicant_QuoteAccuracyAcceptance_Yes')?.checked,
    }));
    console.log('Step 5 filled:', JSON.stringify(filled));

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    console.log('Step 5: Submitted, waiting for Quote Summary...');
    await waitForText(page, 'Quote Summary', 60000);
    console.log('Reached Quote Summary page!');

    // Scrape quotes
    let quotes = [];
    let attempts = 0;
    while (attempts < 15) {
      await page.waitForTimeout(5000);
      attempts++;
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.log('Page text sample:', pageText.replace(/\n/g,' '));

      quotes = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('table tr').forEach(row => {
          const img   = row.querySelector('img');
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const carrier = img ? img.alt : cells[0].innerText.trim();
            const text    = row.innerText;
            const match   = text.match(/\$[\d,]+\.?\d*/g);
            if (carrier && carrier.length > 2 && match && match.length > 0) {
              const monthly = match[match.length - 1];
              const term    = match.length > 1 ? 'Auto - ' + match[0] + ' (6 Months)' : 'Auto (6 Months)';
              results.push({ carrier: carrier.trim(), term, monthly });
            }
          }
        });
        return results;
      });

      console.log('Attempt ' + attempts + ': found ' + quotes.length + ' quotes');
      if (quotes.length > 0) break;

      const stillCalc = await page.evaluate(() => document.body.innerText.includes('being calculated'));
      if (!stillCalc && attempts > 3) { console.log('No more calculating'); break; }
    }

    await browser.close();
    if (quotes.length === 0) {
      return res.status(200).json({ success: false, message: 'Quotes still calculating. Please try again in a moment.', quotes: [] });
    }
    console.log('Success! ' + quotes.length + ' quotes found');
    res.json({ success: true, quotes });

  } catch(err) {
    console.error('Error:', err.message);
    if(browser) await browser.close().catch(()=>{});
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
