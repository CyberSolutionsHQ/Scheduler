const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const baseUrl = process.env.BASE_URL || "http://localhost:5173";
const pagesToCheck = [
  { name: "index", path: "/index.html" },
  { name: "login", path: "/login.html" },
  { name: "dashboard", path: "/dashboard.html" },
  { name: "employees", path: "/employees.html" },
  { name: "schedule", path: "/schedule.html" },
  { name: "my_shifts", path: "/my-shifts.html" },
];

const results = {
  baseUrl,
  pages: {},
  runtimeConfigRequests: [],
  network: [],
  console: [],
  pageErrors: [],
  localStorageKeys: [],
  screenshots: [],
};

function recordNetwork(response, pageName) {
  try {
    const url = new URL(response.url());
    const pathname = url.pathname;
    const method = response.request().method();
    const status = response.status();
    results.network.push({ page: pageName, method, path: pathname, status });

    if (pathname.endsWith("/runtime-config.js") || pathname === "/runtime-config.js") {
      results.runtimeConfigRequests.push({ page: pageName, status });
    }
  } catch (err) {
    results.pageErrors.push({ page: pageName, message: String(err.message || err) });
  }
}

(async () => {
  const candidateExecutable = process.env.CHROME_PATH || "/usr/bin/chromium";
  const executablePath = fs.existsSync(candidateExecutable) ? candidateExecutable : undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
  const context = await browser.newContext();

  for (const entry of pagesToCheck) {
    const page = await context.newPage();
    const pageName = entry.name;
    results.pages[pageName] = { url: `${baseUrl}${entry.path}`, configErrorVisible: false };

    page.on("console", (msg) => {
      results.console.push({ page: pageName, level: msg.type(), message: msg.text() });
    });

    page.on("pageerror", (err) => {
      results.pageErrors.push({ page: pageName, message: String(err.message || err) });
    });

    page.on("response", (response) => recordNetwork(response, pageName));

    try {
      await page.goto(results.pages[pageName].url, { waitUntil: "domcontentloaded", timeout: 20000 });

      const configError = await page.$("#runtimeConfigError");
      results.pages[pageName].configErrorVisible = Boolean(configError);

      const localKeys = await page.evaluate(() => Object.keys(localStorage || {}));
      for (const key of localKeys) {
        if (!results.localStorageKeys.includes(key)) results.localStorageKeys.push(key);
      }

      if (!results.pages[pageName].configErrorVisible) {
        const screenshotPath = path.join("context_logs", "artifacts", `no-config-error-${pageName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        results.screenshots.push(screenshotPath);
      }
    } catch (err) {
      results.pageErrors.push({ page: pageName, message: String(err.message || err) });
      const screenshotPath = path.join("context_logs", "artifacts", `error-${pageName}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        results.screenshots.push(screenshotPath);
      } catch {
        // ignore screenshot failures
      }
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const outputPath = path.join("context_logs", "artifacts", "playwright_results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
})();
