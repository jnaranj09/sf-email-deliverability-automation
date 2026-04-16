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

const DOMAIN_FILTER_IFRAME_TITLE = 'Email Domain Filter';
const DOMAIN_FILTER_ROW_SELECTOR = 'table.list tr.dataRow';
const DOMAIN_FILTER_DELETE_LINK_SELECTOR = 'a.actionLink[title^="Delete"]';
const DOMAIN_FILTER_PURGE_MAX_ITERATIONS = 50;

// Configure CLI
program
  .name('enable-email-deliverability')
  .description('Automate Salesforce email deliverability settings')
  .requiredOption('--sandbox-url <url>', 'Authenticated Salesforce sandbox URL')
  .option('--headed', 'Run browser in headed mode (for debugging)', false)
  .option('--purge-domain-filters', 'Delete all Email Domain Filter rows after the deliverability save (destructive, opt-in)', false)
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

// Build a Salesforce setup URL by appending a `retURL` param to the authenticated frontdoor.jsp URL
function buildSetupUrl(sandboxUrl, setupPath) {
  const url = new URL(sandboxUrl);
  url.searchParams.set('retURL', setupPath);
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

// Purge all Email Domain Filter rows. Registers a page-level dialog handler (accepts the native `confirm()` on Del),
// then clicks the first row's delete link, waits for the list to reload with a lower count, repeats until empty.
async function purgeEmailDomainFilters(page) {
  log.info('Navigating to Email Domain Filter page for purge...');

  const url = buildSetupUrl(options.sandboxUrl, '/lightning/setup/EmailDomainFilter/home');

  await withRetry(async () => {
    await page.goto(url);
    await page.waitForURL('**/lightning/setup/EmailDomainFilter/home');
    await page.locator(`iframe[title*="${DOMAIN_FILTER_IFRAME_TITLE}"]`).waitFor({ state: 'attached' });
  }, options.retries);

  log.success('Email Domain Filter page loaded');

  const frame = page.frameLocator(`iframe[title*="${DOMAIN_FILTER_IFRAME_TITLE}"]`);
  await frame.locator('table.list').waitFor({ state: 'attached' });

  const rowLocator = frame.locator(DOMAIN_FILTER_ROW_SELECTOR);
  const initialCount = await rowLocator.count();

  if (initialCount === 0) {
    log.info('Email Domain Filter list is empty — nothing to delete');
    return 0;
  }

  log.info(`Found ${initialCount} Email Domain Filter row(s) to purge`);

  const dialogHandler = (dialog) => { dialog.accept().catch(() => {}); };
  page.on('dialog', dialogHandler);

  let deleted = 0;
  try {
    for (let iteration = 0; iteration < DOMAIN_FILTER_PURGE_MAX_ITERATIONS; iteration++) {
      const before = await rowLocator.count();
      if (before === 0) break;

      log.info(`Deleting row ${deleted + 1} of ${initialCount} (${before} remaining)...`);
      await frame.locator(DOMAIN_FILTER_DELETE_LINK_SELECTOR).first().click();

      // Delete navigates through deleteredirect.jsp then back to the list page (inside the iframe).
      // Main-page URL doesn't change — we wait for the row count to settle at exactly before-1,
      // not merely "less than", to tolerate transient 0-reads during iframe detach/re-attach.
      const target = before - 1;
      const deadline = Date.now() + options.timeout;
      let after = before;
      while (Date.now() < deadline) {
        try { after = await rowLocator.count(); } catch { after = before; }
        if (after === target) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (after !== target) {
        throw new Error(`Row count did not settle at ${target} after delete click (was ${before}, last observed ${after}); deleted ${deleted} row(s) so far`);
      }
      deleted++;
    }

    const finalCount = await rowLocator.count();
    if (finalCount > 0) {
      throw new Error(`Email Domain Filter purge exceeded safety cap of ${DOMAIN_FILTER_PURGE_MAX_ITERATIONS} iterations; deleted ${deleted} row(s), ${finalCount} still remain`);
    }

    log.success(`Deleted ${deleted} Email Domain Filter row(s)`);
    return deleted;
  } finally {
    page.off('dialog', dialogHandler);
  }
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
    const deliverabilityUrl = buildSetupUrl(options.sandboxUrl, '/lightning/setup/OrgEmailSettings/home');

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
    const substituteDomainCheckboxSelector = '#thePage\\:theForm\\:editBlock\\:spfSection\\:substituteEmailDomain\\:cbSubstituteEmailDomain';
    const saveButtonSelector = '#thePage\\:theForm\\:editBlock\\:buttons\\:saveBtn';
    const successMessageSelector = '#thePage\\:theForm\\:successMessagePanel';

    // Wait for the deliverability dropdown inside the iframe
    await deliverabilityFrame.locator(dropdownSelector).waitFor({ state: 'visible' });

    // Task 5: Change deliverability setting to "All email"
    log.info('Changing email deliverability setting to "All email"...');

    await deliverabilityFrame.locator(dropdownSelector).selectOption(EMAIL_DELIVERABILITY.ALL_EMAIL);

    log.success('Deliverability setting changed to "All email"');

    const substituteDomainCheckbox = deliverabilityFrame.locator(substituteDomainCheckboxSelector);
    await substituteDomainCheckbox.waitFor({ state: 'visible' });
    if (await substituteDomainCheckbox.isChecked()) {
      log.info('SPF substitute-domain checkbox already checked');
    } else {
      log.info('SPF substitute-domain checkbox was unchecked — checking it now');
      await substituteDomainCheckbox.check();
    }

    // Task 6: Save configuration and verify success
    log.info('Saving configuration...');

    await deliverabilityFrame.locator(saveButtonSelector).click();

    log.info('Save button clicked, waiting for confirmation...');

    // Wait for success message panel to appear (locale-independent check)
    await deliverabilityFrame.locator(successMessageSelector).waitFor({ state: 'visible' });

    log.success('Configuration saved successfully!');

    if (options.purgeDomainFilters) {
      await purgeEmailDomainFilters(page);
    } else {
      log.info('Email Domain Filter purge skipped (--purge-domain-filters not set)');
    }

    const endTime = Date.now();
    const executionTime = ((endTime - startTime) / 1000).toFixed(2);
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
