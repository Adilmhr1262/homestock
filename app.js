/* HomeStock — household inventory. Vanilla JS, localStorage only, no network.
   State shape (versioned): {app:'homestock', version:1, items, categories,
   shopping, settings:{theme}} */
'use strict';

var KEY = 'homestock-v1';
var UNITS = ['pieces', 'bottles', 'packs', 'rolls', 'boxes'];
var DEFAULT_CATEGORIES = ['Kitchen', 'Bathroom', 'Cleaning', 'Pantry', 'Laundry'];

var state = null;          // in-memory state
var storageCorrupt = false;
var storageUnavailable = false;
var editingItemId = null;
var confirmCb = null;
var deleteAllStep = 0;

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}
function esc(s) { return String(s == null ? '' : s); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function toast(msg) {
  var t = el('div', 'toast', msg);
  $('toastRegion').appendChild(t);
  setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
}
function intOrNull(v) {
  if (v === '' || v == null) return null;
  var n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n) return null;
  return n;
}

/* ---------- state ---------- */
function defaultState() {
  return {
    app: 'homestock', version: 1,
    items: [],
    categories: DEFAULT_CATEGORIES.map(function (name) { return { id: uid(), name: name }; }),
    shopping: [],
    settings: { theme: 'light' }
  };
}
function loadState() {
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { storageUnavailable = true; }
  if (!raw) return defaultState();
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || parsed.app !== 'homestock' || parsed.version !== 1 ||
        !Array.isArray(parsed.items) || !Array.isArray(parsed.categories) ||
        !Array.isArray(parsed.shopping) || !parsed.settings) throw new Error('bad shape');
    return parsed;
  } catch (e) {
    storageCorrupt = true;
    return defaultState();
  }
}
function saveState() {
  if (storageCorrupt) { toast('Stored data could not be read, so nothing was saved. Export a backup or delete all data in Settings to start clean.'); return false; }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    storageUnavailable = true;
    toast('Could not save: browser storage is unavailable.');
    return false;
  }
}
function wipeState() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  storageCorrupt = false;
  state = defaultState();
  applyTheme();
  renderAll();
}

/* ---------- stock rules ---------- */
function statusOf(item) {
  if (item.qty === 0) return 'out';
  if (item.min > 0 && item.qty <= item.min) return 'low';
  return 'healthy';
}
function statusLabel(s) {
  return s === 'out' ? 'Out of stock' : s === 'low' ? 'Low stock' : 'Healthy';
}
function suggestedQty(item) { return Math.max(1, item.min - item.qty + 1); }
function isSuggested(item) { return item.qty <= item.min; }
function linkedEntry(itemId) {
  return state.shopping.find(function (e) { return e.itemId === itemId; }) || null;
}
function categoryName(id) {
  var c = state.categories.find(function (x) { return x.id === id; });
  return c ? c.name : 'Uncategorized';
}

/* ---------- navigation ---------- */
var currentTab = 'dashboard';
function showTab(tab) {
  currentTab = tab;
  ['dashboard', 'items', 'shopping', 'settings'].forEach(function (t) {
    $('panel-' + t).hidden = t !== tab;
  });
  document.querySelectorAll('[data-nav]').forEach(function (b) {
    b.setAttribute('aria-current', b.getAttribute('data-nav') === tab ? 'page' : 'false');
  });
  if (tab === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-nav]').forEach(function (b) {
  b.addEventListener('click', function () { showTab(b.getAttribute('data-nav')); });
});

/* ---------- theme ---------- */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.settings.theme || 'light');
  $('themeSelect').value = state.settings.theme || 'light';
}
$('themeSelect').addEventListener('change', function () {
  state.settings.theme = $('themeSelect').value;
  applyTheme();
  saveState();
  toast('Theme saved.');
});

