const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();
app.use(cors());
app.use(express.json());

const QUOTE_URL =
  "https://www.agentinsure.com/compare/auto-insurance-home-insurance/whitestoneins/quote.aspx";

app.get("/", (req, res) => {
  res.json({ status: "Insurance Quoter Running", version: "fixed-quote-summary-check" });
});

async function waitForText(page, text, timeout = 20000) {
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout },
      text
    );
    return true;
  } catch {
    console.log("Timeout waiting for text:", text);
    return false;
  }
}

async function pageText(page, limit = 3000) {
  return await page.evaluate((limit) => {
    return document.body.innerText.substring(0, limit);
  }, limit);
}

async function clickSubmit(page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll("input, button, a")
    );

    const btn = buttons.find((el) => {
      const text = (
        el.value ||
        el.innerText ||
        el.textContent ||
        ""
      ).trim().toLowerCase();

      return (
        text === "continue" ||
        text === "next" ||
        text === "submit" ||
        text.includes("continue")
      );
    });

    if (btn) {
      btn.click();
      return true;
    }

    return false;
  });

  if (!clicked) {
    throw new Error("No Continue/Submit button found");
  }
}

async function stopIfValidationError(page, stepName) {
  const txt = await pageText(page, 4000);

  if (
    txt.includes("Please correct the items") ||
    txt.includes("highlighted") ||
    txt.includes("Items marked with an asterisk")
  ) {
    console.log("VALIDATION FAILED:", stepName);
    console.log(txt);

    throw new Error(stepName + " validation failed. Missing required fields.");
  }
}

async function typeById(page, id, value) {
  if (!value) return;

  const exists = await page.$("#" + id);
  if (!exists) {
    console.log("Missing field id:", id);
    return;
  }

  await exists.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await exists.type(String(value), { delay: 10 });
}

async function setSelectById(page, id, search) {
  await page.evaluate(
    ({ id, search }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const s = String(search || "").toLowerCase();

      for (const opt of el.options) {
        const txt = String(opt.text || "").toLowerCase();
        const val = String(opt.value || "").toLowerCase();

        if (txt.includes(s) || val.includes(s)) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      }
    },
    { id, search }
  );
}

async function clickById(page, id) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.click();
  }, id);
}

