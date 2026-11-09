/* HomeStock verification suite (headless Firefox via playwright-core). */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await firefox.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const extRequests = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR: ' + e.message); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8142')) extRequests.push(r.url()); });

  await page.goto('http://127.0.0.1:8142/index.html');
  await page.waitForSelector('#dashAddBtn');
  await sleep(300);

  check('page title', (await page.title()) === 'HomeStock — Know What You Have');
  check('stats all zero at empty start',
    (await page.textContent('#statTotal')) === '0' &&
    (await page.textContent('#statLow')) === '0' &&
    (await page.textContent('#statOut')) === '0' &&
    (await page.textContent('#statShop')) === '0');
  check('dashboard empty note visible', await page.isVisible('#lowEmpty'));
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  check('items empty state visible', await page.isVisible('#itemEmpty'));
  await page.click('.sidebar [data-nav="dashboard"]');
  await sleep(200);

  async function addItem(name, category, qty, min, unit, location, notes) {
    await page.click('#addItemBtn');
    await page.waitForSelector('#itemDialog[open]');
    await page.fill('#fName', name);
    await page.selectOption('#fCategory', { label: category });
    await page.fill('#fQty', String(qty));
    await page.fill('#fMin', String(min));
    if (unit) {
      if (['pieces', 'bottles', 'packs', 'rolls', 'boxes'].includes(unit)) {
        await page.selectOption('#fUnit', unit);
      } else {
        await page.selectOption('#fUnit', 'custom');
        await page.fill('#fCustomUnit', unit);
      }
    }
    if (location) await page.fill('#fLocation', location);
    if (notes) await page.fill('#fNotes', notes);
    await page.click('#itemSave');
    await sleep(300);
  }

  // --- create + persist ---
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  await addItem('Shampoo', 'Bathroom', 3, 2, 'bottles', 'Bathroom cabinet', 'Unscented one');
  check('item appears in list', (await page.textContent('#itemList')).includes('Shampoo'));
  check('stat total 1, healthy', (await page.textContent('#statTotal')) === '1' &&
    (await page.textContent('#statLow')) === '0');
  check('item shows location and notes', (await page.textContent('#itemList')).includes('Bathroom cabinet'));
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  await sleep(300);
  check('item persists after reload', (await page.textContent('#itemList')).includes('Shampoo'));

  // --- steppers + thresholds ---
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  const incBtn = page.locator('[data-inc]').first();
  const decBtn = page.locator('[data-dec]').first();
  await incBtn.click(); await sleep(200);
  check('increment 3 -> 4', (await page.textContent('.stepper .qty')).includes('4'));
  await decBtn.click(); await decBtn.click(); await sleep(200);
  check('decrement 4 -> 2, low badge at qty == min',
    (await page.textContent('#itemList')).includes('Low stock') &&
    (await page.textContent('#statLow')) === '1');
  await decBtn.click(); await decBtn.click(); await sleep(200);
  check('decrement to 0, out of stock, dec disabled',
    (await page.textContent('#itemList')).includes('Out of stock') &&
    (await page.textContent('#statOut')) === '1' &&
    await page.locator('[data-dec]').first().isDisabled());
  check('quantity never goes negative (dec disabled at 0)', (await page.textContent('.stepper .qty')).includes('0'));

  // --- edit: min 0 disables low warning ---
  await page.click('[data-edit]');
  await page.waitForSelector('#itemDialog[open]');
  await page.fill('#fQty', '1');
  await page.fill('#fMin', '0');
  await page.click('#itemSave');
  await sleep(300);
  check('min 0 with qty 1 is healthy, not low',
    (await page.textContent('#itemList')).includes('Healthy') &&
    (await page.textContent('#statLow')) === '0');

  // --- search / filter / sort ---
  await addItem('Detergent', 'Laundry', 10, 2, 'packs');
  await addItem('Tissue', 'Bathroom', 5, 5, 'rolls');
  check('three items total', (await page.textContent('#statTotal')) === '3');
  await page.fill('#itemSearch', 'sham');
  await sleep(200);
  check('search narrows to Shampoo', (await page.textContent('#itemCount')).includes('1 of 3'));
  await page.fill('#itemSearch', '');
  await page.selectOption('#filterStatus', 'low');
  await sleep(200);
  check('filter low shows only Tissue (qty == min)',
    (await page.textContent('#itemList')).includes('Tissue') &&
    !(await page.textContent('#itemList')).includes('Shampoo'));
  await page.selectOption('#filterStatus', '');
  await page.selectOption('#sortBy', 'qty-asc');
  await sleep(200);
  const firstName = await page.locator('#itemList .item-name').first().textContent();
  check('sort qty ascending puts Shampoo (1) first', firstName === 'Shampoo');
  await page.selectOption('#sortBy', 'name');
  await sleep(200);

  // --- suggestions + shopping, duplicate prevention ---
  await page.click('.sidebar [data-nav="dashboard"]');
  await sleep(300);
  const sugText = await page.textContent('#suggestList');
  check('suggestion lists Tissue (qty 5, min 5)', sugText.includes('Tissue'));
  check('suggested qty for Tissue is max(1, 5-5+1)=1', sugText.includes('buy 1 rolls'));
  await page.locator('#suggestList [data-add-shop]').first().click();
  await sleep(300);
  check('suggested item added to shopping list', (await page.textContent('#statShop')) === '1');
  const sugAfter = await page.textContent('#suggestList');
  check('no duplicate suggestion once on list', !sugAfter.includes('Tissue'));
  check('dashboard shows Tissue on shopping list', (await page.textContent('#lowList')).includes('On shopping list'));

  // --- shopping: manual add, check, add-to-stock ---
  await page.click('.sidebar [data-nav="shopping"]');
  await sleep(200);
  await page.fill('#shopName', 'Dish soap');
  await page.fill('#shopQty', '2');
  await page.click('#manualShopForm button[type="submit"]');
  await sleep(300);
  check('manual shopping entry added', (await page.textContent('#shopList')).includes('Dish soap'));
  check('two unchecked entries', (await page.textContent('#statShop')) === '2');
  // check Tissue entry, then add purchased to stock
  const tissueRow = page.locator('#shopList li', { hasText: 'Tissue' });
  await tissueRow.locator('[data-check]').check();
  await sleep(300);
  check('add-to-stock action appears when a linked entry is checked', await page.isVisible('#shopActions'));
  check('checking does NOT change stock yet', (await page.textContent('#statTotal')) === '3');
  await page.click('#addPurchasedBtn');
  await page.waitForSelector('#confirmDialog[open]');
  check('confirm dialog lists the stock change', (await page.textContent('#confirmText')).includes('Tissue: +1 rolls'));
  await page.click('#confirmOk');
  await sleep(300);
  check('stock updated only after confirmation (Tissue 5 -> 6)',
    (await page.textContent('#statShop')) === '1');
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  const tissueQty = await page.locator('#itemList li', { hasText: 'Tissue' }).locator('.stepper .qty').textContent();
  check('Tissue quantity is now 6', tissueQty.includes('6'));
  check('Tissue no longer low', !(await page.locator('#itemList li', { hasText: 'Tissue' }).textContent()).includes('Low stock'));

  // --- shopping qty edit + clear checked ---
  await page.click('.sidebar [data-nav="shopping"]');
  await sleep(200);
  const soapRow = page.locator('#shopList li', { hasText: 'Dish soap' });
  await soapRow.locator('[data-shop-qty]').fill('5');
  await page.keyboard.press('Tab');
  await sleep(300);
  check('shopping quantity editable (2 -> 5)', (await soapRow.locator('[data-shop-qty]').inputValue()) === '5');
  await soapRow.locator('[data-check]').check();
  await sleep(200);
  await page.click('#clearCheckedBtn');
  await sleep(300);
  check('clear checked removes Dish soap', !(await page.textContent('#shopList')).includes('Dish soap'));
  check('shopping list empty again', (await page.textContent('#statShop')) === '0');

  // --- categories: rename + protected delete with reassign ---
  await page.click('.sidebar [data-nav="settings"]');
  await sleep(200);
  page.once('dialog', d => d.accept('Bath'));
  await page.locator('#catList li', { hasText: 'Bathroom' }).locator('[data-cat-rename]').click();
  await sleep(300);
  check('category renamed Bathroom -> Bath', (await page.textContent('#catList')).includes('Bath'));
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  check('item chip follows rename', (await page.textContent('#itemList')).includes('Bath'));
  await page.click('.sidebar [data-nav="settings"]');
  await sleep(200);
  await page.locator('#catList li', { hasText: 'Bath' }).locator('[data-cat-delete]').click();
  await page.waitForSelector('#confirmDialog[open]');
  check('protected delete offers reassign', await page.isVisible('#confirmReassignWrap'));
  await page.selectOption('#confirmReassign', { label: 'Kitchen' });
  await page.click('#confirmOk');
  await sleep(300);
  check('category deleted after reassign', !(await page.textContent('#catList')).includes('Bath'));
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  check('reassigned items now show Kitchen', (await page.textContent('#itemList')).includes('Kitchen'));

  // --- export, delete all (two steps), import restore ---
  await page.click('.sidebar [data-nav="settings"]');
  await sleep(200);
  const dl = page.waitForEvent('download');
  await page.click('#exportBtn');
  const download = await dl;
  const dlPath = '/tmp/homestock-backup-test.json';
  await download.saveAs(dlPath);
  const backupText = fs.readFileSync(dlPath, 'utf8');
  const backup = JSON.parse(backupText);
  check('export is versioned HomeStock JSON with 3 items',
    backup.app === 'homestock' && backup.version === 1 && backup.items.length === 3);
  await page.click('#deleteAllBtn');
  await page.waitForSelector('#confirmDialog[open]');
  check('delete-all step 1 asks to continue', (await page.textContent('#confirmOk')).includes('Continue'));
  await page.click('#confirmOk');
  await page.waitForSelector('#confirmDialog[open]');
  check('delete-all step 2 is the final warning', (await page.textContent('#confirmTitle')).includes('absolutely sure'));
  await page.click('#confirmOk');
  await sleep(400);
  check('all data deleted (0 items)', (await page.textContent('#statTotal')) === '0');
  await page.setInputFiles('#importFile', dlPath);
  await page.waitForSelector('#confirmDialog[open]');
  await page.click('#confirmOk');
  await sleep(400);
  check('import restores 3 items', (await page.textContent('#statTotal')) === '3');

  // --- invalid import rejected, data untouched ---
  fs.writeFileSync('/tmp/homestock-bad.json', '{"app":"homestock","version":1,"items":[{"id":"x"}]}');
  await page.setInputFiles('#importFile', '/tmp/homestock-bad.json');
  await sleep(400);
  check('malformed backup rejected, data unchanged',
    (await page.textContent('#statTotal')) === '3' &&
    (await page.textContent('#toastRegion')).toLowerCase().includes('rejected'));
  fs.writeFileSync('/tmp/homestock-notjson.json', 'this is not json{');
  await page.setInputFiles('#importFile', '/tmp/homestock-notjson.json');
  await sleep(400);
  check('non-JSON file rejected, data unchanged', (await page.textContent('#statTotal')) === '3');

  // --- theme persistence ---
  await page.selectOption('#themeSelect', 'dark');
  await sleep(200);
  await page.reload();
  await page.waitForSelector('#dashAddBtn');
  await sleep(300);
  check('dark theme persists after reload', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');
  await page.click('.sidebar [data-nav="settings"]');
  await page.selectOption('#themeSelect', 'light');
  await sleep(200);

  // --- XSS as text ---
  await page.click('.sidebar [data-nav="items"]');
  await sleep(200);
  await addItem('<img src=x onerror=alert(1)>', 'Kitchen', 1, 1, 'pieces');
  const itemHtml = await page.locator('#itemList').innerHTML();
  check('item name rendered as text, not HTML', !itemHtml.includes('<img src=x') && (await page.textContent('#itemList')).includes('<img src=x'));
  check('no uncaught page errors so far', errors.length === 0);

  // --- mobile layout ---
  await page.setViewportSize({ width: 375, height: 800 });
  await sleep(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('375px viewport has no horizontal overflow', !overflow);
  check('bottom nav visible on mobile', await page.isVisible('.bottom-nav'));

  // --- corrupt storage handling (fresh page, bad localStorage) ---
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto('http://127.0.0.1:8142/index.html');
  await p2.evaluate(() => localStorage.setItem('homestock-v1', '{corrupt'));
  await p2.reload();
  await p2.waitForSelector('#dashAddBtn');
  await sleep(400);
  check('corrupt stored data starts empty without crashing',
    (await p2.textContent('#statTotal')) === '0');
  check('corrupt storage warning shown', (await p2.textContent('#toastRegion')).toLowerCase().includes('could not be read'));
  const rawAfter = await p2.evaluate(() => localStorage.getItem('homestock-v1'));
  check('corrupt raw value left untouched in storage', rawAfter === '{corrupt');
  await ctx2.close();

  check('zero external requests', extRequests.length === 0, extRequests.join(', '));
  check('zero uncaught page errors', errors.length === 0, errors.join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR: ' + e.message); process.exit(2); });
