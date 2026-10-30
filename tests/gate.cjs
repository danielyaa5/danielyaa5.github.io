const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const siteBase = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const dashboardBase = (process.argv[3] || 'http://localhost:8098').replace(/\/$/, '');
const bridgeBase = (process.argv[4] || 'http://127.0.0.1:8798').replace(/\/$/, '');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 840 } });
    const dashPage = await context.newPage();

    // 1. Open M2 Gate Opener Dashboard and create a guest password.
    await dashPage.goto(`${dashboardBase}/gate-opener/`, { waitUntil: 'networkidle' });
    await dashPage.waitForSelector('#create-btn:not([disabled])');
    await dashPage.fill('#label-input', 'Jessie');
    await dashPage.fill('#password-input', 'jessie-visit-42');
    await dashPage.selectOption('#expiry-preset', '86400');
    await dashPage.click('#create-btn');

    await dashPage.waitForSelector('.pw-card');
    const cardText = await dashPage.textContent('.pw-card');
    assert.match(cardText, /Jessie/);
    assert.match(cardText, /jessie-visit-42/);
    assert.match(cardText, /Active/);

    // Check responsive widths on dashboard (1920 -> 320) for horizontal overflow.
    for (const width of [1920, 1280, 768, 414, 375, 320]) {
      await dashPage.setViewportSize({ width, height: 800 });
      const overflow = await dashPage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.equal(overflow, false, `Dashboard overflowed horizontally at ${width}px`);
    }

    // 2. Open the public guest page danielyakobian.com/gate
    const guestPage = await context.newPage();
    const guestUrl = `${siteBase}/gate/?bridge=${encodeURIComponent(bridgeBase)}`;
    await guestPage.goto(guestUrl, { waitUntil: 'networkidle' });

    // Try a wrong password first: verify password stays in the input box and error is shown.
    await guestPage.fill('#password-input', 'wrong-pass-00');
    await guestPage.click('#unlock-btn');
    await guestPage.waitForSelector('#alert-box:not([hidden])');
    assert.equal(await guestPage.inputValue('#password-input'), 'wrong-pass-00');
    assert.match(await guestPage.textContent('#alert-box'), /Incorrect password/i);

    // Now enter the valid password with "Save password" checked.
    await guestPage.fill('#password-input', 'jessie-visit-42');
    await guestPage.click('#unlock-btn');
    await guestPage.waitForSelector('#control-card:not([hidden])');

    assert.equal(await guestPage.textContent('#state-text'), 'Closed');
    assert.match(await guestPage.textContent('#pass-pill'), /Jessie/);
    const imgVisible = await guestPage.isVisible('#camera-image');
    assert.equal(imgVisible, true, 'Camera snapshot image should be visible to authenticated guest');

    // Check responsive widths on /gate/ (1920 -> 320).
    for (const width of [1920, 1280, 768, 414, 375, 320]) {
      await guestPage.setViewportSize({ width, height: 800 });
      const overflow = await guestPage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.equal(overflow, false, `Guest gate page overflowed horizontally at ${width}px`);
    }

    // Reload the guest page: verify saved password in localStorage auto-unlocks.
    await guestPage.reload({ waitUntil: 'networkidle' });
    await guestPage.waitForSelector('#control-card:not([hidden])');
    assert.equal(await guestPage.textContent('#state-text'), 'Closed');

    // Click Open Gate on the guest page.
    await guestPage.click('#open-gate-btn');
    await guestPage.waitForSelector('#alert-box:not([hidden])');
    assert.match(await guestPage.textContent('#alert-box'), /Gate signal accepted/i);

    // Refresh dashboard and confirm use count is now 1 and activity is logged.
    await dashPage.setViewportSize({ width: 1280, height: 800 });
    await dashPage.click('#refresh');
    await dashPage.waitForFunction(
      () => document.getElementById('total-opens')?.textContent === '1'
    );
    assert.match(await dashPage.textContent('.pw-card'), /Opened gate 1×/);

    // Revoke the password from the dashboard, then refresh the guest page.
    await dashPage.click('.pw-card button:has-text("Revoke")');
    await dashPage.waitForFunction(() =>
      document.querySelector('.pw-card .badge')?.textContent?.includes('Revoked')
    );

    await guestPage.click('#refresh-btn');
    await guestPage.waitForSelector('#auth-card:not([hidden])');
    assert.equal(await guestPage.inputValue('#password-input'), 'jessie-visit-42');
    assert.match(await guestPage.textContent('#alert-box'), /no longer active/i);

    console.log(JSON.stringify({ passed: true }));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
