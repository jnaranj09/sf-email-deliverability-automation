#!/usr/bin/env node

const { chromium } = require('playwright');
const { program } = require('commander');

// Constants for Salesforce email deliverability dropdown values
const EMAIL_DELIVERABILITY = {
  NO_ACCESS: '0',
  SYSTEM_ONLY: '1',
  ALL_EMAIL: '2'
};

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 5;

// Configure CLI
program
  .name('enable-email-deliverability')
  .description('Automate Salesforce email deliverability settings')
  .requiredOption('--sandbox-url <url>', 'Authenticated Salesforce sandbox URL')
  .option('--headed', 'Run browser in headed mode (for debugging)', false)
  .option('--timeout <ms>', 'Timeout in milliseconds for page operations', parseInt, DEFAULT_TIMEOUT_MS)
  .option('--retries <count>', 'Number of retry attempts on failure', parseInt, DEFAULT_RETRIES)
  .helpOption('-h, --help', 'Display help information')
  .parse();

const options = program.opts();

// Log helper with prefix
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Redact URL to show only hostname (prevents token leakage in logs)
function redactUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.origin;
  } catch {
    return '[invalid URL]';
  }
}

// Build deliverability page URL with proper query param handling
function buildDeliverabilityUrl(sandboxUrl) {
  const url = new URL(sandboxUrl);
  url.searchParams.set('retURL', '/lightning/setup/OrgEmailSettings/home');
  return url.toString();
}

// Retry wrapper for flaky operations
async function withRetry(fn, retries, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        log.info(`Attempt ${attempt} failed, retrying in ${delayMs}ms... (${retries - attempt + 1} retries left)`);
        log.info(`${error}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      }
    }
  }
  throw lastError;
}

// Main automation function
async function enableEmailDeliverability() {
  const startTime = Date.now();
  let browser;

  try {
    log.info(`Starting Salesforce email deliverability automation`);
    log.info(`Target: ${redactUrl(options.sandboxUrl)}`);
    log.info(`Mode: ${options.headed ? 'Headed' : 'Headless'}`);
    log.info(`Timeout: ${options.timeout}ms | Retries: ${options.retries}`);
    log.info(`Timestamp: ${new Date().toISOString()}`);

    // Task 3: Set up Playwright browser context
    log.info('Launching Chromium browser...');
    browser = await chromium.launch({
      headless: !options.headed,
      timeout: options.timeout
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Set default timeout for page actions
    page.setDefaultTimeout(options.timeout);

    log.success('Browser initialized');

    // Task 4: Navigate directly to email deliverability page
    log.info('Navigating to email deliverability settings...');
    const deliverabilityUrl = buildDeliverabilityUrl(options.sandboxUrl);

    await withRetry(async () => {
      await page.goto(deliverabilityUrl);

      // Wait for final destination after all auth redirects
      await page.waitForURL('**/lightning/setup/OrgEmailSettings/home');

      // Wait for the deliverability iframe to appear
      await page.locator('iframe[title*="Deliverability"]').waitFor({ state: 'attached' });
    }, options.retries);

    log.success('Email deliverability page loaded');

    // Frame locator for the Salesforce Classic iframe embedded in Lightning
    const deliverabilityFrame = page.frameLocator('iframe[title*="Deliverability"]');
    const dropdownSelector = '#thePage\\:theForm\\:editBlock\\:sendEmailAccessControlSection\\:sendEmailAccessControl\\:sendEmailAccessControlSelect';

    // Wait for the deliverability dropdown inside the iframe
    await deliverabilityFrame.locator(dropdownSelector).waitFor({ state: 'visible' });

    // Task 5: Change deliverability setting to "All email"
    log.info('Changing email deliverability setting to "All email"...');

    await deliverabilityFrame.locator(dropdownSelector).selectOption(EMAIL_DELIVERABILITY.ALL_EMAIL);

    log.success('Deliverability setting changed to "All email"');

    // Task 6: Save configuration and verify success
    log.info('Saving configuration...');

    const saveButtonSelector = '#thePage\\:theForm\\:editBlock\\:buttons\\:saveBtn';
    await deliverabilityFrame.locator(saveButtonSelector).click();

    log.info('Save button clicked, waiting for confirmation...');

    // Wait for success message panel to appear (locale-independent check)
    const successMessageSelector = '#thePage\\:theForm\\:successMessagePanel';
    await deliverabilityFrame.locator(successMessageSelector).waitFor({ state: 'visible' });

    const endTime = Date.now();
    const executionTime = ((endTime - startTime) / 1000).toFixed(2);

    log.success('Configuration saved successfully!');
    log.success(`Total execution time: ${executionTime} seconds`);
    log.success(`Timestamp: ${new Date().toISOString()}`);

    // Close browser
    await browser.close();
    log.info('Browser closed');

    process.exit(0);

  } catch (error) {
    // Task 7: Implement error handling
    const endTime = Date.now();
    const executionTime = ((endTime - startTime) / 1000).toFixed(2);

    log.error('Automation failed');
    log.error(`Error: ${error.message}`);
    log.error(`Execution time before failure: ${executionTime} seconds`);

    if (error.message.includes('Timeout')) {
      log.error('This appears to be a timeout error. Possible causes:');
      log.error('  - Invalid or expired sandbox URL');
      log.error('  - Network connectivity issues');
      log.error('  - Salesforce page structure changed');
      log.error(`  - Page took longer than ${options.timeout}ms to load`);
      log.error('Tip: Try running with --headed flag or increase --timeout');
    }

    // Task 8: Ensure browser cleanup on failure
    if (browser) {
      await browser.close();
      log.info('Browser closed');
    }

    process.exit(1);
  }
}

// Execute with proper error handling for unhandled rejections
enableEmailDeliverability().catch((error) => {
  console.error(`[FATAL] Unhandled error: ${error.message}`);
  process.exit(1);
});
