const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:18765', viewport: { width: 1920, height: 1080 } },
  webServer: {
    command: 'python3 -m http.server 18765 --bind 127.0.0.1 --directory app',
    url: 'http://127.0.0.1:18765',
    reuseExistingServer: false
  }
});
