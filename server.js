// v4
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const QUOTE_URL = 'https://www.agentinsure.com/compare/auto-insurance-home-insurance/whitestoneins/quote.aspx';

app.get('/', (req, res) => res.json({ status: 'Insurance Quoter Running v4' }));
// Scrape EZLynx vehicle options for a given year and make
app.get('/get-models', async (req, res) => {
  const { year, make } = req.query;
  if (!year || !make) return res.json({ error: 'year and make required' });
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']
    });
    const page = await browser.newPage();
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Fill minimal Step 1
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value='Test'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname'))  { inp.value='User';  inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email'))     { inp.value='test@test.com'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address'))   { inp.value='123 Main St'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city'))      { inp.value='New York'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip'))       { inp.value='10001'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const ph = '9295551234';
      const phones = Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phones.length>=3) { phones[0].value=ph.slice(0,3); phones[1].value=ph.slice(3,6); phones[2].value=ph.slice(6,10); phones.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      document.querySelectorAll('select').forEach(sel => { if((sel.id||'').toLowerCase().includes('state')) { sel.value='NY'; sel.dispatchEvent(new Event('change',{bubbles:true})); } });
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='Auto') r.click(); });
    });
    await page.evaluate(() => { document.querySelector('input[type="submit"]')?.click(); });
    await page.waitForFunction(() => document.body.innerText.includes('Driver'), { timeout: 15000 });
    // Skip driver
    await page.evaluate(() => { document.querySelector('input[type="submit"]')?.click(); });
    await page.waitForFunction(() => document.body.innerText.includes('Driver Summary'), { timeout: 15000 });
    await page.evaluate(() => { document.querySelector('input[type="submit"]')?.click(); });
    await page.waitForFunction(() => document.body.innerText.includes('Vehicle'), { timeout: 15000 });
    // Set year and make
    await page.evaluate((y) => {
      document.querySelectorAll('select').forEach(sel => { if((sel.id||'').toLowerCase().includes('year')) { sel.value=y; sel.dispatchEvent(new Event('change',{bubbles:true})); } });
    }, year);
    await page.waitForTimeout(2000);
    await page.evaluate((m) => {
      document.querySelectorAll('select').forEach(sel => { if((sel.id||'').toLowerCase().includes('make')) { sel.value=m; sel.dispatchEvent(new Event('change',{bubbles:true})); } });
    }, make.toUpperCase());
    await page.waitForTimeout(2000);
    // Get all model options
    const models = await page.evaluate(() => {
      const sel = Array.from(document.querySelectorAll('select')).find(s => (s.id||'').toLowerCase().includes('model') && !(s.id||'').toLowerCase().includes('sub'));
      if (!sel) return [];
      return Array.from(sel.options).filter(o => o.value !== '-1').map(o => o.text);
    });
    await browser.close();
    res.json({ year, make, models });
  } catch(e) {
    if(browser) await browser.close().catch(()=>{});
    res.json({ error: e.message });
  }
});

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

async function waitForSelectOptions(page, keyword, timeout = 8000) {
  try {
    await page.waitForFunction((kw) => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => (s.id || '').toLowerCase().includes(kw));
      return sel && sel.options.length > 1;
    }, { timeout }, keyword);
    return true;
  } catch(e) {
    console.log('Timeout waiting for select options:', keyword);
    return false;
  }
}

async function scrapeQuotes(page) {
  return await page.evaluate(() => {
    const results = [];
    const skipWords = ['bodily','injury','property','damage','liability','medical','uninsured','underinsured','collision','comprehensive','coverage','deductible','protection'];
    document.querySelectorAll('table tr').forEach(row => {
      const img   = row.querySelector('img');
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const carrier = img ? img.alt : cells[0].innerText.trim().split('\n')[0];
        const text    = row.innerText;
        const match   = text.match(/\$[\d,]+\.?\d*/g);
        const carrierLower = carrier.toLowerCase();
        const isJunk = skipWords.some(w => carrierLower.includes(w));
        if (carrier && carrier.length > 2 && !isJunk && match && match.length > 0) {
          const monthly = match[match.length - 1];
          const term    = match.length > 1 ? 'Auto - ' + match[0] + ' (6 Months)' : 'Auto (6 Months)';
          results.push({ carrier: carrier.trim(), term, monthly });
        }
      }
    });
    return results;
  });
}