/* ---------- render: dashboard ---------- */
function renderDashboard() {
  var total = state.items.length;
  var low = state.items.filter(function (i) { return statusOf(i) === 'low'; });
  var out = state.items.filter(function (i) { return statusOf(i) === 'out'; });
  var toBuy = state.shopping.filter(function (e) { return !e.checked; }).length;
  $('statTotal').textContent = String(total);
  $('statLow').textContent = String(low.length);
  $('statOut').textContent = String(out.length);
  $('statShop').textContent = String(toBuy);

  var attention = state.items.filter(function (i) {
    var s = statusOf(i); return s === 'low' || s === 'out';
  }).sort(function (a, b) {
    var sa = statusOf(a), sb = statusOf(b);
    if (sa !== sb) return sa === 'out' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var lowList = $('lowList');
  lowList.textContent = '';
  $('lowEmpty').hidden = attention.length > 0;
  attention.forEach(function (item) {
    var li = el('li');
    var span = el('span', 'item-name', item.name + ' — ' + item.qty + ' ' + item.unit + ' left');
    li.appendChild(span);
    var badge = el('span', 'badge badge-' + statusOf(item), statusLabel(statusOf(item)));
    li.appendChild(badge);
    if (linkedEntry(item.id)) {
      var onList = el('span', 'muted small', 'On shopping list');
      li.appendChild(onList);
    } else {
      var btn = el('button', 'mini-btn', 'Add to shopping list');
      btn.type = 'button';
      btn.setAttribute('data-add-shop', item.id);
      li.appendChild(btn);
    }
    lowList.appendChild(li);
  });

  renderSuggestions($('suggestList'), $('suggestEmpty'));
}

/* ---------- render: suggestions (shared) ---------- */
function renderSuggestions(listEl, emptyEl) {
  var sug = state.items.filter(function (i) { return isSuggested(i) && !linkedEntry(i.id); })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  listEl.textContent = '';
  emptyEl.hidden = sug.length > 0;
  sug.forEach(function (item) {
    var li = el('li');
    li.appendChild(el('span', 'item-name', item.name));
    li.appendChild(el('span', 'muted small', 'have ' + item.qty + ' · min ' + item.min + ' · buy ' + suggestedQty(item) + ' ' + item.unit));
    var btn = el('button', 'mini-btn', 'Add ' + suggestedQty(item) + ' to list');
    btn.type = 'button';
    btn.setAttribute('data-add-shop', item.id);
    li.appendChild(btn);
    listEl.appendChild(li);
  });
}

/* ---------- render: items ---------- */
function getFilteredItems() {
  var q = $('itemSearch').value.trim().toLowerCase();
  var cat = $('filterCat').value;
  var st = $('filterStatus').value;
  var sort = $('sortBy').value;
  var list = state.items.filter(function (i) {
    if (q && i.name.toLowerCase().indexOf(q) === -1) return false;
    if (cat && i.category !== cat) return false;
    if (st && statusOf(i) !== st) return false;
    return true;
  });
  if (sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  else if (sort === 'qty-asc') list.sort(function (a, b) { return a.qty - b.qty || a.name.localeCompare(b.name); });
  else if (sort === 'qty-desc') list.sort(function (a, b) { return b.qty - a.qty || a.name.localeCompare(b.name); });
  return list;
}
function renderItems() {
  var catSel = $('filterCat');
  var prev = catSel.value;
  catSel.textContent = '';
  catSel.appendChild(el('option', null, 'All categories')).value = '';
  state.categories.forEach(function (c) {
    var o = el('option', null, c.name); o.value = c.id; catSel.appendChild(o);
  });
  catSel.value = prev;

  var list = getFilteredItems();
  $('itemCount').textContent = list.length + ' of ' + state.items.length + ' items shown';
  $('itemEmpty').style.display = state.items.length === 0 ? '' : 'none';
  var ul = $('itemList');
  ul.textContent = '';
  list.forEach(function (item) {
    var st = statusOf(item);
    var li = el('li', 'item-card');
    var top = el('div', 'item-top');
    top.appendChild(el('span', 'item-name', item.name));
    top.appendChild(el('span', 'chip', categoryName(item.category)));
    top.appendChild(el('span', 'badge badge-' + st, statusLabel(st)));
    li.appendChild(top);

    var meta = el('p', 'item-meta');
    meta.appendChild(document.createTextNode('Minimum to keep: ' + item.min + ' ' + item.unit));
    if (item.location) meta.appendChild(document.createTextNode(' · ' + item.location));
    if (item.notes) {
      var n = el('span', 'notes', item.notes);
      meta.appendChild(n);
    }
    li.appendChild(meta);

    var actions = el('div', 'item-actions');
    var stepper = el('div', 'stepper');
    var dec = el('button', null, '−');
    dec.type = 'button';
    dec.setAttribute('aria-label', 'Decrease quantity of ' + item.name);
    dec.setAttribute('data-dec', item.id);
    dec.disabled = item.qty === 0;
    var qty = el('span', 'qty');
    qty.appendChild(document.createTextNode(String(item.qty)));
    qty.appendChild(el('small', null, item.unit));
    var inc = el('button', null, '+');
    inc.type = 'button';
    inc.setAttribute('aria-label', 'Increase quantity of ' + item.name);
    inc.setAttribute('data-inc', item.id);
    stepper.appendChild(dec); stepper.appendChild(qty); stepper.appendChild(inc);
    actions.appendChild(stepper);

    var edit = el('button', 'mini-btn', 'Edit');
    edit.type = 'button'; edit.setAttribute('data-edit', item.id);
    var del = el('button', 'mini-btn danger', 'Delete');
    del.type = 'button'; del.setAttribute('data-delete', item.id);
    actions.appendChild(edit); actions.appendChild(del);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

/* ---------- render: shopping ---------- */
function renderShopping() {
  var unchecked = state.shopping.filter(function (e) { return !e.checked; }).length;
  [['shopBadge', unchecked], ['shopBadgeMobile', unchecked]].forEach(function (pair) {
    var b = $(pair[0]);
    b.hidden = pair[1] === 0;
    b.textContent = String(pair[1]);
  });
  renderSuggestions($('shopSuggestList'), $('shopSuggestEmpty'));

  var ul = $('shopList');
  ul.textContent = '';
  $('shopEmpty').style.display = state.shopping.length === 0 ? '' : 'none';
  state.shopping.forEach(function (entry) {
    var li = el('li');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'check';
    cb.checked = entry.checked;
    cb.setAttribute('aria-label', 'Mark ' + entry.name + ' as purchased');
    cb.setAttribute('data-check', entry.id);
    li.appendChild(cb);
    li.appendChild(el('span', 'shop-name' + (entry.checked ? ' done' : ''), entry.name));
    var qtyInput = document.createElement('input');
    qtyInput.type = 'number'; qtyInput.min = '1'; qtyInput.step = '1';
    qtyInput.value = String(entry.qty);
    qtyInput.setAttribute('aria-label', 'Quantity to buy for ' + entry.name);
    qtyInput.setAttribute('data-shop-qty', entry.id);
    li.appendChild(qtyInput);
    li.appendChild(el('span', 'shop-qty', entry.unit + (entry.itemId ? ' · from stock list' : '')));
    var spacer = el('span', 'spacer');
    li.appendChild(spacer);
    var rm = el('button', 'mini-btn danger', 'Remove');
    rm.type = 'button'; rm.setAttribute('data-shop-remove', entry.id);
    li.appendChild(rm);
    ul.appendChild(li);
  });
  var hasCheckedLinked = state.shopping.some(function (e) { return e.checked && e.itemId; });
  var hasChecked = state.shopping.some(function (e) { return e.checked; });
  $('shopActions').hidden = !hasCheckedLinked;
  $('clearCheckedBtn').disabled = !hasChecked;
}

/* ---------- render: settings ---------- */
function renderSettings() {
  var ul = $('catList');
  ul.textContent = '';
  state.categories.forEach(function (cat) {
    var count = state.items.filter(function (i) { return i.category === cat.id; }).length;
    var li = el('li');
    li.appendChild(el('span', 'cat-name', cat.name));
    li.appendChild(el('span', 'cat-count', count + (count === 1 ? ' item' : ' items')));
    var rename = el('button', 'mini-btn', 'Rename');
    rename.type = 'button'; rename.setAttribute('data-cat-rename', cat.id);
    var del = el('button', 'mini-btn danger', 'Delete');
    del.type = 'button'; del.setAttribute('data-cat-delete', cat.id);
    li.appendChild(rename); li.appendChild(del);
    ul.appendChild(li);
  });
  var bytes = 0;
  try { bytes = (localStorage.getItem(KEY) || '').length; } catch (e) { bytes = 0; }
  $('storageInfo').textContent = 'Storage used: about ' + (bytes < 1024 ? bytes + ' bytes' : (bytes / 1024).toFixed(1) + ' KB') +
    ' in this browser (items: ' + state.items.length + ', shopping entries: ' + state.shopping.length + ').';
}

function renderAll() {
  renderDashboard();
  renderItems();
  renderShopping();
  renderSettings();
}

/* ---------- item dialog ---------- */
function fillCategorySelect(selectEl, selectedId) {
  selectEl.textContent = '';
  state.categories.forEach(function (c) {
    var o = el('option', null, c.name); o.value = c.id; selectEl.appendChild(o);
  });
  if (selectedId) selectEl.value = selectedId;
}
function openItemDialog(item) {
  editingItemId = item ? item.id : null;
  $('itemDialogTitle').textContent = item ? 'Edit item' : 'Add item';
  $('itemFormError').hidden = true;
  fillCategorySelect($('fCategory'), item ? item.category : null);
  $('fName').value = item ? item.name : '';
  $('fUnit').value = item ? (UNITS.indexOf(item.unit) === -1 ? 'custom' : item.unit) : 'pieces';
  $('customUnitWrap').hidden = $('fUnit').value !== 'custom';
  $('fCustomUnit').value = item && UNITS.indexOf(item.unit) === -1 ? item.unit : '';
  $('fQty').value = item ? String(item.qty) : '0';
  $('fMin').value = item ? String(item.min) : '1';
  $('fLocation').value = item ? (item.location || '') : '';
  $('fNotes').value = item ? (item.notes || '') : '';
  document.querySelector('.shell').inert = true;
  $('itemDialog').showModal();
  $('fName').focus();
}
function closeItemDialog() {
  if ($('itemDialog').open) $('itemDialog').close();
  document.querySelector('.shell').inert = false;
}
$('fUnit').addEventListener('change', function () {
  $('customUnitWrap').hidden = $('fUnit').value !== 'custom';
  if ($('fUnit').value === 'custom') $('fCustomUnit').focus();
});
$('itemCancel').addEventListener('click', closeItemDialog);
$('itemDialog').addEventListener('close', function () {
  if (!$('itemDialog').open) document.querySelector('.shell').inert = false;
});
$('itemForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var err = $('itemFormError');
  var name = $('fName').value.trim();
  var qty = intOrNull($('fQty').value);
  var min = intOrNull($('fMin').value);
  var unit = $('fUnit').value === 'custom' ? $('fCustomUnit').value.trim() : $('fUnit').value;
  function fail(msg) { err.textContent = msg; err.hidden = false; return; }
  if (!name) return fail('Give the item a name.');
  if (qty == null || qty < 0) return fail('Current quantity must be a whole number of 0 or more.');
  if (min == null || min < 0) return fail('Minimum must be a whole number of 0 or more.');
  if (!unit) return fail('Give the custom unit a name.');
  if (!state.categories.length) return fail('Add a category in Settings first.');
  var catId = $('fCategory').value;
  if (!state.categories.some(function (c) { return c.id === catId; })) return fail('Pick a category.');
  if (editingItemId) {
    var item = state.items.find(function (i) { return i.id === editingItemId; });
    if (!item) return fail('That item no longer exists.');
    item.name = name; item.category = catId; item.qty = qty; item.min = min;
    item.unit = unit; item.location = $('fLocation').value.trim(); item.notes = $('fNotes').value.trim();
    toast('Item updated.');
  } else {
    state.items.push({
      id: uid(), name: name, category: catId, qty: qty, min: min, unit: unit,
      location: $('fLocation').value.trim(), notes: $('fNotes').value.trim(), createdAt: Date.now()
    });
    toast('Item added.');
  }
  if (!saveState()) return;
  closeItemDialog();
  renderAll();
});
$('addItemBtn').addEventListener('click', function () { openItemDialog(null); });
$('dashAddBtn').addEventListener('click', function () { openItemDialog(null); });
document.querySelectorAll('[data-open-item]').forEach(function (b) {
  b.addEventListener('click', function () { openItemDialog(null); });
});

/* ---------- item list actions (delegation) ---------- */
$('itemList').addEventListener('click', function (e) {
  var t = e.target.closest('button');
  if (!t) return;
  var id = t.getAttribute('data-dec') || t.getAttribute('data-inc') ||
           t.getAttribute('data-edit') || t.getAttribute('data-delete');
  if (!id) return;
  var item = state.items.find(function (i) { return i.id === id; });
  if (!item) return;
  if (t.hasAttribute('data-dec')) {
    item.qty = Math.max(0, item.qty - 1);
    saveState(); renderAll();
  } else if (t.hasAttribute('data-inc')) {
    item.qty = item.qty + 1;
    saveState(); renderAll();
  } else if (t.hasAttribute('data-edit')) {
    openItemDialog(item);
  } else if (t.hasAttribute('data-delete')) {
    openConfirm({
      title: 'Delete item?',
      text: 'Delete "' + item.name + '"? This cannot be undone.',
      okLabel: 'Delete',
      onOk: function () {
        state.items = state.items.filter(function (i) { return i.id !== id; });
        saveState(); renderAll();
        toast('Item deleted.');
      }
    });
  }
});
['itemSearch', 'filterCat', 'filterStatus', 'sortBy'].forEach(function (id) {
  $(id).addEventListener('input', renderItems);
  $(id).addEventListener('change', renderItems);
});

/* ---------- shopping actions ---------- */
function addToShopping(item) {
  if (linkedEntry(item.id)) { toast('"' + item.name + '" is already on your shopping list.'); return; }
  state.shopping.push({
    id: uid(), itemId: item.id, name: item.name,
    qty: suggestedQty(item), unit: item.unit, checked: false
  });
  if (saveState()) { renderAll(); toast('"' + item.name + '" added to your shopping list.'); }
}
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-add-shop]');
  if (!t) return;
  var item = state.items.find(function (i) { return i.id === t.getAttribute('data-add-shop'); });
  if (item) addToShopping(item);
});
$('manualShopForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = $('shopName').value.trim();
  var qty = intOrNull($('shopQty').value);
  if (!name) { toast('Give the shopping entry a name.'); return; }
  if (qty == null || qty < 1) { toast('Quantity must be 1 or more.'); return; }
  state.shopping.push({
    id: uid(), itemId: null, name: name, qty: qty,
    unit: $('shopUnit').value, checked: false
  });
  $('shopName').value = '';
  $('shopQty').value = '1';
  if (saveState()) { renderAll(); toast('Added to your shopping list.'); }
});
$('shopList').addEventListener('change', function (e) {
  var t = e.target;
  if (t.hasAttribute('data-check')) {
    var entry = state.shopping.find(function (x) { return x.id === t.getAttribute('data-check'); });
    if (entry) { entry.checked = t.checked; saveState(); renderAll(); }
  } else if (t.hasAttribute('data-shop-qty')) {
    var entry2 = state.shopping.find(function (x) { return x.id === t.getAttribute('data-shop-qty'); });
    if (!entry2) return;
    var q = intOrNull(t.value);
    if (q == null || q < 1) { t.value = String(entry2.qty); toast('Quantity must be 1 or more.'); return; }
    entry2.qty = q;
    saveState(); renderAll();
  }
});
$('shopList').addEventListener('click', function (e) {
  var t = e.target.closest('[data-shop-remove]');
  if (!t) return;
  var id = t.getAttribute('data-shop-remove');
  var entry = state.shopping.find(function (x) { return x.id === id; });
  state.shopping = state.shopping.filter(function (x) { return x.id !== id; });
  saveState(); renderAll();
  if (entry) toast('Removed "' + entry.name + '" from the list.');
});
$('clearCheckedBtn').addEventListener('click', function () {
  var n = state.shopping.filter(function (e) { return e.checked; }).length;
  if (!n) return;
  state.shopping = state.shopping.filter(function (e) { return !e.checked; });
  saveState(); renderAll();
  toast(n + (n === 1 ? ' checked entry cleared.' : ' checked entries cleared.'));
});
$('addPurchasedBtn').addEventListener('click', function () {
  var checked = state.shopping.filter(function (e) { return e.checked; });
  var linked = checked.filter(function (e) { return e.itemId; });
  if (!linked.length) { toast('No checked entries are linked to your stock.'); return; }
  var lines = linked.map(function (e) {
    var item = state.items.find(function (i) { return i.id === e.itemId; });
    return item ? item.name + ': +' + e.qty + ' ' + e.unit : null;
  }).filter(Boolean);
  openConfirm({
    title: 'Add purchased quantities to stock?',
    text: 'This adds to your stock and removes these entries from the shopping list:\n' + lines.join('\n') +
      (checked.length > linked.length ? '\nChecked entries not linked to stock will just be removed from the list.' : ''),
    okLabel: 'Add to stock',
    onOk: function () {
      linked.forEach(function (e) {
        var item = state.items.find(function (i) { return i.id === e.itemId; });
        if (item) item.qty = item.qty + e.qty;
      });
      var ids = checked.map(function (e) { return e.id; });
      state.shopping = state.shopping.filter(function (e) { return ids.indexOf(e.id) === -1; });
      saveState(); renderAll();
      toast('Stock updated from your purchases.');
    }
  });
});

/* ---------- confirm dialog ---------- */
function openConfirm(opts) {
  $('confirmTitle').textContent = opts.title || 'Are you sure?';
  $('confirmText').textContent = opts.text || '';
  $('confirmOk').textContent = opts.okLabel || 'Delete';
  var wrap = $('confirmReassignWrap');
  if (opts.reassignOptions) {
    wrap.hidden = false;
    var sel = $('confirmReassign');
    sel.textContent = '';
    opts.reassignOptions.forEach(function (c) {
      var o = el('option', null, c.name); o.value = c.id; sel.appendChild(o);
    });
  } else {
    wrap.hidden = true;
  }
  confirmCb = opts.onOk;
  document.querySelector('.shell').inert = true;
  $('confirmDialog').showModal();
}
function closeConfirm() {
  if ($('confirmDialog').open) $('confirmDialog').close();
  document.querySelector('.shell').inert = false;
  confirmCb = null;
}
$('confirmCancel').addEventListener('click', closeConfirm);
$('confirmDialog').addEventListener('close', function () {
  /* The close event can fire after a nested confirm reopens the dialog;
     only release the background when the dialog is actually closed. */
  if (!$('confirmDialog').open) document.querySelector('.shell').inert = false;
});
$('confirmForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var cb = confirmCb;
  var reassignId = $('confirmReassignWrap').hidden ? null : $('confirmReassign').value;
  closeConfirm();
  if (cb) cb(reassignId);
});