async function fillAllPossibleTextFields(page, data) {
  await page.evaluate((d) => {
    const phone = String(d.phone || "").replace(/\D/g, "");

    document.querySelectorAll("input[type='text'], input[type='email']").forEach((inp) => {
      const id = String(inp.id || "").toLowerCase();
      const name = String(inp.name || "").toLowerCase();

      const key = id + " " + name;

      if (key.includes("firstname") || key.includes("first_name")) inp.value = d.firstName || "";
      else if (key.includes("lastname") || key.includes("last_name")) inp.value = d.lastName || "";
      else if (key.includes("email")) inp.value = d.email || "";
      else if (key.includes("address") && !key.includes("email")) inp.value = d.address || "";
      else if (key.includes("city")) inp.value = d.city || "";
      else if (key.includes("zip")) inp.value = d.zip || "";
      else if (key.includes("phone") && phone.length >= 10) inp.value = phone;

      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      inp.dispatchEvent(new Event("blur", { bubbles: true }));
    });

    document.querySelectorAll("select").forEach((sel) => {
      const id = String(sel.id || "").toLowerCase();
      const name = String(sel.name || "").toLowerCase();
      const key = id + " " + name;

      if (key.includes("state")) {
        sel.value = d.state || sel.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }, data);
}

async function fillFinalApplicantPage(page, data) {
  const phone = String(data.phone || "").replace(/\D/g, "");
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yyyy = String(today.getFullYear());

  await typeById(page, "Applicant_FirstName", data.firstName);
  await typeById(page, "Applicant_LastName", data.lastName);
  await typeById(page, "Applicant_AddressLine1", data.address);
  await typeById(page, "Applicant_City", data.city);
  await typeById(page, "Applicant_Zip", data.zip);
  await typeById(page, "Applicant_Email", data.email);

  await typeById(page, "Applicant_HomePhone", phone.slice(0, 3));
  await typeById(page, "Applicant_HomePhone_1", phone.slice(3, 6));
  await typeById(page, "Applicant_HomePhone_2", phone.slice(6, 10));

  await typeById(page, "AutoPolicyInfo_EffectiveDate", mm);
  await typeById(page, "AutoPolicyInfo_EffectiveDate_1", dd);
  await typeById(page, "AutoPolicyInfo_EffectiveDate_2", yyyy);

  await typeById(page, "AutoPriorPolicyInfo_Expiration", mm);
  await typeById(page, "AutoPriorPolicyInfo_Expiration_1", dd);
  await typeById(page, "AutoPriorPolicyInfo_Expiration_2", yyyy);

  await setSelectById(page, "Applicant_State", data.state || "NY");
  await setSelectById(page, "CurrentAddress_Ownership", "own");
  await setSelectById(page, "AutoPolicyInfo_PolicyTerm", "6");

  if (data.currentInsurer && data.currentInsurer !== "None") {
    await setSelectById(page, "AutoPriorPolicyInfo_PriorCarrier", data.currentInsurer);
  }

  await clickById(page, "PolicyInfo_CreditCheckAuth_Yes");
  await clickById(page, "Applicant_TermsAcceptance_Yes");
  await clickById(page, "Applicant_QuoteAccuracyAcceptance_Yes");

  await fillAllPossibleTextFields(page, data);
}

app.post("/get-quote", async (req, res) => {
  const data = req.body;

  let browser;

  console.log("Quote request:", data.firstName, data.lastName);

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    console.log("Step 1: Loading page...");
    await page.goto(QUOTE_URL, {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    await waitForText(page, "Getting Started", 30000);

    console.log("Step 1: Filling page...");
    await fillAllPossibleTextFields(page, data);

    await page.evaluate(() => {
      document.querySelectorAll("input[type='radio']").forEach((r) => {
        if (r.value === "No") r.click();
        if (r.value === "Auto") r.click();
      });
    });

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await page.waitForTimeout(2000);
    await stopIfValidationError(page, "Step 1");

    const driverReached = await waitForText(page, "Driver", 30000);
    if (!driverReached) {
      const txt = await pageText(page);
      console.log("Did not reach Driver page:");
      console.log(txt);
      throw new Error("Did not reach Driver page");
    }

    console.log("Step 1 done");

    console.log("Step 2: Filling driver...");
    await fillAllPossibleTextFields(page, data);

    await page.evaluate((d) => {
      const dob = String(d.dob || "01/01/1990").split("/");

      const inputs = Array.from(document.querySelectorAll("input[type='text']"));
      const dobInputs = inputs.filter((i) => {
        const k = String(i.id || i.name || "").toLowerCase();
        return k.includes("dob") || k.includes("birth");
      });

      if (dobInputs.length >= 3) {
        dobInputs[0].value = dob[0] || "01";
        dobInputs[1].value = dob[1] || "01";
        dobInputs[2].value = dob[2] || "1990";
        dobInputs.forEach((i) => {
          i.dispatchEvent(new Event("input", { bubbles: true }));
          i.dispatchEvent(new Event("change", { bubbles: true }));
          i.dispatchEvent(new Event("blur", { bubbles: true }));
        });
      }

      document.querySelectorAll("select").forEach((sel) => {
        const k = String(sel.id || sel.name || "").toLowerCase();

        if (k.includes("gender") && sel.options.length > 1) {
          sel.value = d.gender || sel.options[1].value;
        }

        if (k.includes("marital") && sel.options.length > 1) {
          sel.value = d.maritalStatus || sel.options[1].value;
        }

        if (k.includes("license") && sel.options.length > 1) {
          sel.value = d.state || sel.options[1].value;
        }

        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }, data);

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await page.waitForTimeout(2000);
    await stopIfValidationError(page, "Step 2 Driver");

    const driverSummary = await waitForText(page, "Driver Summary", 15000);
    if (driverSummary) {
      await clickSubmit(page);
      await page.waitForTimeout(2000);
      await stopIfValidationError(page, "Driver Summary");
    }

    const vehicleReached = await waitForText(page, "Vehicle", 30000);
    if (!vehicleReached) {
      const txt = await pageText(page);
      console.log("Did not reach Vehicle page:");
      console.log(txt);
      throw new Error("Did not reach Vehicle page");
    }

    console.log("Step 2 done");

    console.log("Step 3: Filling vehicle...");

    await page.evaluate((d) => {
      function selectMatch(sel, search) {
        const s = String(search || "").toLowerCase();
        for (const opt of sel.options) {
          if (
            String(opt.text).toLowerCase().includes(s) ||
            String(opt.value).toLowerCase().includes(s)
          ) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      document.querySelectorAll("select").forEach((sel) => {
        const k = String(sel.id || sel.name || "").toLowerCase();

        if (k.includes("year")) selectMatch(sel, d.vehicleYear);
      });
    }, data);

    await page.waitForTimeout(1500);

    await page.evaluate((d) => {
      function selectMatch(sel, search) {
        const s = String(search || "").toLowerCase();
        for (const opt of sel.options) {
          if (
            String(opt.text).toLowerCase().includes(s) ||
            String(opt.value).toLowerCase().includes(s)
          ) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      document.querySelectorAll("select").forEach((sel) => {
        const k = String(sel.id || sel.name || "").toLowerCase();

        if (k.includes("make")) selectMatch(sel, d.vehicleMake);
      });
    }, data);

    await page.waitForTimeout(1500);

    await page.evaluate((d) => {
      function selectMatch(sel, search) {
        const s = String(search || "").toLowerCase();
        for (const opt of sel.options) {
          if (
            String(opt.text).toLowerCase().includes(s) ||
            String(opt.value).toLowerCase().includes(s)
          ) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      document.querySelectorAll("select").forEach((sel) => {
        const k = String(sel.id || sel.name || "").toLowerCase();

        if (k.includes("model")) selectMatch(sel, d.vehicleModel);
        else if (k.includes("body") && sel.options.length > 1) sel.value = sel.options[1].value;
        else if (k.includes("inspect") && sel.options.length > 1) sel.value = sel.options[1].value;
        else if (sel.options.length > 1 && !sel.value) sel.value = sel.options[1].value;

        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });

      document.querySelectorAll("input[type='radio']").forEach((r) => {
        const v = String(r.value || "").toLowerCase();

        if (v.includes("own")) r.click();
        if (v.includes("pleasure")) r.click();
        if (v.includes("commute")) r.click();
        if (v.includes("full")) r.click();
        if (v === "no") r.click();
      });
    }, data);

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await page.waitForTimeout(2500);
    await stopIfValidationError(page, "Step 3 Vehicle");

    const vehicleSummary = await waitForText(page, "Vehicle Summary", 15000);
    if (vehicleSummary) {
      await clickSubmit(page);
      await page.waitForTimeout(2000);
      await stopIfValidationError(page, "Vehicle Summary");
    }

    const incidentReached = await waitForText(page, "Incident", 30000);
    if (!incidentReached) {
      const txt = await pageText(page);
      console.log("Did not reach Incident page:");
      console.log(txt);
      throw new Error("Did not reach Incident page");
    }

    console.log("Step 3 done");

    console.log("Step 4: Incidents...");
    await page.evaluate(() => {
      document.querySelectorAll("input[type='radio']").forEach((r) => {
        const v = String(r.value || "").toLowerCase();
        if (v === "no" || v.includes("none")) r.click();
      });
    });

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await page.waitForTimeout(2000);
    await stopIfValidationError(page, "Step 4 Incidents");

    const finalReached = await waitForText(page, "Almost Done", 30000);
    if (!finalReached) {
      const txt = await pageText(page);
      console.log("Did not reach Final page:");
      console.log(txt);
      throw new Error("Did not reach Final page");
    }

    console.log("Step 4 done");

    console.log("Step 5: Final page...");
    await page.waitForTimeout(1500);

    await fillFinalApplicantPage(page, data);

    const filled = await page.evaluate(() => ({
      firstName: document.getElementById("Applicant_FirstName")?.value,
      lastName: document.getElementById("Applicant_LastName")?.value,
      address: document.getElementById("Applicant_AddressLine1")?.value,
      city: document.getElementById("Applicant_City")?.value,
      state: document.getElementById("Applicant_State")?.value,
      zip: document.getElementById("Applicant_Zip")?.value,
      email: document.getElementById("Applicant_Email")?.value,
      credit: document.getElementById("PolicyInfo_CreditCheckAuth_Yes")?.checked,
      terms: document.getElementById("Applicant_TermsAcceptance_Yes")?.checked,
      accuracy: document.getElementById("Applicant_QuoteAccuracyAcceptance_Yes")?.checked
    }));

    console.log("Step 5 filled:", JSON.stringify(filled, null, 2));

    await page.waitForTimeout(1000);
    await clickSubmit(page);
    await page.waitForTimeout(3000);

    const txtAfterFinalSubmit = await pageText(page, 4000);

    if (
      txtAfterFinalSubmit.includes("Please correct the items") ||
      txtAfterFinalSubmit.includes("highlighted") ||
      txtAfterFinalSubmit.includes("Items marked with an asterisk")
    ) {
      console.log("FAILED BEFORE QUOTE SUMMARY:");
      console.log(txtAfterFinalSubmit);

      await browser.close();

      return res.status(200).json({
        success: false,
        message: "Final page still has missing required fields.",
        pageText: txtAfterFinalSubmit,
        quotes: []
      });
    }

    console.log("Step 5 submitted, waiting for Quote Summary...");

    const reachedQuoteSummary = await waitForText(page, "Quote Summary", 60000);

    if (!reachedQuoteSummary) {
      const txt = await pageText(page, 4000);

      console.log("FAILED BEFORE QUOTE SUMMARY:");
      console.log(txt);

      await browser.close();

      return res.status(200).json({
        success: false,
        message: "Did not reach Quote Summary.",
        pageText: txt,
        quotes: []
      });
    }

    console.log("REAL Quote Summary reached");

    let quotes = [];

    for (let attempt = 1; attempt <= 15; attempt++) {
      await page.waitForTimeout(5000);

      const sample = await pageText(page, 1000);
      console.log("Attempt " + attempt + " page sample:", sample.replace(/\n/g, " "));

      quotes = await page.evaluate(() => {
        const results = [];

        document.querySelectorAll("table tr").forEach((row) => {
          const img = row.querySelector("img");
          const cells = row.querySelectorAll("td");
          const text = row.innerText || "";
          const prices = text.match(/\$[\d,]+\.?\d*/g);

          if (cells.length >= 2 && prices && prices.length > 0) {
            const carrier = img ? img.alt : cells[0].innerText.trim().split("\n")[0];

            results.push({
              carrier: carrier.trim(),
              term: prices.length > 1 ? prices[0] + " total term" : "Auto",
              monthly: prices[prices.length - 1]
            });
          }
        });

        return results;
      });

      console.log("Attempt " + attempt + ": found " + quotes.length + " quotes");

      if (quotes.length > 0) break;

      const calculating = await page.evaluate(() =>
        document.body.innerText.toLowerCase().includes("calculating")
      );

      if (!calculating && attempt > 4) break;
    }

    await browser.close();

    if (quotes.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Reached Quote Summary, but no quote prices were found.",
        quotes: []
      });
    }

    return res.json({
      success: true,
      quotes
    });
  } catch (err) {
    console.error("ERROR:", err.message);

    if (browser) {
      await browser.close().catch(() => {});
    }

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
