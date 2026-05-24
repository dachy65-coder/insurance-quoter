// v8
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const QUOTE_URL = 'https://www.agentinsure.com/compare/auto-insurance-home-insurance/whitestoneins/quote.aspx';

app.get('/', (req, res) => res.json({ status: 'Insurance Quoter Running v8' }));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForText(page, text, timeout = 20000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    return true;
  } catch (e) {
    console.log('Timeout waiting for text:', text);
    return false;
  }
}

async function clickSubmit(page) {
  await page.evaluate(() => {
    const selectors = ['input[value="Continue"]','input[value="Next"]','input[value="Submit"]','input[type="submit"]','button[type="submit"]'];
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
  } catch(e) { console.log('typeField failed:', id, e.message); }
}

async function clickId(page, id) {
  try {
    await page.evaluate((id) => { const el = document.getElementById(id); if (el) el.click(); }, id);
  } catch(e) {}
}

async function nativeSelect(page, selector, value) {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.select(selector, value);
    return true;
  } catch(e) {
    console.log('nativeSelect failed:', selector, value, e.message);
    return false;
  }
}

async function waitForSelectOptions(page, keyword, minOptions = 2, timeout = 8000) {
  try {
    await page.waitForFunction((kw, min) => {
      const sels = Array.from(document.querySelectorAll('select'));
      const sel = sels.find(s => (s.id || '').toLowerCase().includes(kw));
      return sel && sel.options.length >= min;
    }, { timeout }, keyword, minOptions);
    return true;
  } catch(e) {
    console.log('Timeout waiting for select options:', keyword);
    return false;
  }
}

async function fillVehicleYMM(page, vehicleYear, vehicleMake, vehicleModel) {
  // Year
  const yearSelId = await page.evaluate(() => {
    const sel = Array.from(document.querySelectorAll('select')).find(s =>
      (s.id||'').toLowerCase().includes('year') && (s.id||'').toLowerCase().includes('vehicle'));
    return sel ? '#' + sel.id : null;
  });
  if (yearSelId) await nativeSelect(page, yearSelId, String(vehicleYear));
  await waitForSelectOptions(page, 'make', 5, 8000);
  await new Promise(r => setTimeout(r, 1000));

  // Make
  const makeResult = await page.evaluate((make) => {
    const sel = Array.from(document.querySelectorAll('select')).find(s => (s.id||'').toLowerCase().includes('make'));
    if (!sel) return null;
    for(const o of sel.options) {
      if(o.value.toUpperCase()===make||o.text.toUpperCase()===make) return { id:'#'+sel.id, value:o.value };
    }
    return { id:'#'+sel.id, value:null };
  }, vehicleMake.toUpperCase());
  if (makeResult && makeResult.value) await nativeSelect(page, makeResult.id, makeResult.value);
  await waitForSelectOptions(page, 'model', 5, 8000);
  await new Promise(r => setTimeout(r, 1000));

  // Model
  const modelResult = await page.evaluate((model) => {
    const sel = Array.from(document.querySelectorAll('select')).find(s =>
      (s.id||'').toLowerCase().includes('model') && !(s.id||'').toLowerCase().includes('sub'));
    if (!sel) return null;
    const modelClean = model.toLowerCase().trim();
    for(const o of sel.options) {
      if(o.text.toLowerCase()===modelClean) return { id:'#'+sel.id, value:o.value, match:'exact' };
    }
    for(const o of sel.options) {
      if(o.text.toLowerCase().startsWith(modelClean+' ')||o.text.toLowerCase().startsWith(modelClean)) {
        return { id:'#'+sel.id, value:o.value, match:'startsWith' };
      }
    }
    for(const o of sel.options) {
      const optClean=o.text.toLowerCase().replace(/\b[a-z]\d{3,4}\b/gi,'').trim();
      if(optClean.includes(modelClean)||modelClean.includes(optClean)) {
        return { id:'#'+sel.id, value:o.value, match:'contains' };
      }
    }
    for(const o of sel.options) {
      const t=o.text.toLowerCase();
      if(t.startsWith(modelClean)&&(t.includes(' lx')||t.includes(' ex')||t.includes(' se'))) {
        return { id:'#'+sel.id, value:o.value, match:'trim' };
      }
    }
    if(sel.options.length>1) return { id:'#'+sel.id, value:sel.options[1].value, match:'first' };
    return null;
  }, vehicleModel||'');
  console.log('Model result:', JSON.stringify(modelResult));
  if (modelResult && modelResult.value) await nativeSelect(page, modelResult.id, modelResult.value);
  await new Promise(r => setTimeout(r, 2000));

  // SubModel — pick first option with non-zero price, fallback to first option
  const subModelValue = await page.evaluate(() => {
    const sub = document.getElementById('Vehicle1_SubModel');
    if (!sub) return null;
    for (const o of sub.options) {
      if (o.value && o.value !== '-1' && !o.value.endsWith('|0')) {
        sub.value = o.value;
        sub.dispatchEvent(new Event('change', { bubbles: true }));
        return o.value;
      }
    }
    if (sub.options.length > 1) {
      sub.value = sub.options[1].value;
      sub.dispatchEvent(new Event('change', { bubbles: true }));
      return sub.options[1].value;
    }
    return null;
  });
  console.log('SubModel selected:', subModelValue);
  await new Promise(r => setTimeout(r, 500));
}