/* ---------- categories ---------- */
$('catForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = $('catName').value.trim();
  if (!name) return;
  if (state.categories.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
    toast('A category with that name already exists.');
    return;
  }
  state.categories.push({ id: uid(), name: name });
  $('catName').value = '';
  if (saveState()) { renderAll(); toast('Category added.'); }
});
$('catList').addEventListener('click', function (e) {
  var t = e.target.closest('button');
  if (!t) return;
  var id = t.getAttribute('data-cat-rename') || t.getAttribute('data-cat-delete');
  var cat = state.categories.find(function (c) { return c.id === id; });
  if (!cat) return;
  if (t.hasAttribute('data-cat-rename')) {
    var next = window.prompt('Rename category "' + cat.name + '" to:', cat.name);
    if (next == null) return;
    next = next.trim();
    if (!next) { toast('Category name cannot be empty.'); return; }
    if (state.categories.some(function (c) { return c.id !== id && c.name.toLowerCase() === next.toLowerCase(); })) {
      toast('A category with that name already exists.');
      return;
    }
    cat.name = next;
    if (saveState()) { renderAll(); toast('Category renamed.'); }
  } else {
    var used = state.items.filter(function (i) { return i.category === id; }).length;
    if (state.categories.length === 1) { toast('You need at least one category.'); return; }
    if (used > 0) {
      var others = state.categories.filter(function (c) { return c.id !== id; });
      openConfirm({
        title: 'Delete category?',
        text: '"' + cat.name + '" is used by ' + used + (used === 1 ? ' item' : ' items') +
          '. Pick a category to move those items to, or cancel.',
        okLabel: 'Move items and delete',
        reassignOptions: others,
        onOk: function (reassignId) {
          state.items.forEach(function (i) { if (i.category === id) i.category = reassignId; });
          state.categories = state.categories.filter(function (c) { return c.id !== id; });
          if (saveState()) { renderAll(); toast('Category deleted; its items were moved.'); }
        }
      });
    } else {
      openConfirm({
        title: 'Delete category?',
        text: 'Delete the "' + cat.name + '" category? No items use it.',
        okLabel: 'Delete',
        onOk: function () {
          state.categories = state.categories.filter(function (c) { return c.id !== id; });
          if (saveState()) { renderAll(); toast('Category deleted.'); }
        }
      });
    }
  }
});

