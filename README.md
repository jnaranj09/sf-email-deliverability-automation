# Salesforce Email Deliverability Automation

A Node.js CLI tool that automates changing email deliverability settings to "All email" in Salesforce sandboxes using Playwright.

## Problem

DevOps teams managing Salesforce developer sandboxes must manually change email deliverability settings every time a new sandbox is created. This repetitive task consumes valuable time and creates bottlenecks in development workflows.

## Solution

This script automates the entire process - navigate to settings, change the configuration, and save - all without manual intervention.

## Requirements

- **Node.js** 16.x or higher
- **Authenticated Salesforce sandbox URL** (pre-authenticated frontdoor.jsp URL)

## Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g sf-email-deliverability-automation
```

Then install Playwright browsers:

```bash
npx playwright install chromium
```

### Option 2: Install from source

1. Clone the repository:

```bash
git clone https://github.com/jnaranj09/sf-email-deliverability-automation.git
cd sf-email-deliverability-automation
```

2. Install dependencies:

```bash
npm install
```

3. Install Playwright browsers:

```bash
npx playwright install chromium
```

## Usage

### If installed globally via npm

```bash
sf-email-deliverability --sandbox-url "https://your-sandbox.salesforce.com/secur/frontdoor.jsp?params..."
```

### If installed from source

```bash
node enable-email-deliverability.js --sandbox-url "https://your-sandbox.salesforce.com/secur/frontdoor.jsp?params..."
```

### Debugging Mode (Headed Browser)

To see the browser in action for debugging:

```bash
# Global install
sf-email-deliverability --sandbox-url "https://your-sandbox.salesforce.com/secur/frontdoor.jsp?params..." --headed

# From source
node enable-email-deliverability.js --sandbox-url "https://your-sandbox.salesforce.com/secur/frontdoor.jsp?params..." --headed
```

### Help

```bash
sf-email-deliverability --help
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--sandbox-url <url>` | Yes | - | Authenticated Salesforce sandbox URL (frontdoor.jsp format) |
| `--headed` | No | `false` | Run browser in headed mode for visual debugging |
| `--timeout <ms>` | No | `60000` | Timeout in milliseconds for page operations |
| `--retries <count>` | No | `5` | Number of retry attempts on failure |
| `-h, --help` | No | - | Display help information |

## Example

```bash
sf-email-deliverability \
  --sandbox-url "https://mycompany--dev1.sandbox.my.salesforce.com/secur/frontdoor.jsp?sid=00D..."
```

## Output

The script provides detailed logging throughout execution:

```
[INFO] Starting Salesforce email deliverability automation
[INFO] Target URL: https://your-sandbox.salesforce.com/...
[INFO] Mode: Headless
[INFO] Timestamp: 2025-12-04T12:34:56.789Z
[INFO] Launching Chromium browser...
[SUCCESS] Browser initialized
[INFO] Navigating to email deliverability settings...
[INFO] Page loaded, waiting for redirect to complete...
[SUCCESS] Email deliverability page loaded successfully
[INFO] Changing email deliverability setting to "All email"...
[SUCCESS] Deliverability setting changed to "All email"
[INFO] Saving configuration...
[INFO] Save button clicked, waiting for confirmation...
[SUCCESS] Configuration saved successfully!
[SUCCESS] Success message: "Your organization's email settings have been saved."
[SUCCESS] Total execution time: 6.42 seconds
[SUCCESS] Timestamp: 2025-12-04T12:35:03.211Z
[INFO] Browser closed
```

## Performance

- **Expected execution time:** 10-30 seconds (depends on Salesforce auth redirects)
- **Default timeout:** 60 seconds
- **Default retries:** 5 (with exponential backoff)
- **Browser:** Chromium (headless)

## Error Handling

The script includes comprehensive error handling:

- **Missing URL:** Exits with error and displays usage instructions
- **Timeout errors:** Provides actionable troubleshooting steps
- **Network issues:** Catches and logs connection problems
- **Browser cleanup:** Ensures browser closes on success or failure
- **Exit codes:** Returns 0 on success, non-zero on failure (CI/CD compatible)

## Troubleshooting

### Timeout Errors

If you encounter timeout errors:

1. **Verify URL is valid and authenticated**
   - Ensure the frontdoor.jsp URL is fresh and not expired
   - Test the URL in a browser first

2. **Check network connectivity**
   - Ensure you can reach the Salesforce sandbox
   - Check for firewall or proxy issues

3. **Run in headed mode to see what's happening**
   ```bash
   node enable-email-deliverability.js --sandbox-url "your-url" --headed
   ```

4. **Check Salesforce page structure**
   - If Salesforce updated their UI, element selectors may need updating

### "Command not found" Error

Make sure you're in the project directory and have installed dependencies:

```bash
cd sf-email-deliverability-automation
npm install
```

### Browser Installation Issues

If Playwright browsers aren't installing correctly:

```bash
npx playwright install-deps chromium
npx playwright install chromium
```

## Technical Details

### How It Works

1. **Direct Navigation:** Uses URL parameter to navigate directly to email deliverability page
   - Appends `retURL=/lightning/setup/OrgEmailSettings/home` to sandbox URL
   - Eliminates need for UI clicking (gear icon → setup → search → etc.)

2. **Auth Redirect Handling:** Waits for Salesforce's multi-step authentication
   - Uses `waitForURL()` to wait until the final destination is reached
   - Handles frontdoor.jsp → SSO → Lightning redirects automatically

3. **Iframe Detection:** The deliverability settings are in a Classic iframe embedded in Lightning
   - Waits for iframe with title containing "Deliverability" to appear
   - Uses partial title match to handle different Salesforce editions

4. **Stable Element Selectors:** Uses Salesforce's stable HTML element IDs inside the iframe
   - Dropdown: `#thePage:theForm:editBlock:sendEmailAccessControlSection:sendEmailAccessControl:sendEmailAccessControlSelect`
   - Save button: `#thePage:theForm:editBlock:buttons:saveBtn`
   - Success message: `#thePage:theForm:successMessagePanel`

5. **Retry with Exponential Backoff:** Custom retry wrapper for flaky operations
   - Retries failed operations up to 5 times by default
   - Doubles delay between retries (1s → 2s → 4s → 8s → 16s)

### Architecture

- **Runtime:** Node.js (vanilla JavaScript)
- **Browser Automation:** Playwright (Chromium)
- **CLI Parsing:** Commander.js
- **DOM Strategy:** Stable element IDs (no Shadow DOM on this page)

## CI/CD Integration

The script is designed for CI/CD pipelines:

- **Exit codes:** 0 = success, non-zero = failure
- **Clear logging:** Structured output for log aggregation
- **Fast execution:** <15 second timeout
- **Headless by default:** No GUI required

### Example Shell Script Wrapper

```bash
#!/bin/bash
SANDBOX_URL="$1"

if [ -z "$SANDBOX_URL" ]; then
  echo "Usage: $0 <sandbox-url>"
  exit 1
fi

sf-email-deliverability --sandbox-url "$SANDBOX_URL"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Email deliverability enabled successfully"
else
  echo "Failed to enable email deliverability"
fi

exit $EXIT_CODE
```

## Future Enhancements

Potential improvements (not in current scope):

- Batch processing for multiple sandboxes
- Configuration file support
- Dry-run mode
- Integration with CI/CD platforms (Jenkins, GitHub Actions)
- Telemetry and metrics collection
- Screenshot capture on failure

## License

ISC

## Support

For issues or questions, please [open an issue](https://github.com/jnaranj09/sf-email-deliverability-automation/issues) on GitHub.