async function fixVehicleSelects(page, data) {
  await page.evaluate((d) => {
    document.querySelectorAll('select').forEach(sel => {
      const id=(sel.id||'').toLowerCase();
      if(!id.startsWith('vehicle')) return;
      if(id.includes('submodel')) return; // Don't touch SubModel
      if(sel.value==='-1'&&sel.options.length>1) {
        sel.value=sel.options[1].value;
        sel.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if((id.includes('comprehensive')||id.includes('collision'))&&(sel.value==='NoCoverage'||sel.value==='-1')) {
        for(const o of sel.options){ if(o.value==='Item500'||o.value==='500'){sel.value=o.value;break;} }
        if(sel.value==='NoCoverage'||sel.value==='-1') sel.value=sel.options[1].value;
        sel.dispatchEvent(new Event('change',{bubbles:true}));
      }
    });
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      if(r.value===d.ownership) r.click();
      if(d.coverage==='FullCoverage'&&r.value&&r.value.toLowerCase().includes('full')) r.click();
      if(d.coverage==='LiabilityOnly'&&r.value&&r.value.toLowerCase().includes('liab')) r.click();
    });
    // Purchase date = 7 days ago
    const pd=new Date(); pd.setDate(pd.getDate()-7);
    const pmm=String(pd.getMonth()+1).padStart(2,'0');
    const pdd=String(pd.getDate()).padStart(2,'0');
    const pyyyy=String(pd.getFullYear());
    const purchaseInputs=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('purchase'));
    if(purchaseInputs.length>=3){
      purchaseInputs[0].value=pmm; purchaseInputs[1].value=pdd; purchaseInputs[2].value=pyyyy;
      purchaseInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true})));
    }
  }, data);
}

async function scrapeQuotes(page) {
  return await page.evaluate(() => {
    const results = [];
    const skipWords = ['bodily','injury','property','damage','liability','medical','uninsured','underinsured','collision','comprehensive','coverage','deductible','protection'];
    document.querySelectorAll('table tr').forEach(row => {
      const img = row.querySelector('img');
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const carrier = img ? img.alt : cells[0].innerText.trim().split('\n')[0];
        const text = row.innerText;
        const match = text.match(/\$[\d,]+\.?\d*/g);
        const carrierLower = carrier.toLowerCase();
        const isJunk = skipWords.some(w => carrierLower.includes(w));
        if (carrier && carrier.length > 2 && !isJunk && match && match.length > 0) {
          const monthly = match[match.length - 1];
          const term = match.length > 1 ? 'Auto - ' + match[0] + ' (6 Months)' : 'Auto (6 Months)';
          results.push({ carrier: carrier.trim(), term, monthly });
        }
      }
    });
    return results;
  });
}