/* ---------- export / import ---------- */
function download(filename, text) {
  var blob = new Blob([text], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
$('exportBtn').addEventListener('click', function () {
  var stamp = new Date().toISOString().slice(0, 10);
  var copy = JSON.parse(JSON.stringify(state));
  copy.exportedAt = new Date().toISOString();
  download('homestock-backup-' + stamp + '.json', JSON.stringify(copy, null, 2));
  toast('Backup downloaded.');
});
$('importBtn').addEventListener('click', function () { $('importFile').click(); });
$('importFile').addEventListener('change', function () {
  var file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(String(reader.result)); } catch (e) {
      toast('That file is not valid JSON. Your data is unchanged.');
      return;
    }
    var err = validateBackup(parsed);
    if (err) { toast('Backup rejected: ' + err + ' Your data is unchanged.'); return; }
    openConfirm({
      title: 'Replace all data with this backup?',
      text: 'Backup from ' + (parsed.exportedAt || 'unknown date') + ': ' + parsed.items.length +
        ' items, ' + parsed.categories.length + ' categories, ' + parsed.shopping.length +
        ' shopping entries. Your current data will be replaced.',
      okLabel: 'Replace data',
      onOk: function () {
        state = parsed;
        storageCorrupt = false;
        applyTheme();
        if (saveState()) { renderAll(); toast('Backup restored.'); }
      }
    });
  };
  reader.readAsText(file);
});
function validateBackup(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  if (d.app !== 'homestock') return 'not a HomeStock backup';
  if (d.version !== 1) return 'unsupported backup version';
  if (!Array.isArray(d.items) || !Array.isArray(d.categories) ||
      !Array.isArray(d.shopping) || !d.settings || typeof d.settings !== 'object') return 'missing sections';
  var catIds = {};
  var seenCat = {};
  for (var i = 0; i < d.categories.length; i++) {
    var c = d.categories[i];
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim()) return 'bad category at position ' + (i + 1);
    if (seenCat[c.id]) return 'duplicate category id';
    seenCat[c.id] = true;
    catIds[c.id] = true;
  }
  if (!d.categories.length) return 'backup has no categories';
  var seenItem = {};
  var itemIds = {};
  for (var j = 0; j < d.items.length; j++) {
    var it = d.items[j];
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string' || !it.name.trim()) return 'bad item at position ' + (j + 1);
    if (seenItem[it.id]) return 'duplicate item id';
    seenItem[it.id] = true;
    itemIds[it.id] = true;
    if (!catIds[it.category]) return 'item "' + it.name + '" uses an unknown category';
    if (!Number.isSafeInteger(it.qty) || it.qty < 0 || !Number.isSafeInteger(it.min) || it.min < 0) return 'bad quantities for "' + it.name + '"';
    if (typeof it.unit !== 'string' || !it.unit.trim()) return 'bad unit for "' + it.name + '"';
  }
  var seenShop = {};
  for (var k = 0; k < d.shopping.length; k++) {
    var s = d.shopping[k];
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !s.name.trim()) return 'bad shopping entry at position ' + (k + 1);
    if (seenShop[s.id]) return 'duplicate shopping entry id';
    seenShop[s.id] = true;
    if (!Number.isSafeInteger(s.qty) || s.qty < 1) return 'bad quantity for shopping entry "' + s.name + '"';
    if (s.itemId != null && typeof s.itemId !== 'string') return 'bad link for shopping entry "' + s.name + '"';
    if (s.itemId != null && !itemIds[s.itemId]) return 'shopping entry "' + s.name + '" links to an unknown item';
    if (typeof s.checked !== 'boolean') return 'bad checked flag for "' + s.name + '"';
  }
  if (d.settings.theme !== 'light' && d.settings.theme !== 'dark') return 'bad theme setting';
  return null;
}

/* ---------- delete all (two steps) ---------- */
$('deleteAllBtn').addEventListener('click', function () {
  openConfirm({
    title: 'Delete all data?',
    text: 'This removes every item, category, shopping entry, and setting from this browser. Export a backup first if you want to keep a copy.',
    okLabel: 'Continue',
    onOk: function () {
      openConfirm({
        title: 'Are you absolutely sure?',
        text: 'This is the last step. All HomeStock data in this browser will be gone and cannot be undone.',
        okLabel: 'Yes, delete everything',
        onOk: function () {
          wipeState();
          toast('All data deleted. Starting fresh.');
        }
      });
    }
  });
});

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* offline support optional */ });
  });
}
state = loadState();
applyTheme();
renderAll();
if (storageCorrupt) {
  toast('Your saved HomeStock data could not be read, so the app started empty. Nothing was overwritten — export or delete all data in Settings to start clean.');
} else if (storageUnavailable) {
  toast('Browser storage is unavailable, so changes will not be saved between visits.');
}
