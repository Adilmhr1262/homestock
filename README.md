# HomeStock — Know What You Have

A household inventory tool: track everyday essentials, see what is running
low, and build a shopping list. Static site, no backend, no account. All data
saves in the browser's localStorage and starts completely empty (no items,
no shopping entries).

## Views

- **Dashboard** — totals (items, low stock, out of stock, to buy), low/out
  list with one-click "Add to shopping list", restock suggestions, quick Add.
- **My Items** — add, edit, delete (with confirmation), +/− quantity controls
  (never below 0), search, filter by category and stock status, sort by name
  or quantity. Fields: name, category, current quantity, minimum, unit
  (pieces, bottles, packs, rolls, boxes, or custom), location, notes.
- **Shopping List** — manual entries, restock suggestions, edit desired
  quantity, check purchased, remove entries, clear checked. Checking an item
  never changes stock; a separate "Add purchased quantities to stock" action
  (with confirmation) does that. No duplicate entries linked to the same item.
- **Settings** — create/rename/delete categories (deletion blocked while items
  use a category unless they are reassigned), JSON export/import with full
  validation before replacement, approximate storage use, light/dark theme,
  delete-all with two-step confirmation.

## Stock rules

- Out of stock: quantity is 0.
- Low stock: quantity above 0 and at or below the minimum.
- Healthy: quantity above the minimum.
- Minimum 0 disables low-stock warnings while any stock remains.
- Suggested purchase quantity: max(1, minimum − current + 1).

## Details

- Privacy: no account, no backend, no analytics. The app makes no network
  requests of its own (system font stack, no web fonts), so inventory never
  leaves the device unless you export a backup file.
- Backups: versioned JSON (`{app: "homestock", version: 1, ...}`). The whole
  file is validated before anything is replaced; a bad file leaves your data
  untouched. Corrupt stored data is reported on load and never overwritten
  silently.
- Accessibility: labelled controls, visible focus, keyboard-operable dialogs,
  aria-live counts and toasts, 44px minimum touch targets, reduced-motion
  respected.
- Offline: a service worker caches the app shell with scope-relative URLs, so
  it works under a subpath such as `/homestock/`.
- Categories ship with five defaults (Kitchen, Bathroom, Cleaning, Pantry,
  Laundry) so an item can be added right away; all five can be renamed or
  deleted (at least one category must remain).

## Run the tests

```sh
python3 -m http.server 8142 --directory .
node tests/homestock-test.js
```

The suite runs in headless Firefox via Playwright and checks empty start,
item CRUD, quantity steppers and clamping, stock thresholds, suggestions and
duplicate prevention, purchase-to-stock flow, search/filter/sort, category
rename and protected deletion, export/import round-trip and rejection of bad
backups, theme persistence, the 375px layout, and zero external requests.