async function fixVehicleSelects(page, data) {
  await page.evaluate((d) => {
    document.querySelectorAll('select').forEach(sel => {
      const id = (sel.id || '').toLowerCase();
      if (!id.startsWith('vehicle')) return; // Only fix vehicle selects
      if (sel.value === '-1' && sel.options.length > 1) {
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if ((id.includes('comprehensive') || id.includes('collision')) &&
          (sel.value === 'NoCoverage' || sel.value === '-1')) {
        for (const o of sel.options) {
          if (o.value === 'Item500' || o.value === '500') { sel.value = o.value; break; }
        }
        if (sel.value === 'NoCoverage' || sel.value === '-1') sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      if(r.value === d.ownership) r.click();
      if(d.coverage === 'FullCoverage'  && r.value && r.value.toLowerCase().includes('full')) r.click();
      if(d.coverage === 'LiabilityOnly' && r.value && r.value.toLowerCase().includes('liab')) r.click();
    });
    const today = new Date(); today.setDate(today.getDate() + 7);
    const mm  = String(today.getMonth() + 1).padStart(2, '0');
    const dd  = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const purchaseInputs = Array.from(document.querySelectorAll('input[type="text"]'))
      .filter(i => (i.id || '').toLowerCase().includes('purchase'));
    if (purchaseInputs.length >= 3) {
      purchaseInputs[0].value = mm; purchaseInputs[1].value = dd; purchaseInputs[2].value = yyyy;
      purchaseInputs.forEach(i => i.dispatchEvent(new Event('change', { bubbles: true })));
    }
  }, data);
}

app.post('/get-quote', async (req, res) => {
  const data = req.body;
  const insurer = data.currentInsurer || 'None';
  const useVin = data.vehicleEntryMethod === 'vin' && data.vin && data.vin.length === 17;
  console.log('Quote request:', data.firstName, data.lastName,
    useVin ? 'VIN:' + data.vin : data.vehicleYear + ' ' + data.vehicleMake + ' ' + data.vehicleModel);
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

    const dob = (data.dob || '01/01/1990').split('/');

    await page.evaluate((d, dob) => {
      // Fill name fields
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')) { inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname'))  { inp.value=d.lastName;  inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });

      // Fill DOB - try split inputs first
      const dobInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i => {
        const id = (i.id||'').toLowerCase();
        return id.includes('dob') || id.includes('birth');
      });
      if(dobInputs.length >= 3) {
        dobInputs[0].value = dob[0]||'01';
        dobInputs[1].value = dob[1]||'01';
        dobInputs[2].value = dob[2]||'1990';
        dobInputs.forEach(i => i.dispatchEvent(new Event('change',{bubbles:true})));
      }

      // Fill selects
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('gender'))  { sel.value=d.gender||'Male'; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('marital')) { sel.value='Single';          sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('license') || id.includes('dlstate')) { sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, data, dob);

    // Also try typeField for DOB as backup
    await typeField(page, 'Driver1_DOB',   dob[0]||'01');
    await typeField(page, 'Driver1_DOB_1', dob[1]||'01');
    await typeField(page, 'Driver1_DOB_2', dob[2]||'1990');

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

    if (useVin) {
      console.log('Step 3: Using VIN:', data.vin);

      // Click "By VIN" radio
      await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]').forEach(r => {
          const val = (r.value || '').toUpperCase();
          const label = ((r.closest('label') || r.parentElement || {}).innerText || '').toUpperCase();
          if(val === 'VIN' || label.includes('BY VIN') || label.includes('VIN')) r.click();
        });
      });
      await page.waitForTimeout(1000);

      // Type VIN - try multiple approaches
      await page.evaluate((vin) => {
        // Try by ID containing VIN
        let filled = false;
        document.querySelectorAll('input[type="text"]').forEach(inp => {
          const id = (inp.id || inp.name || '').toUpperCase();
          if (id.includes('VIN') && !filled) {
            inp.value = vin;
            inp.dispatchEvent(new Event('input',  { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true;
          }
        });
        // Fallback: first visible text input on page
        if (!filled) {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          if (inputs.length > 0) {
            inputs[0].value = vin;
            inputs[0].dispatchEvent(new Event('input',  { bubbles: true }));
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }, data.vin);

      await page.waitForTimeout(500);

      // Click Lookup VIN button - try multiple selectors
      const lookupClicked = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('input, button, a'));
        const btn = allEls.find(b => {
          const txt = (b.value || b.innerText || b.textContent || b.id || '').toLowerCase();
          return txt.includes('lookup') || txt.includes('look up') || txt.includes('decode');
        });
        if (btn) { btn.click(); return true; }
        return false;
      });
      console.log('Lookup VIN clicked:', lookupClicked);

      // Wait for VIN to decode and year to populate
      await waitForSelectOptions(page, 'year', 10000);
      await page.waitForTimeout(2000);

    } else {
      // Year/Make/Model
      await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]').forEach(r => {
          if(r.value && r.value.toLowerCase().includes('year')) r.click();
        });
      });
      await page.waitForTimeout(500);

      console.log('Step 3: Setting year', data.vehicleYear);
      await page.evaluate((year) => {
        document.querySelectorAll('select').forEach(sel => {
          if((sel.id||'').toLowerCase().includes('year') && (sel.id||'').toLowerCase().includes('vehicle')) {
            sel.value=year; sel.dispatchEvent(new Event('change',{bubbles:true}));
          }
        });
      }, String(data.vehicleYear));

      await waitForSelectOptions(page, 'make', 8000);
      await page.waitForTimeout(500);

      console.log('Step 3: Setting make', data.vehicleMake);
      await page.evaluate((make) => {
        document.querySelectorAll('select').forEach(sel => {
          if((sel.id||'').toLowerCase().includes('make')) {
            for(const opt of sel.options) {
              if(opt.value.toUpperCase()===make || opt.text.toUpperCase()===make) { sel.value=opt.value; break; }
            }
            sel.dispatchEvent(new Event('change',{bubbles:true}));
          }
        });
      }, data.vehicleMake.toUpperCase());

      await waitForSelectOptions(page, 'model', 8000);
      await page.waitForTimeout(500);

      console.log('Step 3: Setting model', data.vehicleModel);
      await page.evaluate((model) => {
        document.querySelectorAll('select').forEach(sel => {
          if((sel.id||'').toLowerCase().includes('model') && !(sel.id||'').toLowerCase().includes('submodel')) {
            let matched = false;
            for(const opt of sel.options) {
              const optClean = opt.text.toLowerCase().replace(/\b[a-z]\d{3,4}\b/gi,'').replace(/\s+/g,' ').trim();
              const modelClean = model.toLowerCase().trim();
              if(optClean.includes(modelClean) || modelClean.includes(optClean)) { sel.value=opt.value; matched=true; break; }
            }
            if(!matched && sel.options.length>1) sel.value=sel.options[1].value;
            sel.dispatchEvent(new Event('change',{bubbles:true}));
          }
        });
      }, data.vehicleModel || '');
    }

    // Fix all remaining -1 selects
    await page.waitForTimeout(2000);
    await fixVehicleSelects(page, data);
    await page.waitForTimeout(500);

    const vDebug = await page.evaluate(() =>
      Array.from(document.querySelectorAll('select')).map(s => ({ id: s.id, value: s.value, options: s.options.length }))
    );
    // Log all options in model and submodel dropdowns
    const dropdownDebug = await page.evaluate(() => {
      const result = {};
      document.querySelectorAll('select').forEach(sel => {
        const id = sel.id;
        if (id.includes('Model') || id.includes('SubModel')) {
          result[id] = Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        }
      });
      return result;
    });
    console.log('Dropdown options:', JSON.stringify(dropdownDebug));
    console.log('Vehicle selects after fix:', JSON.stringify(vDebug));

    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Vehicle Summary');
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Incident');
    console.log('Step 3 done');

    // STEP 4: Incidents - always click No to skip
    console.log('Step 4: Incidents...');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        const v = (r.value||'').toLowerCase();
        if(v === 'no' || v === 'none' || v === 'false') r.click();
      });
    });
    await page.waitForTimeout(500);
    await clickSubmit(page);
    await waitForText(page, 'Almost Done');
    console.log('Step 4 done');

    // STEP 5: Final Page
    console.log('Step 5: Final page...');
    await page.waitForTimeout(2000);

    const today = new Date();
    today.setDate(today.getDate() + 7);
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());
    const ph   = data.phone.replace(/\D/g, '');

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
      const stateEl = document.getElementById('Applicant_State');
      if (stateEl) { stateEl.value = state; stateEl.dispatchEvent(new Event('change', { bubbles: true })); }
      setSelect('CurrentAddress_Ownership', (v, t) => v.toLowerCase().includes('own') || t.toLowerCase().includes('own'));
      setSelect('AutoPolicyInfo_PolicyTerm', (v, t) => v === '6' || t.includes('6'));
      const norm = s => s.toLowerCase().replace(/[\s\-\_\.]/g, '');
      if (insurer && insurer !== 'None') {
        setSelect('AutoPriorPolicyInfo_PriorCarrier', (v, t) => v !== '-1' && norm(t).includes(norm(insurer)));
      } else {
        setSelect('AutoPriorPolicyInfo_PriorCarrier', (v, t) => v !== '' && v !== '-1' && (t.toLowerCase().includes('no prior') || t.toLowerCase().includes('none')));
      }
    }, data.state, insurer);

    await page.waitForTimeout(2000);

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

    await clickId(page, 'PolicyInfo_CreditCheckAuth_Yes');
    await clickId(page, 'Applicant_TermsAcceptance_Yes');
    await clickId(page, 'Applicant_QuoteAccuracyAcceptance_Yes');

    const filled = await page.evaluate(() => ({
      firstName: document.getElementById('Applicant_FirstName')?.value,
      lastName:  document.getElementById('Applicant_LastName')?.value,
      city:      document.getElementById('Applicant_City')?.value,
      state:     document.getElementById('Applicant_State')?.value,
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

    let quotes = [];
    let attempts = 0;
    while (attempts < 15) {
      try {
        await page.waitForTimeout(6000);
        attempts++;
        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 300));
        console.log('Attempt ' + attempts + ' page sample:', pageText.replace(/\n/g,' '));
        quotes = await scrapeQuotes(page);
        console.log('Attempt ' + attempts + ': found ' + quotes.length + ' quotes');
        if (quotes.length > 0) break;
        const stillCalc = await page.evaluate(() => document.body.innerText.includes('being calculated'));
        if (!stillCalc && attempts > 4) { console.log('No more calculating'); break; }
      } catch(e) {
        console.log('Attempt ' + attempts + ' interrupted:', e.message);
        await page.waitForTimeout(4000);
      }
    }

    await browser.close();
    if (quotes.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'Online quotes are not available for this vehicle. Please call Whitestone Insurance at (929) 292-8005 for a personalized quote.',
        quotes: []
      });
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
