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

app.post('/get-quote', async (req, res) => {
  const data = req.body;
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

    // STEP 1
    console.log('Step 1: Loading page...');
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForText(page, 'Getting Started');
    console.log('Step 1: Page loaded, filling form...');

    await page.evaluate((d) => {
      // Business = No
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      // Fill text fields
      document.querySelectorAll('input[type="text"],input[type="email"]').forEach(inp => {
        const id = (inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value=d.lastName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email')) { inp.value=d.email; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address') && !id.includes('email')) { inp.value=d.address; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city')) { inp.value=d.city; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip')) { inp.value=d.zip; inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      // Phone
      const ph = d.phone.replace(/\D/g,'');
      const phoneInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phoneInputs.length>=3) {
        phoneInputs[0].value=ph.slice(0,3); phoneInputs[1].value=ph.slice(3,6); phoneInputs[2].value=ph.slice(6,10);
        phoneInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true})));
      }
      // State
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('state')) { sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      // Auto
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='Auto') r.click(); });
    }, data);

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    console.log('Step 1: Submitted, waiting for Driver page...');
    await waitForText(page, 'Driver');
    console.log('Step 1 done');

    // STEP 2: Driver
    console.log('Step 2: Filling driver...');
    await page.waitForTimeout(1000);
    await page.evaluate((d) => {
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value=d.lastName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const dob=d.dob.split('/');
      const dobInputs=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('dob')||(i.id||'').toLowerCase().includes('birth'));
      if(dobInputs.length>=3){ dobInputs[0].value=dob[0]||'01'; dobInputs[1].value=dob[1]||'01'; dobInputs[2].value=dob[2]||'1990'; dobInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('gender')) { sel.value=d.gender; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('marital')) { sel.value=d.maritalStatus; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('license')) { sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, data);
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Driver Summary');
    console.log('Step 2: Driver submitted, clicking Next on summary...');
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Vehicle');
    console.log('Step 2 done');

    // STEP 3: Vehicle
    console.log('Step 3: Filling vehicle...');
    await page.waitForTimeout(1000);
    await page.evaluate((d) => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value&&r.value.toLowerCase().includes('year')) r.click(); });
    }, data);
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
    await page.evaluate(() => {
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('body')&&sel.options.length>1) { sel.value=sel.options[1].value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('inspect')&&sel.options.length>1) { sel.value=sel.options[1].value; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        if(r.value==='Owned') r.click();
        if(r.value&&r.value.toLowerCase().includes('full')) r.click();
      });
    });
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Vehicle Summary');
    console.log('Step 3: Vehicle submitted, clicking Next on summary...');
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
// STEP 5: Final
console.log('Step 5: Final page...');
await page.waitForTimeout(1500);
const today = new Date();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const yyyy = String(today.getFullYear());

await page.evaluate((mm, dd, yyyy, insurer, data) => {
  // Fill text/email/tel input fields
  const fieldMap = {
    'first': data.firstName,
    'fname': data.firstName,
    'last': data.lastName,
    'lname': data.lastName,
    'address': data.address,
    'city': data.city,
    'zip': data.zip,
    'postal': data.zip,
    'email': data.email,
    'phone': data.phone,
  };

  document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])').forEach(input => {
    const id = (input.id || input.name || '').toLowerCase();
    for (const [key, value] of Object.entries(fieldMap)) {
      if (id.includes(key) && value) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  });

  // Fill select dropdowns
  document.querySelectorAll('select').forEach(sel => {
    const id = (sel.id || '').toLowerCase();

    if (id.includes('state')) {
      for (const o of sel.options) {
        if (o.value === data.state || o.text === data.state) { sel.value = o.value; break; }
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (id.includes('resid')) {
      for (const o of sel.options) {
        if (o.value.includes('Own') || o.value.includes('Home')) { sel.value = o.value; break; }
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (id.includes('duration')) {
      for (const o of sel.options) {
        if (o.value === '6' || o.text.includes('6')) { sel.value = o.value; break; }
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (id.includes('insur') || id.includes('carrier')) {
      for (const o of sel.options) {
        if (o.text.toLowerCase().includes(insurer.toLowerCase())) { sel.value = o.value; break; }
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

}, mm, dd, yyyy, insurer, {
  firstName: body.firstName,
  lastName: body.lastName,
  address: body.address,
  city: body.city,
  state: body.state,
  zip: body.zip,
  email: body.email,
  phone: body.phone,
});
// Date fields
      // Date fields
      const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
      const startInputs = allInputs.filter(i=>(i.id||'').toLowerCase().includes('start')||(i.id||'').toLowerCase().includes('effective'));
      const expInputs = allInputs.filter(i=>(i.id||'').toLowerCase().includes('expir')||(i.id||'').toLowerCase().includes('renew'));
      [startInputs, expInputs].forEach(inputs => {
        if(inputs.length>=3) { inputs[0].value=mm; inputs[1].value=dd; inputs[2].value=yyyy; inputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      });
      // Acknowledgements
      document.querySelectorAll('input[type="radio"][value="Yes"]').forEach(r=>r.click());
    }, mm, dd, yyyy, data.currentInsurer||'None');

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    console.log('Step 5: Submitted, waiting for Quote Summary...');
    await waitForText(page, 'Quote Summary', 30000);
    console.log('Reached Quote Summary page!');

    // Wait for quotes to load and scrape
    let quotes = [];
    let attempts = 0;
    while (attempts < 15) {
      await page.waitForTimeout(5000);
      attempts++;

      // Get full page text for debugging
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('Page text sample:', pageText.replace(/\n/g,' '));

      quotes = await page.evaluate(() => {
        const results = [];
        // Try multiple table structures
        document.querySelectorAll('table tr').forEach(row => {
          const img = row.querySelector('img');
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const carrier = img ? img.alt : cells[0].innerText.trim();
            const text = row.innerText;
            const match = text.match(/\$[\d,]+\.?\d*/g);
            if (carrier && carrier.length > 2 && match && match.length > 0) {
              const monthly = match[match.length-1];
              const term = match.length > 1 ? 'Auto - ' + match[0] + ' (6 Months)' : '';
              results.push({ carrier: carrier.trim(), term, monthly });
            }
          }
        });
        return results;
      });

      console.log('Attempt ' + attempts + ': found ' + quotes.length + ' quotes');
      if (quotes.length > 0) break;

      // Check if still calculating
      const stillCalc = await page.evaluate(() => document.body.innerText.includes('being calculated'));
      if (!stillCalc && attempts > 3) {
        console.log('Page no longer calculating but no quotes found');
        break;
      }
    }

    await browser.close();
    if (quotes.length === 0) return res.status(200).json({ success: false, message: 'Quotes still calculating. Please try again in a moment.', quotes: [] });
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