app.get('/get-models', async (req, res) => {
  const { year, make } = req.query;
  if (!year || !make) return res.json({ error: 'year and make required' });
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')){ inp.value='Test'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value='User'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email'))    { inp.value='test@test.com'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address')&&!id.includes('email')){ inp.value='123 Main St'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city'))     { inp.value='New York'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip'))      { inp.value='10001'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const ph='9295551234';
      const phones=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phones.length>=3){phones[0].value=ph.slice(0,3);phones[1].value=ph.slice(3,6);phones[2].value=ph.slice(6,10);phones.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true})));}
      document.querySelectorAll('select').forEach(sel=>{if((sel.id||'').toLowerCase().includes('state')){sel.value='NY';sel.dispatchEvent(new Event('change',{bubbles:true}));}});
      document.querySelectorAll('input[type="radio"]').forEach(r=>{if(r.value==='Auto')r.click();});
    });
    await sleep(1000);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Driver'),{timeout:20000});
    await sleep(500);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Driver Summary'),{timeout:20000});
    await sleep(500);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Vehicle'),{timeout:20000});
    await sleep(1000);
    await page.select('#Vehicle1_Year', String(year));
    await sleep(1500);
    await page.evaluate((m)=>{
      const sel=document.getElementById('Vehicle1_Make');
      if(sel){for(const o of sel.options){if(o.value.toUpperCase()===m||o.text.toUpperCase()===m){sel.value=o.value;sel.dispatchEvent(new Event('change',{bubbles:true}));break;}}}
    }, make.toUpperCase());
    await sleep(2000);
    const models = await page.evaluate(()=>{
      const sel=document.getElementById('Vehicle1_Model');
      if(!sel) return [];
      return Array.from(sel.options).filter(o=>o.value&&o.value!=='-1').map(o=>o.text.trim()).filter(t=>t&&t!=='--select--');
    });
    await browser.close();
    res.json({ year, make, models });
  } catch(e) {
    if(browser) await browser.close().catch(()=>{});
    res.json({ error: e.message, models: [] });
  }
});

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
    console.log('Step 1: Filling form...');
    await page.evaluate((d) => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      document.querySelectorAll('input[type="text"],input[type="email"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')){ inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value=d.lastName;  inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email'))    { inp.value=d.email;     inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address')&&!id.includes('email')){ inp.value=d.address; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city'))     { inp.value=d.city;      inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip'))      { inp.value=d.zip;       inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const ph=d.phone.replace(/\D/g,'');
      const phones=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phones.length>=3){ phones[0].value=ph.slice(0,3); phones[1].value=ph.slice(3,6); phones[2].value=ph.slice(6,10); phones.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      document.querySelectorAll('select').forEach(sel => {
        if((sel.id||'').toLowerCase().includes('state')){ sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='Auto') r.click(); });
    }, data);
    await new Promise(r => setTimeout(r, 1000));
    await clickSubmit(page);
    await waitForText(page, 'Driver');
    console.log('Step 1 done');

    // STEP 2
    console.log('Step 2: Filling driver...');
    await new Promise(r => setTimeout(r, 1000));
    const dob=(data.dob||'01/01/1990').split('/');
    await page.evaluate((d, dob) => {
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')){ inp.value=d.firstName; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value=d.lastName;  inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const dobInputs=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('dob')||(i.id||'').toLowerCase().includes('birth'));
      if(dobInputs.length>=3){ dobInputs[0].value=dob[0]||'01'; dobInputs[1].value=dob[1]||'01'; dobInputs[2].value=dob[2]||'1990'; dobInputs.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true}))); }
      document.querySelectorAll('select').forEach(sel => {
        const id=(sel.id||'').toLowerCase();
        if(id.includes('gender'))  { sel.value=d.gender||'Male'; sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('marital')) { sel.value='Single';          sel.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('license')||id.includes('dlstate')){ sel.value=d.state; sel.dispatchEvent(new Event('change',{bubbles:true})); }
      });
    }, data, dob);
    await typeField(page, 'Driver1_DOB',   dob[0]||'01');
    await typeField(page, 'Driver1_DOB_1', dob[1]||'01');
    await typeField(page, 'Driver1_DOB_2', dob[2]||'1990');
    await new Promise(r => setTimeout(r, 500));
    await clickSubmit(page);
    await waitForText(page, 'Driver Summary');
    await new Promise(r => setTimeout(r, 500));
    await clickSubmit(page);
    await waitForText(page, 'Vehicle');
    console.log('Step 2 done');

    // STEP 3: Vehicle
    console.log('Step 3: Filling vehicle...');
    await new Promise(r => setTimeout(r, 1000));

    if (useVin) {
      console.log('Step 3: Using VIN:', data.vin);
      await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]').forEach(r => {
          const val=(r.value||'').toUpperCase();
          const label=((r.closest('label')||r.parentElement||{}).innerText||'').toUpperCase();
          if(val==='VIN'||label.includes('BY VIN')||label.includes('VIN')) r.click();
        });
      });
      await new Promise(r => setTimeout(r, 1000));
      await page.evaluate((vin) => {
        document.querySelectorAll('input[type="text"]').forEach(inp => {
          const id=(inp.id||inp.name||'').toUpperCase();
          if(id.includes('VIN')){ inp.value=vin; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
        });
      }, data.vin);
      await new Promise(r => setTimeout(r, 500));
      const lookupClicked = await page.evaluate(() => {
        const btns=Array.from(document.querySelectorAll('input, button'));
        const btn=btns.find(b=>(b.value||b.innerText||b.textContent||'').toLowerCase().includes('lookup'));
        if(btn){ btn.click(); return true; }
        return false;
      });
      console.log('VIN lookup clicked:', lookupClicked);
      await waitForSelectOptions(page, 'year', 2, 10000);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Click By year/make/model radio
      await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]').forEach(r => {
          if(r.value&&r.value.toLowerCase().includes('year')) r.click();
        });
      });
      await new Promise(r => setTimeout(r, 500));
      await fillVehicleYMM(page, data.vehicleYear, data.vehicleMake, data.vehicleModel);
    }

    // Fix remaining selects and set purchase date
    await fixVehicleSelects(page, data);
    await new Promise(r => setTimeout(r, 500));

    const vState = await page.evaluate(() =>
      Array.from(document.querySelectorAll('select')).filter(s=>(s.id||'').startsWith('Vehicle')).map(s=>({id:s.id,value:s.value,options:s.options.length}))
    );
    console.log('Vehicle state before submit:', JSON.stringify(vState));

    // Submit vehicle form
    await clickSubmit(page);
    await new Promise(r => setTimeout(r, 5000));

    // Check if still on vehicle page with errors (ASP.NET postback reset)
    const stillOnVehiclePage = await page.evaluate(() =>
      document.body.innerText.includes('Please correct the items')
    );
    console.log('Still on vehicle page after submit:', stillOnVehiclePage);

    if (!useVin && stillOnVehiclePage) {
      console.log('Re-filling vehicle after postback reset...');
      // If SubModel had |0, try the next available model trim
      const modelToUse = await page.evaluate((model) => {
        const sel = document.getElementById('Vehicle1_Model');
        if (!sel) return model;
        // Check if current SubModel has |0
        const sub = document.getElementById('Vehicle1_SubModel');
        const subHasZero = sub && sub.value && sub.value.endsWith('|0');
        if (!subHasZero) return model;
        // Find next option with same base name
        const base = model.split(' ')[0];
        let foundCurrent = false;
        for (const o of sel.options) {
          if (o.value === model) { foundCurrent = true; continue; }
          if (foundCurrent && o.text.startsWith(base)) return o.value;
        }
        return model;
      }, data.vehicleModel);
      console.log('Model to use on retry:', modelToUse);
      await fillVehicleYMM(page, data.vehicleYear, data.vehicleMake, modelToUse);
      await fixVehicleSelects(page, data);
      await new Promise(r => setTimeout(r, 1000));

      const vState2 = await page.evaluate(() =>
        Array.from(document.querySelectorAll('select')).filter(s=>(s.id||'').startsWith('Vehicle')).map(s=>({id:s.id,value:s.value,options:s.options.length}))
      );
      console.log('Vehicle state 2nd submit:', JSON.stringify(vState2));
      await clickSubmit(page);
      await new Promise(r => setTimeout(r, 3000));
    }

    const vSummary = await waitForText(page, 'Vehicle Summary', 15000);
    if (!vSummary) {
      const vText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('Vehicle page error:', vText.replace(/\n/g,' '));
    }
    await new Promise(r => setTimeout(r, 500));
    await clickSubmit(page);
    await waitForText(page, 'Incident');
    console.log('Step 3 done');

    // STEP 4: Incidents
    console.log('Step 4: Incidents...');
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        const v=(r.value||'').toLowerCase();
        if(v==='no'||v==='none'||v==='false') r.click();
      });
    });
    await new Promise(r => setTimeout(r, 500));
    await clickSubmit(page);
    await waitForText(page, 'Almost Done');
    console.log('Step 4 done');

    // STEP 5
    console.log('Step 5: Final page...');
    await new Promise(r => setTimeout(r, 2000));
    const today=new Date(); today.setDate(today.getDate()+7);
    const mm=String(today.getMonth()+1).padStart(2,'0');
    const dd=String(today.getDate()).padStart(2,'0');
    const yyyy=String(today.getFullYear());
    const ph=data.phone.replace(/\D/g,'');

    console.log('Step 5: Setting selects...');
    await page.evaluate((state, insurer) => {
      function setSelect(id, matchFn) {
        const el=document.getElementById(id);
        if(!el) return;
        for(const o of el.options){ if(matchFn(o.value,o.text)){el.value=o.value;break;} }
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const stateEl=document.getElementById('Applicant_State');
      if(stateEl){ stateEl.value=state; stateEl.dispatchEvent(new Event('change',{bubbles:true})); }
      setSelect('CurrentAddress_Ownership',(v,t)=>v.toLowerCase().includes('own')||t.toLowerCase().includes('own'));
      setSelect('AutoPolicyInfo_PolicyTerm',(v,t)=>v==='6'||t.includes('6'));
      const norm=s=>s.toLowerCase().replace(/[\s\-\_\.]/g,'');
      if(insurer&&insurer!=='None'){
        setSelect('AutoPriorPolicyInfo_PriorCarrier',(v,t)=>v!=='-1'&&norm(t).includes(norm(insurer)));
      } else {
        setSelect('AutoPriorPolicyInfo_PriorCarrier',(v,t)=>v!==''&&v!=='-1'&&(t.toLowerCase().includes('no prior')||t.toLowerCase().includes('none')));
      }
    }, data.state, insurer);

    await new Promise(r => setTimeout(r, 2000));
    console.log('Step 5: Typing text fields...');
    await typeField(page, 'Applicant_FirstName',    data.firstName);
    await typeField(page, 'Applicant_LastName',     data.lastName);
    await typeField(page, 'Applicant_AddressLine1', data.address);
    await typeField(page, 'Applicant_City',         data.city);
    await typeField(page, 'Applicant_Zip',          data.zip);
    await typeField(page, 'Applicant_Email',        data.email);
    await typeField(page, 'Applicant_HomePhone',    ph.slice(0,3));
    await typeField(page, 'Applicant_HomePhone_1',  ph.slice(3,6));
    await typeField(page, 'Applicant_HomePhone_2',  ph.slice(6,10));
    await typeField(page, 'AutoPolicyInfo_EffectiveDate',   mm);
    await typeField(page, 'AutoPolicyInfo_EffectiveDate_1', dd);
    await typeField(page, 'AutoPolicyInfo_EffectiveDate_2', yyyy);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration',   mm);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration_1', dd);
    await typeField(page, 'AutoPriorPolicyInfo_Expiration_2', yyyy);
    await clickId(page, 'PolicyInfo_CreditCheckAuth_Yes');
    await clickId(page, 'Applicant_TermsAcceptance_Yes');
    await clickId(page, 'Applicant_QuoteAccuracyAcceptance_Yes');

    const filled=await page.evaluate(()=>({
      firstName: document.getElementById('Applicant_FirstName')?.value,
      lastName:  document.getElementById('Applicant_LastName')?.value,
      city:      document.getElementById('Applicant_City')?.value,
      state:     document.getElementById('Applicant_State')?.value,
      credit:    document.getElementById('PolicyInfo_CreditCheckAuth_Yes')?.checked,
      terms:     document.getElementById('Applicant_TermsAcceptance_Yes')?.checked,
      accuracy:  document.getElementById('Applicant_QuoteAccuracyAcceptance_Yes')?.checked,
    }));
    console.log('Step 5 filled:', JSON.stringify(filled));

    await new Promise(r => setTimeout(r, 1000));
    await clickSubmit(page);
    console.log('Step 5: Submitted, waiting for Quote Summary...');
    await waitForText(page, 'Quote Summary', 60000);
    console.log('Reached Quote Summary page!');

    let quotes=[];
    let attempts=0;
    while(attempts<15){
      try{
        await new Promise(r => setTimeout(r, 6000));
        attempts++;
        const pageText=await page.evaluate(()=>document.body.innerText.substring(0,300));
        console.log('Attempt '+attempts+' page sample:', pageText.replace(/\n/g,' '));
        quotes=await scrapeQuotes(page);
        console.log('Attempt '+attempts+': found '+quotes.length+' quotes');
        if(quotes.length>0) break;
        const stillCalc=await page.evaluate(()=>document.body.innerText.includes('being calculated'));
        if(!stillCalc&&attempts>4){ console.log('No more calculating'); break; }
      } catch(e){
        console.log('Attempt '+attempts+' interrupted:', e.message);
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    await browser.close();
    if(quotes.length===0){
      return res.status(200).json({
        success: false,
        message: 'Online quotes are not available for this vehicle. Please call Whitestone Insurance at (929) 292-8005 for a personalized quote.',
        quotes: []
      });
    }
    console.log('Success! '+quotes.length+' quotes found');
    res.json({ success: true, quotes });

  } catch(err){
    console.error('Error:', err.message);
    if(browser) await browser.close().catch(()=>{});
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── SCRAPER ───────────────────────────────────────────────────────────────
const https = require('https');

const MAKES = [
  'ACURA','ALFA ROMEO','AUDI','BMW','BUICK','CADILLAC','CHEVROLET','CHRYSLER',
  'DODGE','FIAT','FORD','GENESIS','GMC','HONDA','HYUNDAI','INFINITI',
  'JAGUAR','JEEP','KIA','LAND ROVER','LEXUS','LINCOLN','MASERATI','MAZDA',
  'MERCEDES-BENZ','MINI','MITSUBISHI','NISSAN','PORSCHE','RAM','SUBARU',
  'TESLA','TOYOTA','VOLKSWAGEN','VOLVO'
];
const MAKE_START_YEAR = {
  'GENESIS':2017,'TESLA':2012,'ALFA ROMEO':2015,'FIAT':2012,'MASERATI':2014,'RAM':2010,'MINI':2002
};

let scrapeStatus = { running: false, current: '', progress: 0, total: 0, done: false, error: null };
let scrapeResults = {};

async function saveToGist(data) {
  const token = process.env.GITHUB_TOKEN;
  const gistId = process.env.GIST_ID;
  if (!token || !gistId) return;
  const body = JSON.stringify({ files: { 'ezlynx-models.json': { content: JSON.stringify(data, null, 2) } } });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com', path: `/gists/${gistId}`, method: 'PATCH',
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'insurance-quoter', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.on('data', ()=>{}); res.on('end', resolve); });
    req.on('error', (e) => { console.log('Gist save error:', e.message); resolve(); });
    req.write(body); req.end();
  });
}

