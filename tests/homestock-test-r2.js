/* HomeStock round-2 checks (ChatGPT conditional approval):
   1. double-apply of purchased quantities to stock
   2. in-app recovery from corrupted localStorage (import + delete-all)
   3. rejection of structurally valid but internally inconsistent backups */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function validBackup() {
  return {
    app: 'homestock', version: 1, exportedAt: new Date().toISOString(),
    items: [{ id: 'item-1', name: 'Rice', category: 'cat-1', qty: 2, min: 1, unit: 'packs', location: '', notes: '', createdAt: 1 }],
    categories: [{ id: 'cat-1', name: 'Pantry' }],
    shopping: [],
    settings: { theme: 'light' }
  };
}

(async () => {
  const browser = await firefox.launch();

  // ---------- Check 1: double-apply ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8142/index.html');
    await page.waitForSelector('#dashAddBtn');
    await page.click('.sidebar [data-nav="items"]');
    await page.click('#addItemBtn');
    await page.waitForSelector('#itemDialog[open]');
    await page.fill('#fName', 'Shampoo');
    await page.selectOption('#fCategory', { label: 'Bathroom' });
    await page.fill('#fQty', '1');
    await page.fill('#fMin', '2');
    await page.click('#itemSave');
    await sleep(300);
    // suggestion qty = max(1, 2-1+1) = 2
    await page.click('.sidebar [data-nav="dashboard"]');
    await sleep(200);
    await page.locator('#suggestList [data-add-shop]').first().click();
    await sleep(300);
    await page.click('.sidebar [data-nav="shopping"]');
    await sleep(200);
    await page.locator('#shopList li', { hasText: 'Shampoo' }).locator('[data-check]').check();
    await sleep(200);
    await page.click('#addPurchasedBtn');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await sleep(300);
    await page.click('.sidebar [data-nav="items"]');
    await sleep(200);
    const qty = await page.locator('#itemList li', { hasText: 'Shampoo' }).locator('.stepper .qty').textContent();
    check('purchase applied exactly once (1 + 2 = 3, not 5)', qty.includes('3'));
    await page.click('.sidebar [data-nav="shopping"]');
    await sleep(200);
    check('processed entry removed from shopping list', !(await page.textContent('#shopList')).includes('Shampoo'));
    check('add-to-stock action hidden after processing (no second apply possible)',
      await page.isHidden('#shopActions'));
    check('no page errors in check 1', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Check 2a: corrupt storage -> recover by importing a valid backup ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8142/index.html');
    await page.waitForSelector('#dashAddBtn');
    await page.evaluate(() => localStorage.setItem('homestock-v1', '{corrupt'));
    await page.reload();
    await page.waitForSelector('#dashAddBtn');
    await sleep(300);
    check('corrupt state starts empty', (await page.textContent('#statTotal')) === '0');
    fs.writeFileSync('/tmp/homestock-good.json', JSON.stringify(validBackup()));
    await page.click('.sidebar [data-nav="settings"]');
    await sleep(200);
    await page.setInputFiles('#importFile', '/tmp/homestock-good.json');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await sleep(400);
    check('import from corrupt state restores data', (await page.textContent('#statTotal')) === '1');
    await page.reload();
    await page.waitForSelector('#dashAddBtn');
    await sleep(300);
    check('restored data persists after reload', (await page.textContent('#statTotal')) === '1');
    check('no page errors in check 2a', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Check 2b: corrupt storage -> recover by delete-all, then use normally ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8142/index.html');
    await page.waitForSelector('#dashAddBtn');
    await page.evaluate(() => localStorage.setItem('homestock-v1', '{corrupt'));
    await page.reload();
    await page.waitForSelector('#dashAddBtn');
    await sleep(300);
    await page.click('.sidebar [data-nav="settings"]');
    await page.click('#deleteAllBtn');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await page.waitForSelector('#confirmDialog[open]');
    await page.click('#confirmOk');
    await sleep(400);
    check('delete-all clears corrupt state', (await page.textContent('#statTotal')) === '0');
    await page.click('.sidebar [data-nav="items"]');
    await page.click('#addItemBtn');
    await page.waitForSelector('#itemDialog[open]');
    await page.fill('#fName', 'Soap');
    await page.click('#itemSave');
    await sleep(300);
    await page.reload();
    await page.waitForSelector('#dashAddBtn');
    await sleep(300);
    check('app saves normally after corrupt-state reset', (await page.textContent('#statTotal')) === '1');
    check('no page errors in check 2b', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------- Check 3: inconsistent backups rejected ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8142/index.html');
    await page.waitForSelector('#dashAddBtn');
    await page.click('.sidebar [data-nav="items"]');
    await page.click('#addItemBtn');
    await page.waitForSelector('#itemDialog[open]');
    await page.fill('#fName', 'KeepMe');
    await page.click('#itemSave');
    await sleep(300);
    check('baseline item present before bad imports', (await page.textContent('#statTotal')) === '1');
    await page.click('.sidebar [data-nav="settings"]');
    await sleep(200);

    async function tryBad(label, mutate) {
      const bad = validBackup();
      mutate(bad);
      const p = '/tmp/homestock-bad-' + label + '.json';
      fs.writeFileSync(p, JSON.stringify(bad));
      await page.setInputFiles('#importFile', p);
      await sleep(400);
      const total = await page.textContent('#statTotal');
      const toast = await page.textContent('#toastRegion');
      check('rejects ' + label + ', data unchanged',
        total === '1' && toast.toLowerCase().includes('rejected'));
    }
    await tryBad('dup-item-ids', b => {
      b.items.push({ id: 'item-1', name: 'Copy', category: 'cat-1', qty: 1, min: 1, unit: 'packs', location: '', notes: '', createdAt: 2 });
    });
    await tryBad('dup-category-ids', b => {
      b.categories.push({ id: 'cat-1', name: 'Other' });
    });
    await tryBad('dup-shopping-ids', b => {
      b.shopping.push(
        { id: 's-1', itemId: 'item-1', name: 'Rice', qty: 1, unit: 'packs', checked: false },
        { id: 's-1', itemId: 'item-1', name: 'Rice', qty: 1, unit: 'packs', checked: false });
    });
    await tryBad('dangling-category', b => {
      b.items[0].category = 'no-such-category';
    });
    await tryBad('dangling-shopping-link', b => {
      b.shopping.push({ id: 's-1', itemId: 'no-such-item', name: 'Ghost', qty: 1, unit: 'packs', checked: false });
    });
    await tryBad('negative-qty', b => { b.items[0].qty = -3; });
    await tryBad('negative-min', b => { b.items[0].min = -1; });
    await tryBad('zero-shopping-qty', b => {
      b.shopping.push({ id: 's-1', itemId: 'item-1', name: 'Rice', qty: 0, unit: 'packs', checked: false });
    });
    await tryBad('unsafe-qty', b => { b.items[0].qty = 9007199254740993; });
    await tryBad('fractional-qty', b => { b.items[0].qty = 2.5; });
    check('original item still intact after all rejections',
      (await page.textContent('#statTotal')) === '1');
    check('no page errors in check 3', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR: ' + e.message); process.exit(2); });