async function runScraper() {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate to vehicle page once
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    await page.evaluate(() => {
      document.querySelectorAll('input[type="radio"]').forEach(r => { if(r.value==='No') r.click(); });
      document.querySelectorAll('input[type="text"]').forEach(inp => {
        const id=(inp.id||'').toLowerCase();
        if(id.includes('firstname')){ inp.value='Test'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('lastname')) { inp.value='User'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('email'))    { inp.value='test@test.com'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('address')&&!id.includes('email')){ inp.value='123 Main St'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('city'))     { inp.value='New York'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
        if(id.includes('zip'))      { inp.value='10001'; inp.dispatchEvent(new Event('change',{bubbles:true})); }
      });
      const ph='9295551234';
      const phones=Array.from(document.querySelectorAll('input[type="text"]')).filter(i=>(i.id||'').toLowerCase().includes('phone'));
      if(phones.length>=3){phones[0].value=ph.slice(0,3);phones[1].value=ph.slice(3,6);phones[2].value=ph.slice(6,10);phones.forEach(i=>i.dispatchEvent(new Event('change',{bubbles:true})));}
      document.querySelectorAll('select').forEach(sel=>{if((sel.id||'').toLowerCase().includes('state')){sel.value='NY';sel.dispatchEvent(new Event('change',{bubbles:true}));}});
      document.querySelectorAll('input[type="radio"]').forEach(r=>{if(r.value==='Auto')r.click();});
    });
    await sleep(1500);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Driver'),{timeout:30000});
    await sleep(500);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Driver Summary'),{timeout:30000});
    await sleep(500);
    await page.evaluate(()=>{document.querySelector('input[type="submit"]')?.click();});
    await page.waitForFunction(()=>document.body.innerText.includes('Vehicle'),{timeout:30000});
    await sleep(1000);
    console.log('Scraper: on vehicle page!');

    // Count total combinations
    let total = 0;
    for (const make of MAKES) {
      const startYear = MAKE_START_YEAR[make] || 2000;
      total += (2025 - startYear + 1);
    }
    scrapeStatus.total = total;
    let done = 0;

    for (const make of MAKES) {
      if (!scrapeResults[make]) scrapeResults[make] = {};
      const startYear = MAKE_START_YEAR[make] || 2000;
      scrapeStatus.current = make;
      console.log(`Scraping ${make}...`);

      for (let year = 2025; year >= startYear; year--) {
        if (scrapeResults[make][year]) { done++; scrapeStatus.progress = done; continue; }
        try {
          await page.select('#Vehicle1_Year', String(year));
          await sleep(1200);
          const makeSet = await page.evaluate((m) => {
            const sel=document.getElementById('Vehicle1_Make');
            if(!sel) return false;
            for(const o of sel.options){ if(o.value.toUpperCase()===m||o.text.toUpperCase()===m){sel.value=o.value;sel.dispatchEvent(new Event('change',{bubbles:true}));return true;} }
            return false;
          }, make);
          if (!makeSet) { done++; scrapeStatus.progress = done; continue; }
          await sleep(2000);
          const models = await page.evaluate(() => {
            const sel=document.getElementById('Vehicle1_Model');
            if(!sel) return [];
            return Array.from(sel.options).filter(o=>o.value&&o.value!=='-1').map(o=>o.text.trim()).filter(t=>t&&t!=='--select--');
          });
          if (models.length > 0) {
            scrapeResults[make][year] = models;
            console.log(`  ${year} ${make}: ${models.length} models`);
          }
        } catch(e) {
          console.log(`  ${year} ${make}: error - ${e.message}`);
        }
        done++; scrapeStatus.progress = done;
        await sleep(300);
      }

      // Save to Gist after each make
      await saveToGist(scrapeResults);
      console.log(`Saved ${make} to Gist`);
    }

    await browser.close();
    scrapeStatus.running = false;
    scrapeStatus.done = true;
    console.log('Scrape complete!');
  } catch(e) {
    console.error('Scraper error:', e.message);
    scrapeStatus.running = false;
    scrapeStatus.error = e.message;
    if (browser) await browser.close().catch(()=>{});
  }
}

app.get('/start-scrape', (req, res) => {
  if (scrapeStatus.running) return res.json({ message: 'Already running', status: scrapeStatus });
  scrapeStatus = { running: true, current: '', progress: 0, total: 0, done: false, error: null };
  scrapeResults = {};
  runScraper();
  res.json({ message: 'Scrape started!', status: scrapeStatus });
});

app.get('/scrape-status', (req, res) => {
  res.json({ ...scrapeStatus, makes: Object.keys(scrapeResults).length, gistId: process.env.GIST_ID });
});

app.get('/scrape-result', (req, res) => {
  res.json(scrapeResults);
});
// ───────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
