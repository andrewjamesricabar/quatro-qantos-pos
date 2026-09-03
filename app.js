/* ==========================================================================
   QQ POS & Inventory — single-file client app, persisted to localStorage.
   ========================================================================== */

const STORAGE_KEY = "qq_pos_state_v1";

const BASE_CATEGORIES = [
  "Starters", "Main", "Pizza", "Pasta", "Rice Meal", "Burger", "Grilled/Chicken Inasal", "Happy Hour"
];

const MENU_SEED = [
  // Starters
  ["Starters", "Spring Roll"],
  ["Starters", "Chicken Wings"],
  ["Starters", "Tokwat & Baboy"],
  ["Starters", "Nachos Quatro"],
  ["Starters", "Fries"],
  ["Starters", "Potato Chips"],
  // Main
  ["Main", "Cansi Steak"],
  ["Main", "Pork Tapa"],
  ["Main", "Spareribs"],
  ["Main", "Sisig Belly"],
  ["Main", "Sisig Maskara"],
  ["Main", "Beef Salpicao"],
  ["Main", "Blue Marlin"],
  ["Main", "Braised Pork"],
  ["Main", "Boneless Bangus"],
  ["Main", "Crispy Pata"],
  ["Main", "Fried Chicken (Half)"],
  ["Main", "Fried Chicken (Whole)"],
  // Pizza
  ["Pizza", "Carbonara"],
  ["Pizza", "Margarita"],
  ["Pizza", "Pepperoni"],
  ["Pizza", "Hawaiian"],
  ["Pizza", "Four Cheese"],
  // Pasta
  ["Pasta", "Carbonara"],
  ["Pasta", "Pomodoro Basilico"],
  ["Pasta", "Aglio Olio"],
  // Rice Meal
  ["Rice Meal", "Salisbury Steak"],
  ["Rice Meal", "Sisig Belly"],
  ["Rice Meal", "Sisig Maskara"],
  ["Rice Meal", "Braised Pork"],
  ["Rice Meal", "Pan Seared Bangus"],
  // Burger
  ["Burger", "Original"],
  ["Burger", "Cheese"],
  // Grilled/Chicken Inasal
  ["Grilled/Chicken Inasal", "Paa"],
  ["Grilled/Chicken Inasal", "Pecho"],
  ["Grilled/Chicken Inasal", "Paa (Native)"],
  ["Grilled/Chicken Inasal", "Pecho (Native)"],
];

// Coffee menu — each drink is two separate menu items (Hot/Ice), same pattern as
// "Fried Chicken (Half)/(Whole)" elsewhere on the menu, so every existing feature
// (POS, category sorting, Inventory linking, Happy Hour eligibility) just works.
const COFFEE_MENU_SEED = [
  ["Coffee", "Americano (Hot)", 90],
  ["Coffee", "Americano (Ice)", 100],
  ["Coffee", "Cafe Latte (Hot)", 110],
  ["Coffee", "Cafe Latte (Ice)", 120],
  ["Coffee", "Spanish Latte (Hot)", 120],
  ["Coffee", "Spanish Latte (Ice)", 130],
  ["Coffee", "Salted Caramel (Hot)", 150],
  ["Coffee", "Salted Caramel (Ice)", 160],
  ["Coffee", "Caramel Macchiato (Hot)", 150],
  ["Coffee", "Caramel Macchiato (Ice)", 160],
  ["Coffee", "Cafe Mocha (Hot)", 150],
  ["Coffee", "Cafe Mocha (Ice)", 160],
];
function addCoffeeMenuItems() {
  if (!STATE.categories.includes("Coffee")) STATE.categories.push("Coffee");
  let added = 0;
  COFFEE_MENU_SEED.forEach(([category, name, price]) => {
    const exists = STATE.menu.some(m => m.category === category && m.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      STATE.menu.push({
        id: uid("mi") + "-" + slug(category) + "-" + slug(name),
        name, category, price, active: true, image: null
      });
      added++;
    }
  });
  return added;
}

// Beer bucket — a single menu item (6 bottles) where the customer picks any mix of the
// 4 beer types instead of a fixed recipe. Stock for each beer type is a normal Inventory
// item; the specific mix chosen is captured per-order and deducted accordingly at checkout
// (see addToCart's bucket branch, confirmBucketBuilder, and deductInventoryForOrder).
const BEER_BUCKET_OPTIONS = ["Pale Pilsen", "Red Horse", "San Miguel Light"];
const BEER_BUCKET_MENU_NAME = "Bucket of Beers (6 pcs)";
function addBeerBucketMenuItem() {
  if (!STATE.categories.includes("Buckets")) STATE.categories.push("Buckets");

  const optionInventoryIds = BEER_BUCKET_OPTIONS.map(name => {
    let inv = STATE.inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!inv) {
      inv = { id: uid("inv"), name, unit: "bottle", qty: 0, reorderLevel: 24, cost: 0 };
      STATE.inventory.push(inv);
    }
    return inv.id;
  });

  const exists = STATE.menu.some(m => m.category === "Buckets" && m.name === BEER_BUCKET_MENU_NAME);
  if (!exists) {
    STATE.menu.push({
      id: uid("mi") + "-buckets-" + slug(BEER_BUCKET_MENU_NAME),
      name: BEER_BUCKET_MENU_NAME,
      category: "Buckets",
      price: 540,
      active: true,
      image: null,
      bucket: { count: 6, optionInventoryIds }
    });
  }
}

// Removes the bogus "Bucket of Beers" inventory row + fake recipe link that "Add All Menu
// Items to Inventory" could create before it knew to skip bucket-type items (see the bucket
// check in bulkAddInventoryForMenu). A bucket's real stock always comes from its individual
// bottle options, never a dedicated row of its own.
function removeBogusBucketInventoryRows() {
  STATE.menu.filter(m => m.bucket).forEach(m => {
    delete STATE.recipes[m.id];
    const bogus = STATE.inventory.find(i => i.name.trim().toLowerCase() === m.name.trim().toLowerCase());
    if (bogus) STATE.inventory = STATE.inventory.filter(i => i.id !== bogus.id);
  });
}

// Drops Flavored Beers as a bucket mix-and-match choice. The ingredient row itself is left
// alone (in case it's tracked separately elsewhere) — this only removes it as an option.
function removeFlavoredBeersFromBucket() {
  const flavoredBeersInv = STATE.inventory.find(i => i.name.trim().toLowerCase() === "flavored beers");
  if (!flavoredBeersInv) return;
  STATE.menu.forEach(m => {
    if (m.bucket) m.bucket.optionInventoryIds = m.bucket.optionInventoryIds.filter(id => id !== flavoredBeersInv.id);
  });
}

// Cocktails already existed as bare Inventory rows with no Menu item behind them (created
// manually ahead of building out the actual recipes). This creates the matching Menu items
// under a "Cocktails" category, links each to its already-existing same-named inventory row
// (1 per order, a placeholder until the real multi-ingredient recipe is worked out), and
// marks every one On Hold so nothing can be sold before it's properly set up.
const COCKTAIL_MENU_SEED = ["Gold Rush", "Old Fashioned", "Amaretto Sour", "Alexander Rack", "Tequila Sunrise"];
function addCocktailMenuItems() {
  if (!STATE.categories.includes("Cocktails")) STATE.categories.push("Cocktails");
  COCKTAIL_MENU_SEED.forEach(name => {
    let inv = STATE.inventory.find(i => i.name.trim().toLowerCase() === name.toLowerCase());
    if (!inv) {
      inv = { id: uid("inv"), name, unit: "pcs", qty: 0, reorderLevel: 5, cost: 0 };
      STATE.inventory.push(inv);
    }
    let menuItem = STATE.menu.find(m => m.category === "Cocktails" && m.name.toLowerCase() === name.toLowerCase());
    if (!menuItem) {
      menuItem = {
        id: uid("mi") + "-cocktails-" + slug(name),
        name, category: "Cocktails", price: 0, active: true, onHold: true, image: null
      };
      STATE.menu.push(menuItem);
    } else {
      menuItem.onHold = true;
    }
    if (!(STATE.recipes[menuItem.id] || []).length) {
      STATE.recipes[menuItem.id] = [{ inventoryId: inv.id, qty: 1 }];
    }
  });
}

// One-time cleanup: "+ Add All Menu Items to Inventory" creates one inventory row per menu
// item, so Chicken Wings flavors (Barbecue, Buffalo, etc.) each got their own stock count
// even though they're really the same wings with different sauce. Consolidate them into a
// single shared "Chicken Wings" ingredient and re-link every flavor's recipe to it.
function consolidateChickenWingsInventory() {
  const flavorPattern = /^chicken wings\s*\(.+\)$/i;
  const flavorItems = STATE.inventory.filter(i => flavorPattern.test(i.name.trim()));
  if (flavorItems.length < 2) return;

  let shared = STATE.inventory.find(i => i.name.trim().toLowerCase() === "chicken wings");
  if (!shared) {
    shared = {
      id: uid("inv"), name: "Chicken Wings", unit: flavorItems[0].unit,
      qty: 0, reorderLevel: flavorItems[0].reorderLevel, cost: flavorItems[0].cost
    };
    STATE.inventory.push(shared);
  }
  flavorItems.forEach(item => {
    if (item.id === shared.id) return;
    mergeInventoryItems(item.id, shared.id);
  });
}

// Gives every Pizza menu item a single shared "Dough" stock count (1 dough ball per pizza,
// regardless of flavor/toppings) instead of tracking each flavor's stock separately. Folds
// in whatever ingredient a pizza was already individually linked to (e.g. from bulk-add
// creating one inventory row per flavor) so no stock count is lost in the process.
function setupPizzaDoughInventory() {
  const pizzaItems = STATE.menu.filter(m => m.category === "Pizza");
  if (pizzaItems.length === 0) return;

  let dough = STATE.inventory.find(i => i.name.trim().toLowerCase() === "dough");
  if (!dough) {
    dough = { id: uid("inv"), name: "Dough", unit: "pcs", qty: 0, reorderLevel: 10, cost: 0 };
    STATE.inventory.push(dough);
  }

  const toMerge = new Set();
  pizzaItems.forEach(m => {
    (STATE.recipes[m.id] || []).forEach(rl => { if (rl.inventoryId !== dough.id) toMerge.add(rl.inventoryId); });
  });
  toMerge.forEach(invId => {
    if (STATE.inventory.some(i => i.id === invId)) mergeInventoryItems(invId, dough.id);
  });

  pizzaItems.forEach(m => {
    const recipe = STATE.recipes[m.id] || [];
    if (!recipe.some(rl => rl.inventoryId === dough.id)) {
      STATE.recipes[m.id] = [...recipe.filter(rl => rl.inventoryId !== dough.id), { inventoryId: dough.id, qty: 1 }];
    }
  });
}

// Generic version of the above — gives every menu item in a category a single shared
// inventory count (1 unit per order) instead of tracking each dish's stock separately.
// Folds in whatever ingredient a dish was already individually linked to, so no existing
// stock count is lost in the process.
function setupSharedCategoryInventory(categoryName, sharedInventoryName, unit) {
  const items = STATE.menu.filter(m => m.category === categoryName);
  if (items.length === 0) return;

  let shared = STATE.inventory.find(i => i.name.trim().toLowerCase() === sharedInventoryName.toLowerCase());
  if (!shared) {
    shared = { id: uid("inv"), name: sharedInventoryName, unit, qty: 0, reorderLevel: 10, cost: 0 };
    STATE.inventory.push(shared);
  }

  const toMerge = new Set();
  items.forEach(m => {
    (STATE.recipes[m.id] || []).forEach(rl => { if (rl.inventoryId !== shared.id) toMerge.add(rl.inventoryId); });
  });
  toMerge.forEach(invId => {
    if (STATE.inventory.some(i => i.id === invId)) mergeInventoryItems(invId, shared.id);
  });

  items.forEach(m => {
    const recipe = STATE.recipes[m.id] || [];
    if (!recipe.some(rl => rl.inventoryId === shared.id)) {
      STATE.recipes[m.id] = [...recipe.filter(rl => rl.inventoryId !== shared.id), { inventoryId: shared.id, qty: 1 }];
    }
  });
}

// Cleans up unused per-flavor Inventory rows left over from clicking "Add All Menu Items
// to Inventory" after Dough was already set up (fixed going forward, but old leftovers from
// before the fix could still be sitting around) — e.g. a "Margarita" or "Pepperoni" row with
// zero recipe links, since every Pizza item now deducts from the shared Dough stock instead.
function removeOrphanedPizzaFlavorInventory() {
  const pizzaFlavorNames = new Set(
    STATE.menu.filter(m => m.category === "Pizza").flatMap(m => [m.name.toLowerCase(), `${m.name} (Pizza)`.toLowerCase()])
  );
  const orphans = STATE.inventory.filter(i =>
    pizzaFlavorNames.has(i.name.trim().toLowerCase()) &&
    i.name.trim().toLowerCase() !== "dough" &&
    getInventoryItemCategories(i.id).size === 0
  );
  orphans.forEach(item => { STATE.inventory = STATE.inventory.filter(i => i.id !== item.id); });
  return orphans.length;
}

// Auto-merges inventory items that share the exact same name (case/whitespace-insensitive) —
// e.g. two "Coke (Can)" rows from clicking "Add All Menu Items to Inventory" more than once,
// or from manually adding one that already existed. Keeps the first occurrence, folds every
// later duplicate's on-hand quantity and recipe links into it.
function mergeExactDuplicateInventoryNames() {
  const seen = new Map();
  let merged = 0;
  STATE.inventory.slice().forEach(item => {
    const key = item.name.trim().toLowerCase();
    const keeper = seen.get(key);
    if (!keeper) { seen.set(key, item); return; }
    if (STATE.inventory.some(i => i.id === item.id)) {
      mergeInventoryItems(item.id, keeper.id);
      merged++;
    }
  });
  return merged;
}

// Free-license placeholder photos (Wikimedia Commons, public domain / CC0 / CC-BY / CC-BY-SA)
// sourced for generic dishes only. Specific Filipino specialty dishes (Cansi Steak, Tokwat &
// Baboy, Sisig, Salpicao, Bangus, Inasal, etc.) are intentionally left blank rather than
// matched to a misleading stand-in photo — replace these placeholders with real cafe photos
// via Menu > Edit item > Choose Image whenever you're ready.
const DEFAULT_MENU_IMAGES = {
  "starters|spring roll": "Images/menu/spring-roll.jpg",
  "starters|chicken wings": "Images/menu/chicken-wings.jpg",
  "starters|nachos quatro": "Images/menu/nachos-quatro.jpg",
  "starters|fries": "Images/menu/fries.jpg",
  "starters|potato chips": "Images/menu/potato-chips.jpg",
  "main|spareribs": "Images/menu/spareribs.jpg",
  "main|braised pork": "Images/menu/braised-pork.jpg",
  "main|crispy pata": "Images/menu/crispy-pata.jpg",
  "main|fried chicken (half)": "Images/menu/fried-chicken-half.jpg",
  "main|fried chicken (whole)": "Images/menu/fried-chicken-whole.jpg",
  "pizza|carbonara": "Images/menu/pizza-carbonara.jpg",
  "pizza|margarita": "Images/menu/pizza-margarita.jpg",
  "pizza|pepperoni": "Images/menu/pizza-pepperoni.jpg",
  "pizza|hawaiian": "Images/menu/pizza-hawaiian.jpg",
  "pizza|four cheese": "Images/menu/pizza-four-cheese.jpg",
  "pasta|carbonara": "Images/menu/pasta-carbonara.jpg",
  "pasta|pomodoro basilico": "Images/menu/pomodoro-basilico.jpg",
  "pasta|aglio olio": "Images/menu/aglio-olio.jpg",
  "rice meal|braised pork": "Images/menu/braised-pork.jpg",
  "burger|original": "Images/menu/burger-original.jpg",
  "burger|cheese": "Images/menu/burger-cheese.jpg"
};
function lookupDefaultImage(category, name) {
  return DEFAULT_MENU_IMAGES[category.trim().toLowerCase() + "|" + name.trim().toLowerCase()] || null;
}

/* ---------- utilities ---------- */

function slug(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function formatMoney(n) {
  const cur = STATE.settings.currency || "₱";
  const v = Number(n) || 0;
  return cur + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function isSameOrBetween(ts, fromISO, toISO) {
  const dISO = new Date(ts).toISOString().slice(0, 10);
  if (fromISO && dISO < fromISO) return false;
  if (toISO && dISO > toISO) return false;
  return true;
}

/* ---------- Happy Hour (Philippine Time) ---------- */

function getPHTimeHHMM() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === "hour").value;
  const m = parts.find(p => p.type === "minute").value;
  return `${h}:${m}`;
}
function isHappyHourActiveNow() {
  const hh = STATE.settings.happyHour;
  if (!hh || !hh.enabled) return false;
  const now = getPHTimeHHMM();
  return now >= hh.startTime && now < hh.endTime;
}
function formatTimeLabel(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/* ---------- state ---------- */

function buildDefaultState() {
  const menu = MENU_SEED.map(([category, name]) => ({
    id: uid("mi") + "-" + slug(category) + "-" + slug(name),
    name, category, price: 0, active: true, image: lookupDefaultImage(category, name)
  }));
  return {
    settings: {
      restaurantName: "Quatro Qantos",
      currency: "₱",
      taxRate: 0,
      serviceRate: 0,
      receiptFooter: "Thank you for dining with us!",
      managerPin: "1234",
      happyHour: { enabled: true, categoryName: "Happy Hour", startTime: "17:00", endTime: "20:00" }
    },
    menu,
    inventory: [],
    recipes: {},
    orders: [],
    stockLog: [],
    categories: BASE_CATEGORIES.slice(),
    categoryGroups: {},
    purchaseRequests: [],
    nextOrderNo: 1
  };
}

let STATE = loadState();
if (!STATE.settings.managerPin) STATE.settings.managerPin = "1234";
if (!STATE.stockLog) STATE.stockLog = [];
if (!STATE.categories) {
  STATE.categories = Array.from(new Set([...BASE_CATEGORIES, ...STATE.menu.map(m => m.category)]));
}
if (!STATE.settings.happyHour) {
  STATE.settings.happyHour = { enabled: false, categoryName: "Happy Hour", startTime: "17:00", endTime: "20:00" };
}
if (!STATE.migrations) STATE.migrations = {};
if (!STATE.migrations.coffeeMenuAdded) {
  addCoffeeMenuItems();
  STATE.migrations.coffeeMenuAdded = true;
  saveState();
}
if (!STATE.migrations.beerBucketAdded) {
  addBeerBucketMenuItem();
  STATE.migrations.beerBucketAdded = true;
  saveState();
}
if (!STATE.migrations.cocktailMenuAdded) {
  addCocktailMenuItems();
  STATE.migrations.cocktailMenuAdded = true;
  saveState();
}
if (!STATE.migrations.beerBucketPriceFixed) {
  const bucketItem = STATE.menu.find(m => m.category === "Buckets" && m.name === BEER_BUCKET_MENU_NAME);
  if (bucketItem && bucketItem.price === 0) bucketItem.price = 540;
  STATE.migrations.beerBucketPriceFixed = true;
  saveState();
}
if (!STATE.migrations.bogusBucketInventoryRemoved) {
  removeBogusBucketInventoryRows();
  STATE.migrations.bogusBucketInventoryRemoved = true;
  saveState();
}
if (!STATE.migrations.flavoredBeersRemovedFromBucket) {
  removeFlavoredBeersFromBucket();
  STATE.migrations.flavoredBeersRemovedFromBucket = true;
  saveState();
}
if (!STATE.categoryGroups) STATE.categoryGroups = {};
if (!STATE.migrations.chickenWingsConsolidated) {
  consolidateChickenWingsInventory();
  STATE.migrations.chickenWingsConsolidated = true;
  saveState();
}
if (!STATE.migrations.pizzaDoughSetup) {
  setupPizzaDoughInventory();
  STATE.migrations.pizzaDoughSetup = true;
  saveState();
}
if (!STATE.migrations.pastaInventorySetup) {
  setupSharedCategoryInventory("Pasta", "Pasta", "pcs");
  STATE.migrations.pastaInventorySetup = true;
  saveState();
}
if (!STATE.migrations.pizzaFlavorOrphansRemoved) {
  removeOrphanedPizzaFlavorInventory();
  STATE.migrations.pizzaFlavorOrphansRemoved = true;
  saveState();
}
if (!STATE.purchaseRequests) STATE.purchaseRequests = [];
// Runs every load (not gated behind a one-time flag) since it's a safe, idempotent
// self-healing check — exact-name duplicates shouldn't exist, however they arise.
if (mergeExactDuplicateInventoryNames() > 0) saveState();

let bucketBuilderState = null;

let cart = [];
let posSelectedCategory = "All";
let invSelectedCategory = "All";
let selectedInventoryIds = new Set();
let recipeDraft = [];
let editingMenuId = null;
let editingInventoryId = null;
let menuItemImageDraft = undefined; // undefined = unchanged, null = removed, string = new data URL
let unlockedManager = false;
let pendingProtectedTab = null;
let pendingProtectedAction = null;
let stockAdjustTargetId = null;
let receiptOrderId = null;
let editingRequestId = null;
const PROTECTED_TABS = ["menu", "inventory", "requests", "reports", "settings"];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.menu || !parsed.inventory) return buildDefaultState();
    return parsed;
  } catch (e) {
    console.error("Failed to load state, using defaults", e);
    return buildDefaultState();
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  } catch (e) {
    alert("Could not save your changes — the browser's local storage is full (this can happen after adding many menu photos). Please remove a few photos or export/reset old order history, then try again.\n\n" + e.message);
    throw e;
  }
}

function getAllCategories() {
  const set = new Set(STATE.categories || BASE_CATEGORIES);
  STATE.menu.forEach(m => set.add(m.category));
  return Array.from(set);
}

/* ---------- category groups (POS tab organization) ---------- */

const CATEGORY_GROUP_OPTIONS = ["Food", "Beverages", "Promos", "Other"];
const DEFAULT_CATEGORY_GROUPS = {
  "starters": "Food", "main": "Food", "pizza": "Food", "pasta": "Food",
  "rice meal": "Food", "burger": "Food", "grilled/chicken inasal": "Food",
  "happy hour": "Promos",
  "coffee": "Beverages", "frappe": "Beverages", "softdrinks (can)": "Beverages",
  "softdrinks (bottle)": "Beverages", "fruit shake": "Beverages", "beer below zero": "Beverages",
  "flavored beers": "Beverages", "imported beer": "Beverages", "buckets": "Beverages",
  "cocktails": "Beverages"
};
function guessCategoryGroup(category) {
  return DEFAULT_CATEGORY_GROUPS[category.trim().toLowerCase()] || "Other";
}
function getCategoryGroup(category) {
  if (STATE.categoryGroups && STATE.categoryGroups[category]) return STATE.categoryGroups[category];
  return guessCategoryGroup(category);
}
function moveOtherGroupCategoriesToBeverages() {
  getAllCategories().forEach(c => {
    if (getCategoryGroup(c) === "Other") STATE.categoryGroups[c] = "Beverages";
  });
}
function getGroupedCategories() {
  const cats = getAllCategories();
  const groups = {};
  cats.forEach(c => {
    const g = getCategoryGroup(c);
    (groups[g] = groups[g] || []).push(c);
  });
  const order = CATEGORY_GROUP_OPTIONS.filter(g => groups[g] && groups[g].length);
  return order.map(g => ({ group: g, categories: groups[g] }));
}
if (!STATE.migrations.otherGroupMovedToBeverages) {
  moveOtherGroupCategoriesToBeverages();
  STATE.migrations.otherGroupMovedToBeverages = true;
  saveState();
}

function renameCategory(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return false;
  const collision = STATE.categories.find(c => c.toLowerCase() === newName.toLowerCase() && c !== oldName);
  if (collision) {
    const count = STATE.menu.filter(m => m.category === oldName).length;
    if (!confirm(`"${collision}" already exists as a category. Merge "${oldName}" into it? All ${count} item(s) in "${oldName}" will move into "${collision}".`)) {
      return false;
    }
    newName = collision;
    STATE.categories = STATE.categories.filter(c => c !== oldName);
  } else {
    const idx = STATE.categories.indexOf(oldName);
    if (idx >= 0) STATE.categories[idx] = newName;
    else STATE.categories.push(newName);
  }
  STATE.menu.forEach(m => { if (m.category === oldName) m.category = newName; });
  if (STATE.settings.happyHour && STATE.settings.happyHour.categoryName === oldName) {
    STATE.settings.happyHour.categoryName = newName;
  }
  if (STATE.categoryGroups && STATE.categoryGroups[oldName] !== undefined) {
    STATE.categoryGroups[newName] = STATE.categoryGroups[oldName];
    delete STATE.categoryGroups[oldName];
  }
  return true;
}

function sortMenuByCategory(items) {
  const categoryOrder = getAllCategories();
  return items.slice().sort((a, b) => {
    const catDiff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    return a.name.localeCompare(b.name);
  });
}

/* ---------- tab switching ---------- */

function initTabs() {
  $all(".tab-btn[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}
function switchTab(tab) {
  if (PROTECTED_TABS.includes(tab) && !unlockedManager) {
    pendingProtectedTab = tab;
    openPinModal("Enter the manager PIN to open " + tab.charAt(0).toUpperCase() + tab.slice(1) + ".");
    return;
  }
  doSwitchTab(tab);
}
function doSwitchTab(tab) {
  $all(".tab-btn[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $("#adminDropdownToggle").classList.toggle("active", PROTECTED_TABS.includes(tab));
  $("#adminDropdownMenu").classList.add("hidden");
  $all(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + tab));
  if (tab === "dashboard") renderDashboard();
  if (tab === "pos") renderPOS();
  if (tab === "menu") renderMenuTable();
  if (tab === "inventory") renderInventoryTable();
  if (tab === "requests") renderRequestsTable();
  if (tab === "reports") { setupReportDefaultRange(); runReport(); }
  if (tab === "settings") loadSettingsForm();
}

/* ---------- manager PIN gate ---------- */

function openPinModal(message) {
  $("#pinModalMessage").textContent = message || "Enter the manager PIN to continue.";
  $("#pinInput").value = "";
  $("#pinError").classList.add("hidden");
  $("#pinModal").classList.remove("hidden");
  $("#pinInput").focus();
}
function closePinModal() {
  $("#pinModal").classList.add("hidden");
  pendingProtectedTab = null;
  pendingProtectedAction = null;
}
function submitPin() {
  const entered = $("#pinInput").value;
  if (entered !== STATE.settings.managerPin) {
    $("#pinError").classList.remove("hidden");
    $("#pinInput").value = "";
    $("#pinInput").focus();
    return;
  }
  unlockedManager = true;
  $("#lockManagerBtn").classList.remove("hidden");
  $("#pinModal").classList.add("hidden");
  const tab = pendingProtectedTab;
  const action = pendingProtectedAction;
  pendingProtectedTab = null;
  pendingProtectedAction = null;
  if (tab) doSwitchTab(tab);
  if (action) action();
}
function requireManagerPin(action, message) {
  if (unlockedManager) { action(); return; }
  pendingProtectedAction = action;
  openPinModal(message || "Enter the manager PIN to continue.");
}
function lockManager() {
  unlockedManager = false;
  $("#lockManagerBtn").classList.add("hidden");
  const activeTab = $(".tab-btn.active[data-tab]");
  if (activeTab && PROTECTED_TABS.includes(activeTab.dataset.tab)) {
    doSwitchTab("dashboard");
  }
}

/* ---------- clock ---------- */

function tickClock() {
  $("#clockDisplay").textContent = new Date().toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
  // keep the Happy Hour banner/cart totals accurate live if the 5pm/8pm boundary
  // is crossed while the POS tab is sitting open with an order in progress
  if ($("#tab-pos").classList.contains("active")) {
    renderHappyHourBanner();
    renderCart();
  }
}

/* ==========================================================================
   DASHBOARD
   ========================================================================== */

function renderDashboard() {
  $("#restaurantNameDisplay").textContent = STATE.settings.restaurantName;
  const today = todayISO();
  const todaysOrders = STATE.orders.filter(o => o.status === "completed" && isSameOrBetween(o.timestamp, today, today));
  const todaysSales = todaysOrders.reduce((s, o) => s + o.total, 0);

  $("#statTodaySales").textContent = formatMoney(todaysSales);
  $("#statTodayOrders").textContent = todaysOrders.length;
  $("#statMenuCount").textContent = STATE.menu.length;

  const lowStockItems = STATE.inventory.filter(i => i.qty <= i.reorderLevel && !isInventoryItemExemptFromLowStock(i.id));
  $("#statLowStock").textContent = lowStockItems.length;

  const badge = $("#lowStockBadge");
  if (lowStockItems.length > 0) {
    badge.textContent = lowStockItems.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  // best sellers today
  const agg = {};
  todaysOrders.forEach(o => o.items.forEach(it => {
    if (!agg[it.name]) agg[it.name] = { qty: 0, revenue: 0 };
    agg[it.name].qty += it.qty;
    agg[it.name].revenue += it.subtotal;
  }));
  const sorted = Object.entries(agg).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);
  const bsBody = $("#bestSellersTable tbody");
  bsBody.innerHTML = sorted.length
    ? sorted.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${v.qty}</td><td>${formatMoney(v.revenue)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No sales yet today.</td></tr>`;

  const lsBody = $("#lowStockTable tbody");
  lsBody.innerHTML = lowStockItems.length
    ? lowStockItems.map(i => `<tr class="low-stock"><td>${escapeHtml(i.name)}</td><td>${i.qty} ${escapeHtml(i.unit)}</td><td>${i.reorderLevel} ${escapeHtml(i.unit)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">All stock levels are healthy.</td></tr>`;

  updatePendingRequestsBadge();
}


function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ==========================================================================
   PURCHASE REQUESTS
   ========================================================================== */

function updatePendingRequestsBadge() {
  const pending = STATE.purchaseRequests.filter(r => !r.fulfilled).length;
  const badge = $("#pendingRequestsBadge");
  if (!badge) return;
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);
}

function renderRequestsTable() {
  updatePendingRequestsBadge();
  const deptFilter = $("#requestDeptFilter").value;
  const showPurchased = $("#requestShowPurchased").checked;
  const rows = STATE.purchaseRequests
    .filter(r => (!deptFilter || r.department === deptFilter) && (showPurchased || !r.fulfilled))
    .sort((a, b) => {
      if (a.fulfilled !== b.fulfilled) return a.fulfilled ? 1 : -1;
      return b.requestedAt - a.requestedAt;
    });
  const tbody = $("#requestsTable tbody");
  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr class="${r.fulfilled ? "" : "low-stock"}" data-id="${r.id}">
      <td>${escapeHtml(r.itemName)}${r.qty ? ` <span class="muted">(${r.qty}${r.unit ? " " + escapeHtml(r.unit) : ""})</span>` : ""}</td>
      <td>${escapeHtml(r.department)}</td>
      <td>${r.qty || ""}${r.qty && r.unit ? " " + escapeHtml(r.unit) : ""}</td>
      <td>${r.usedFor ? escapeHtml(r.usedFor) : `<span class="muted">—</span>`}</td>
      <td>${formatDateTime(r.requestedAt)}</td>
      <td>${r.fulfilled ? `<span class="muted">Purchased</span>` : `<span class="error-text">⚠ Pending</span>`}</td>
      <td>
        <button class="btn btn-secondary btn-small" data-act="fulfill">${r.fulfilled ? "Unmark" : "Mark Purchased"}</button>
        <button class="btn btn-secondary btn-small" data-act="edit">Edit</button>
        <button class="btn btn-danger btn-small" data-act="remove">Delete</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="muted">No purchase requests yet. Use "+ New Request" to log something the kitchen or bar needs.</td></tr>`;

  $all("tr[data-id]", tbody).forEach(tr => {
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openRequestModal(tr.dataset.id));
    tr.querySelector('[data-act="remove"]').addEventListener("click", () => {
      if (!confirm("Delete this purchase request?")) return;
      STATE.purchaseRequests = STATE.purchaseRequests.filter(r => r.id !== tr.dataset.id);
      saveState();
      renderRequestsTable();
    });
    tr.querySelector('[data-act="fulfill"]').addEventListener("click", () => toggleRequestFulfilled(tr.dataset.id));
  });
}

function toggleRequestFulfilled(id) {
  const r = STATE.purchaseRequests.find(x => x.id === id);
  if (!r) return;
  r.fulfilled = !r.fulfilled;
  r.fulfilledAt = r.fulfilled ? Date.now() : null;
  saveState();
  renderRequestsTable();
}

function openRequestModal(id) {
  editingRequestId = id || null;
  $("#requestModalTitle").textContent = id ? "Edit Purchase Request" : "New Purchase Request";
  $("#requestDeleteBtn").classList.toggle("hidden", !id);
  if (id) {
    const r = STATE.purchaseRequests.find(x => x.id === id);
    $("#requestId").value = r.id;
    $("#requestItemName").value = r.itemName;
    $("#requestDept").value = r.department;
    $("#requestQty").value = r.qty || "";
    $("#requestUnit").value = r.unit || "";
    $("#requestUsedFor").value = r.usedFor || "";
    $("#requestNotes").value = r.notes || "";
  } else {
    $("#requestId").value = "";
    $("#requestItemName").value = "";
    $("#requestDept").value = "Kitchen";
    $("#requestQty").value = "";
    $("#requestUnit").value = "";
    $("#requestUsedFor").value = "";
    $("#requestNotes").value = "";
  }
  $("#requestModal").classList.remove("hidden");
  $("#requestItemName").focus();
}
function closeRequestModal() { $("#requestModal").classList.add("hidden"); }

function autoSuggestRequestFromInventory() {
  const name = $("#requestItemName").value.trim().toLowerCase();
  if (!name) return;
  const inv = STATE.inventory.find(i => i.name.trim().toLowerCase() === name)
    || STATE.inventory.find(i => i.name.trim().toLowerCase().includes(name));
  if (!inv) return;
  if (!$("#requestUnit").value.trim()) $("#requestUnit").value = inv.unit;
  if (!$("#requestUsedFor").value.trim()) {
    const linked = getLinkedMenuItemNames(inv.id);
    if (linked.length) $("#requestUsedFor").value = linked.join(", ");
  }
}

function saveRequest() {
  const itemName = $("#requestItemName").value.trim();
  const department = $("#requestDept").value;
  const qty = Number($("#requestQty").value) || 0;
  const unit = $("#requestUnit").value.trim();
  const usedFor = $("#requestUsedFor").value.trim();
  const notes = $("#requestNotes").value.trim();
  if (!itemName) { alert("Please enter an item name."); return; }

  if (editingRequestId) {
    const r = STATE.purchaseRequests.find(x => x.id === editingRequestId);
    r.itemName = itemName; r.department = department; r.qty = qty; r.unit = unit; r.usedFor = usedFor; r.notes = notes;
  } else {
    STATE.purchaseRequests.push({
      id: uid("req"),
      itemName, department, qty, unit, usedFor, notes,
      requestedAt: Date.now(),
      fulfilled: false,
      fulfilledAt: null
    });
  }
  saveState();
  closeRequestModal();
  renderRequestsTable();
}

function deleteRequest() {
  if (!editingRequestId) return;
  if (!confirm("Delete this purchase request?")) return;
  STATE.purchaseRequests = STATE.purchaseRequests.filter(r => r.id !== editingRequestId);
  saveState();
  closeRequestModal();
  renderRequestsTable();
}

/* ==========================================================================
   POS
   ========================================================================== */

function renderHappyHourBanner() {
  const hh = STATE.settings.happyHour;
  const banner = $("#happyHourBanner");
  if (!hh || !hh.enabled) { banner.classList.add("hidden"); return; }
  const active = isHappyHourActiveNow();
  banner.classList.remove("hidden");
  banner.classList.toggle("active", active);
  banner.textContent = active
    ? `🎉 Happy Hour is ON — Buy 1 Take 1 on ${hh.categoryName} until ${formatTimeLabel(hh.endTime)}!`
    : `Happy Hour Buy 1 Take 1 on ${hh.categoryName}: ${formatTimeLabel(hh.startTime)}–${formatTimeLabel(hh.endTime)} (Philippine Time)`;
}

function renderPOS() {
  renderHappyHourBanner();
  const posSearch = $("#posSearchInput").value.trim().toLowerCase();
  const catTabs = $("#posCategoryTabs");
  catTabs.classList.toggle("hidden", !!posSearch);

  if (!posSearch) {
    const groupIcons = { Food: "🍽️", Beverages: "🥤", Promos: "🎉", Other: "🗂️" };
    const groupedCats = getGroupedCategories();
    catTabs.innerHTML =
      `<button class="pos-toplevel-btn ${posSelectedCategory === "All" ? "active" : ""}" data-cat="All">All</button>` +
      groupedCats.map(({ group, categories }) => {
        const isGroupActive = categories.includes(posSelectedCategory);
        return `
        <div class="pos-group-dropdown">
          <button type="button" class="pos-group-toggle ${isGroupActive ? "active" : ""}" data-group="${escapeHtml(group)}">
            ${groupIcons[group] || ""} ${escapeHtml(group)} <span class="dropdown-caret">▾</span>
          </button>
          <div class="pos-group-menu">
            ${categories.map(c => `<button class="${c === posSelectedCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
          </div>
        </div>`;
      }).join("");

    $all("button[data-cat]", catTabs).forEach(b => b.addEventListener("click", () => {
      posSelectedCategory = b.dataset.cat;
      renderPOS();
    }));
    $all(".pos-group-toggle", catTabs).forEach(toggle => toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = toggle.nextElementSibling;
      const wasOpen = menu.classList.contains("open");
      $all(".pos-group-menu.open", catTabs).forEach(m => m.classList.remove("open"));
      if (!wasOpen) menu.classList.add("open");
    }));
  }

  const items = posSearch
    ? sortMenuByCategory(STATE.menu.filter(m => m.active && m.name.toLowerCase().includes(posSearch)))
    : sortMenuByCategory(STATE.menu.filter(m => m.active && (posSelectedCategory === "All" || m.category === posSelectedCategory)));
  const hh = STATE.settings.happyHour;
  const hhActiveNow = hh && hh.enabled && isHappyHourActiveNow();
  const grid = $("#posItemGrid");
  grid.innerHTML = items.length
    ? items.map(m => {
        const isBogoNow = hhActiveNow && m.category === hh.categoryName;
        return `
      <div class="pos-item-card ${m.price <= 0 ? "no-price" : ""} ${m.image ? "has-image" : ""} ${m.onHold ? "on-hold" : ""}" data-id="${m.id}" ${m.image ? `style="background-image:url('${m.image}')"` : ""}>
        ${m.onHold ? `<span class="hold-badge">ON HOLD</span>` : ""}
        ${isBogoNow ? `<span class="bogo-badge">B1T1</span>` : ""}
        ${m.bucket ? `<span class="bucket-badge">🍺 Mix &amp; Match</span>` : ""}
        <span class="item-name">${escapeHtml(m.name)}</span>
        <span class="item-price">${m.price > 0 ? formatMoney(m.price) : "Set price"}</span>
      </div>`;
      }).join("")
    : `<p class="empty-state">${posSearch ? "No menu items match your search." : "No items in this category yet."}</p>`;
  $all(".pos-item-card", grid).forEach(card => card.addEventListener("click", () => {
    const clicked = STATE.menu.find(m => m.id === card.dataset.id);
    if (!clicked) return;
    if (clicked.onHold) { alert(`"${clicked.name}" is currently on hold and can't be ordered right now.`); return; }
    if (clicked.bucket) openBucketBuilderModal(clicked);
    else addToCart(card.dataset.id);
  }));

  renderCart();
}

function addToCart(menuId) {
  const item = STATE.menu.find(m => m.id === menuId);
  if (!item) return;
  if (item.bucket) { openBucketBuilderModal(item); return; }
  const line = cart.find(c => c.menuItemId === menuId && !c.bucketMix);
  if (line) line.qty += 1;
  else cart.push({ menuItemId: menuId, name: item.name, price: item.price, qty: 1 });
  renderCart();
}

// Quick operational toggle — separate from "Active" (which hides an item entirely and
// lives behind the manager PIN in Menu Management). On Hold is meant for the floor: staff
// can 86 an item the moment the kitchen runs out, no PIN needed, and un-hold it just as fast.
function toggleMenuItemHold(menuId) {
  const item = STATE.menu.find(m => m.id === menuId);
  if (!item) return;
  item.onHold = !item.onHold;
  saveState();
  renderPOS();
  renderDashboard();
  if ($("#tab-menu").classList.contains("active")) renderMenuTable();
  if ($("#tab-inventory").classList.contains("active")) renderOnHoldPanel();
}

// Inventory-side hold control: toggles every menu item linked to this ingredient together —
// if any of them are still active, Hold puts all of them on hold; if they're all already
// held, Resume brings all of them back.
function toggleHoldForLinkedMenuItems(invId) {
  const linked = getLinkedMenuItems(invId);
  if (linked.length === 0) return;
  const shouldHold = !linked.every(m => m.onHold);
  linked.forEach(m => { m.onHold = shouldHold; });
  saveState();
  renderInventoryTable();
  renderMenuTable();
  renderPOS();
  renderDashboard();
}

/* ----- build-your-own bucket ----- */

function openBucketBuilderModal(item) {
  bucketBuilderState = { menuItem: item, mix: {} };
  item.bucket.optionInventoryIds.forEach(id => { bucketBuilderState.mix[id] = 0; });
  $("#bucketBuilderTitle").textContent = item.name;
  $("#bucketBuilderSubtitle").textContent = `Pick ${item.bucket.count} bottles total — mix and match as the customer likes.`;
  renderBucketBuilderOptions();
  $("#bucketBuilderModal").classList.remove("hidden");
}
function closeBucketBuilderModal() {
  $("#bucketBuilderModal").classList.add("hidden");
  bucketBuilderState = null;
}
function renderBucketBuilderOptions() {
  const { menuItem, mix } = bucketBuilderState;
  const wrap = $("#bucketBuilderOptions");
  wrap.innerHTML = menuItem.bucket.optionInventoryIds.map(id => {
    const inv = STATE.inventory.find(i => i.id === id);
    const label = inv ? inv.name : "(deleted item)";
    const qty = mix[id] || 0;
    return `<div class="bucket-option-row" data-id="${id}">
      <span>${escapeHtml(label)}</span>
      <span class="cl-qty-controls">
        <button data-act="dec">−</button>
        <span>${qty}</span>
        <button data-act="inc">+</button>
      </span>
    </div>`;
  }).join("");
  $all(".bucket-option-row", wrap).forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-act="inc"]').addEventListener("click", () => {
      const total = Object.values(bucketBuilderState.mix).reduce((s, q) => s + q, 0);
      if (total >= menuItem.bucket.count) return;
      bucketBuilderState.mix[id] = (bucketBuilderState.mix[id] || 0) + 1;
      renderBucketBuilderOptions();
    });
    row.querySelector('[data-act="dec"]').addEventListener("click", () => {
      bucketBuilderState.mix[id] = Math.max(0, (bucketBuilderState.mix[id] || 0) - 1);
      renderBucketBuilderOptions();
    });
  });
  const total = Object.values(mix).reduce((s, q) => s + q, 0);
  $("#bucketBuilderTotal").textContent = `${total} / ${menuItem.bucket.count}`;
  $("#bucketBuilderAddBtn").disabled = total !== menuItem.bucket.count;
}
function confirmBucketBuilder() {
  const { menuItem, mix } = bucketBuilderState;
  const total = Object.values(mix).reduce((s, q) => s + q, 0);
  if (total !== menuItem.bucket.count) return;
  const bucketMix = Object.entries(mix).filter(([, q]) => q > 0).map(([inventoryId, qty]) => {
    const inv = STATE.inventory.find(i => i.id === inventoryId);
    return { inventoryId, name: inv ? inv.name : "Unknown", qty };
  });
  cart.push({
    menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, qty: 1, bucketMix
  });
  closeBucketBuilderModal();
  renderCart();
}

function renderCart() {
  const hh = STATE.settings.happyHour;
  const hhActiveNow = hh && hh.enabled && isHappyHourActiveNow();
  const list = $("#cartList");
  list.innerHTML = cart.length ? "" : `<p class="empty-state">No items yet. Tap a menu item to add it.</p>`;
  cart.forEach(line => {
    const item = STATE.menu.find(m => m.id === line.menuItemId);
    const isBogo = hhActiveNow && item && item.category === hh.categoryName;
    const freeQty = isBogo ? Math.floor(line.qty / 2) : 0;
    const mixSummary = line.bucketMix ? line.bucketMix.map(x => `${x.qty}x ${escapeHtml(x.name)}`).join(", ") : "";
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <span class="cl-name">${escapeHtml(line.name)}${isBogo ? ` <span class="bogo-badge">B1T1</span>` : ""}<br><small class="muted">${mixSummary || (formatMoney(line.price) + " each")}${freeQty > 0 ? ` · ${freeQty} free` : ""}</small></span>
      <span class="cl-qty-controls">
        <button data-act="dec">−</button>
        <span>${line.qty}</span>
        <button data-act="inc">+</button>
      </span>
      <span>${formatMoney(line.price * line.qty - freeQty * line.price)}</span>
      <span class="cl-remove" data-act="remove">✕</span>
    `;
    div.querySelector('[data-act="inc"]').addEventListener("click", () => { line.qty++; renderCart(); });
    div.querySelector('[data-act="dec"]').addEventListener("click", () => { line.qty--; if (line.qty <= 0) cart = cart.filter(c => c !== line); renderCart(); });
    div.querySelector('[data-act="remove"]').addEventListener("click", () => { cart = cart.filter(c => c !== line); renderCart(); });
    list.appendChild(div);
  });

  const totals = computeCartTotals();
  $("#cartSubtotal").textContent = formatMoney(totals.subtotal);
  $("#cartHappyHourRow").classList.toggle("hidden", !(totals.happyHourDiscount > 0));
  $("#cartHappyHourDiscount").textContent = "-" + formatMoney(totals.happyHourDiscount);
  $("#cartService").textContent = formatMoney(totals.serviceCharge);
  $("#cartTax").textContent = formatMoney(totals.tax);
  $("#cartTotal").textContent = formatMoney(totals.total);
  $("#cartServiceRow").classList.toggle("hidden", !(STATE.settings.serviceRate > 0));
  $("#cartTaxRow").classList.toggle("hidden", !(STATE.settings.taxRate > 0));
}

function computeCartTotals() {
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);

  const hh = STATE.settings.happyHour;
  const happyHourActive = isHappyHourActiveNow();
  let happyHourDiscount = 0;
  if (happyHourActive) {
    cart.forEach(c => {
      const item = STATE.menu.find(m => m.id === c.menuItemId);
      if (item && item.category === hh.categoryName) {
        happyHourDiscount += Math.floor(c.qty / 2) * c.price;
      }
    });
  }

  const netSubtotal = subtotal - happyHourDiscount;
  const serviceCharge = netSubtotal * (Number(STATE.settings.serviceRate) || 0) / 100;
  const tax = netSubtotal * (Number(STATE.settings.taxRate) || 0) / 100;
  const total = netSubtotal + serviceCharge + tax;
  return { subtotal, happyHourDiscount, happyHourActive, netSubtotal, serviceCharge, tax, total };
}

/* ----- checkout ----- */

/* ----- Senior Citizen / PWD discount (RA 9994 / RA 10754) -----
   Standard BIR computation: strip the 12% VAT already embedded in the marked price,
   then take 20% off the VAT-exempt amount. No additional VAT/tax is charged on top,
   since it was just exempted. Assumes the whole order is for the one qualifying diner —
   for group bills, only that diner's own items should really be rung up separately. */
function computeCheckoutTotals() {
  const base = computeCartTotals();
  const discountType = $("#checkoutDiscountType") ? $("#checkoutDiscountType").value : "none";

  if (discountType === "none") {
    return { ...base, discountType: "none", seniorPwdDiscount: 0, discountedBase: base.netSubtotal };
  }

  const vatExemptSales = base.netSubtotal / 1.12;
  const seniorPwdDiscount = vatExemptSales * 0.20;
  const discountedBase = vatExemptSales - seniorPwdDiscount;
  const serviceCharge = discountedBase * (Number(STATE.settings.serviceRate) || 0) / 100;
  const total = discountedBase + serviceCharge;
  return {
    ...base,
    discountType, vatExemptSales, seniorPwdDiscount, discountedBase,
    serviceCharge, tax: 0, total
  };
}

function renderCheckoutBreakdown() {
  const totals = computeCheckoutTotals();
  $("#checkoutSubtotalDisplay").textContent = formatMoney(totals.subtotal);
  $("#checkoutHappyHourRow").classList.toggle("hidden", !(totals.happyHourDiscount > 0));
  $("#checkoutHappyHourDisplay").textContent = "-" + formatMoney(totals.happyHourDiscount);
  $("#checkoutDiscountRow").classList.toggle("hidden", totals.discountType === "none");
  $("#checkoutDiscountDisplay").textContent = "-" + formatMoney(totals.seniorPwdDiscount || 0);
  $("#checkoutServiceRow").classList.toggle("hidden", !(totals.serviceCharge > 0));
  $("#checkoutServiceDisplay").textContent = formatMoney(totals.serviceCharge);
  $("#checkoutTaxRow").classList.toggle("hidden", !(totals.tax > 0));
  $("#checkoutTaxDisplay").textContent = formatMoney(totals.tax);
  $("#checkoutTotalDisplay").textContent = formatMoney(totals.total);
  updateChangeDisplay();
  return totals;
}

function openCheckoutModal() {
  if (cart.length === 0) { alert("Add at least one item to the order first."); return; }
  $("#checkoutDiscountType").value = "none";
  $("#checkoutDiscountFields").classList.add("hidden");
  $("#checkoutDiscountName").value = "";
  $("#checkoutDiscountIdNumber").value = "";
  $("#checkoutCashTendered").value = "";
  $("#checkoutPaymentMethod").value = "Cash";
  $("#cashTenderedWrap").classList.remove("hidden");
  renderCheckoutBreakdown();
  $("#checkoutModal").classList.remove("hidden");
}
function closeCheckoutModal() { $("#checkoutModal").classList.add("hidden"); }

function updateChangeDisplay() {
  const totals = computeCheckoutTotals();
  const tendered = Number($("#checkoutCashTendered").value) || 0;
  const change = Math.max(0, tendered - totals.total);
  $("#checkoutChangeDisplay").textContent = formatMoney(change);
}

function confirmCheckout() {
  const totals = computeCheckoutTotals();
  const method = $("#checkoutPaymentMethod").value;
  const tendered = method === "Cash" ? (Number($("#checkoutCashTendered").value) || 0) : totals.total;
  if (method === "Cash" && tendered < totals.total) {
    alert("Cash tendered is less than the total due.");
    return;
  }
  if (totals.discountType !== "none" && !$("#checkoutDiscountIdNumber").value.trim()) {
    alert("Enter the Senior Citizen / PWD ID number before completing the order — it's required on the receipt for the discount to be valid.");
    return;
  }
  const change = method === "Cash" ? tendered - totals.total : 0;

  const orderItems = cart.map(c => ({
    menuItemId: c.menuItemId, name: c.name, price: c.price, qty: c.qty, subtotal: c.price * c.qty,
    ...(c.bucketMix ? { bucketMix: c.bucketMix } : {})
  }));

  const order = {
    id: uid("ord"),
    orderNo: "QQ-" + String(STATE.nextOrderNo).padStart(6, "0"),
    timestamp: Date.now(),
    items: orderItems,
    subtotal: totals.subtotal,
    happyHourDiscount: totals.happyHourDiscount,
    discountType: totals.discountType,
    seniorPwdDiscount: totals.seniorPwdDiscount || 0,
    discountHolderName: totals.discountType !== "none" ? $("#checkoutDiscountName").value.trim() : "",
    discountIdNumber: totals.discountType !== "none" ? $("#checkoutDiscountIdNumber").value.trim() : "",
    serviceCharge: totals.serviceCharge,
    tax: totals.tax,
    total: totals.total,
    payment: method,
    tendered,
    change,
    status: "completed"
  };
  STATE.nextOrderNo += 1;
  STATE.orders.push(order);

  deductInventoryForOrder(order);
  saveState();

  cart = [];
  closeCheckoutModal();
  showReceipt(order);
  renderPOS();
  renderDashboard();
  renderInventoryTable();
}

function deductInventoryForOrder(order, reverse) {
  const sign = reverse ? 1 : -1;
  order.items.forEach(oi => {
    if (oi.bucketMix) {
      oi.bucketMix.forEach(bm => {
        const inv = STATE.inventory.find(i => i.id === bm.inventoryId);
        if (!inv) return;
        inv.qty = Math.max(0, Math.round((inv.qty + sign * bm.qty * oi.qty) * 1000) / 1000);
      });
      return;
    }
    const lines = STATE.recipes[oi.menuItemId];
    if (!lines) return;
    lines.forEach(rl => {
      const inv = STATE.inventory.find(i => i.id === rl.inventoryId);
      if (!inv) return;
      inv.qty = Math.max(0, Math.round((inv.qty + sign * rl.qty * oi.qty) * 1000) / 1000);
    });
  });
}

/* ----- receipt ----- */

function showReceipt(order) {
  const s = STATE.settings;
  const lines = order.items.map(it => {
    const mixLine = it.bucketMix
      ? `<div class="r-row"><span style="padding-left:10px;font-size:11px;">${it.bucketMix.map(x => `${x.qty}x ${escapeHtml(x.name)}`).join(", ")}</span></div>`
      : "";
    return `<div class="r-row"><span>${escapeHtml(it.qty)}x ${escapeHtml(it.name)}</span><span>${formatMoney(it.subtotal)}</span></div>${mixLine}`;
  }).join("");
  const html = `
    <div class="r-center"><strong>${escapeHtml(s.restaurantName)}</strong><br>${escapeHtml(order.orderNo)}<br>${formatDateTime(order.timestamp)}</div>
    <hr>
    ${lines}
    <hr>
    <div class="r-row"><span>Subtotal</span><span>${formatMoney(order.subtotal)}</span></div>
    ${order.happyHourDiscount > 0 ? `<div class="r-row"><span>🎉 Happy Hour BOGO</span><span>-${formatMoney(order.happyHourDiscount)}</span></div>` : ""}
    ${order.discountType && order.discountType !== "none" ? `<div class="r-row"><span>${order.discountType === "senior" ? "Senior Citizen" : "PWD"} Discount (20% + VAT ex.)</span><span>-${formatMoney(order.seniorPwdDiscount)}</span></div>` : ""}
    ${order.serviceCharge > 0 ? `<div class="r-row"><span>Service Charge</span><span>${formatMoney(order.serviceCharge)}</span></div>` : ""}
    ${order.tax > 0 ? `<div class="r-row"><span>Tax</span><span>${formatMoney(order.tax)}</span></div>` : ""}
    <div class="r-row r-total"><span>TOTAL</span><span>${formatMoney(order.total)}</span></div>
    ${order.discountType && order.discountType !== "none" ? `<hr><div class="r-row"><span style="font-size:11px;">${order.discountType === "senior" ? "SC" : "PWD"} Name</span><span style="font-size:11px;">${escapeHtml(order.discountHolderName || "-")}</span></div><div class="r-row"><span style="font-size:11px;">ID No.</span><span style="font-size:11px;">${escapeHtml(order.discountIdNumber || "-")}</span></div>` : ""}
    <hr>
    <div class="r-row"><span>Payment (${escapeHtml(order.payment)})</span><span>${formatMoney(order.tendered)}</span></div>
    <div class="r-row"><span>Change</span><span>${formatMoney(order.change)}</span></div>
    <hr>
    <div class="r-center">${escapeHtml(s.receiptFooter)}</div>
  `;
  $("#receiptContent").innerHTML = html;
  receiptOrderId = order.id;
  $("#receiptVoidBtn").classList.remove("hidden");
  $("#receiptModal").classList.remove("hidden");
}

/* ==========================================================================
   MENU MANAGEMENT
   ========================================================================== */

function populateMenuCategorySelects() {
  const cats = getAllCategories();
  const filterSel = $("#menuCategoryFilter");
  const current = filterSel.value;
  filterSel.innerHTML = `<option value="">All Categories</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  filterSel.value = current;

  const itemSel = $("#menuItemCategory");
  itemSel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("") + `<option value="__new__">+ Add New Category</option>`;
}

function openCategoryManagerModal() {
  const cats = getAllCategories();
  const list = $("#categoryManagerList");
  list.innerHTML = cats.map(c => {
    const count = STATE.menu.filter(m => m.category === c).length;
    const currentGroup = getCategoryGroup(c);
    return `<div class="category-row" data-original="${escapeHtml(c)}">
      <input type="text" value="${escapeHtml(c)}">
      <select class="category-group-select">
        ${CATEGORY_GROUP_OPTIONS.map(g => `<option value="${g}" ${g === currentGroup ? "selected" : ""}>${g}</option>`).join("")}
      </select>
      <span class="muted">${count} item${count === 1 ? "" : "s"}</span>
    </div>`;
  }).join("");
  $("#categoryManagerModal").classList.remove("hidden");
}
function closeCategoryManagerModal() { $("#categoryManagerModal").classList.add("hidden"); }

function saveCategoryChanges() {
  const rows = $all(".category-row", $("#categoryManagerList"));
  let renamed = 0, regrouped = 0;
  rows.forEach(row => {
    const original = row.dataset.original;
    const newValue = row.querySelector("input").value;
    const selectedGroup = row.querySelector(".category-group-select").value;
    let finalName = original;
    if (newValue.trim() && newValue.trim() !== original) {
      if (renameCategory(original, newValue)) { renamed++; finalName = newValue.trim(); }
    }
    if (!STATE.categoryGroups) STATE.categoryGroups = {};
    if (getCategoryGroup(finalName) !== selectedGroup) {
      STATE.categoryGroups[finalName] = selectedGroup;
      regrouped++;
    }
  });
  if (renamed > 0 || regrouped > 0) {
    saveState();
    renderMenuTable();
    renderPOS();
    renderDashboard();
  }
  closeCategoryManagerModal();
}

function renderMenuTable() {
  populateMenuCategorySelects();
  const catFilter = $("#menuCategoryFilter").value;
  const search = $("#menuSearchInput").value.trim().toLowerCase();

  const rows = sortMenuByCategory(STATE.menu.filter(m =>
    (!catFilter || m.category === catFilter) &&
    (!search || m.name.toLowerCase().includes(search))
  ));

  const tbody = $("#menuTable tbody");
  let lastCategory = null;
  tbody.innerHTML = rows.length ? rows.map(m => {
    const recipeLines = STATE.recipes[m.id] || [];
    const validCount = recipeLines.filter(r => STATE.inventory.some(i => i.id === r.inventoryId)).length;
    const brokenCount = recipeLines.length - validCount;
    let ingredientsCell = '<span class="muted">none</span>';
    if (recipeLines.length > 0) {
      ingredientsCell = validCount > 0 ? `${validCount} linked` : "";
      if (brokenCount > 0) {
        ingredientsCell += `${validCount > 0 ? " · " : ""}<span class="error-text" title="These ingredient(s) no longer exist in Inventory, so stock won't deduct for them. Re-open this item and re-link the ingredient.">⚠ ${brokenCount} broken link${brokenCount > 1 ? "s" : ""}</span>`;
      }
    }
    let headerRow = "";
    if (!catFilter && m.category !== lastCategory) {
      lastCategory = m.category;
      headerRow = `<tr class="category-divider"><td colspan="6">${escapeHtml(m.category)}</td></tr>`;
    }
    return headerRow + `<tr class="${!m.active ? "inactive" : ""}" data-id="${m.id}">
      <td class="menu-name-cell">${m.image ? `<img src="${m.image}" class="menu-thumb" alt="">` : `<span class="menu-thumb menu-thumb-empty"></span>`}${escapeHtml(m.name)}</td>
      <td>${escapeHtml(m.category)}</td>
      <td>${m.price > 0 ? formatMoney(m.price) : '<span class="muted">not set</span>'}</td>
      <td>${ingredientsCell}</td>
      <td>${!m.active ? "Hidden" : m.onHold ? '<span class="error-text">On Hold</span>' : "Active"}</td>
      <td>
        <button class="btn btn-secondary btn-small" data-act="hold">${m.onHold ? "Resume" : "Put On Hold"}</button>
        <button class="btn btn-secondary btn-small" data-act="edit">Edit</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">No menu items match.</td></tr>`;

  $all("tr[data-id]", tbody).forEach(tr => {
    tr.querySelector('[data-act="hold"]').addEventListener("click", () => toggleMenuItemHold(tr.dataset.id));
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openMenuItemModal(tr.dataset.id));
  });
}

function openMenuItemModal(id) {
  editingMenuId = id || null;
  populateMenuCategorySelects();
  $("#menuItemModalTitle").textContent = id ? "Edit Menu Item" : "Add Menu Item";
  $("#menuItemDeleteBtn").classList.toggle("hidden", !id);

  menuItemImageDraft = undefined;
  if (id) {
    const m = STATE.menu.find(x => x.id === id);
    $("#menuItemId").value = m.id;
    $("#menuItemName").value = m.name;
    $("#menuItemCategory").value = m.category;
    $("#menuItemPrice").value = m.price;
    $("#menuItemActive").checked = m.active;
    recipeDraft = (STATE.recipes[id] || []).map(x => ({ ...x }));
    setMenuImagePreview(m.image || null);
  } else {
    $("#menuItemId").value = "";
    $("#menuItemName").value = "";
    $("#menuItemCategory").value = BASE_CATEGORIES[0];
    $("#menuItemPrice").value = "";
    $("#menuItemActive").checked = true;
    recipeDraft = [];
    setMenuImagePreview(null);
  }
  populateIngredientSelect();
  renderRecipeDraftList();
  $("#menuItemModal").classList.remove("hidden");
}
function closeMenuItemModal() { $("#menuItemModal").classList.add("hidden"); }

function setMenuImagePreview(src) {
  const img = $("#menuItemImagePreview");
  const removeBtn = $("#menuItemImageRemoveBtn");
  if (src) {
    img.src = src;
    img.classList.remove("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    removeBtn.classList.add("hidden");
  }
}

function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read image."));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleMenuImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { alert("Please choose an image file."); return; }
  try {
    const dataUrl = await resizeImageFile(file, 500, 0.75);
    menuItemImageDraft = dataUrl;
    setMenuImagePreview(dataUrl);
  } catch (e) {
    alert("Could not load that image: " + e.message);
  }
}

function populateIngredientSelect() {
  const sel = $("#recipeIngredientSelect");
  if (STATE.inventory.length === 0) {
    sel.innerHTML = `<option value="">Add inventory items first</option>`;
    return;
  }
  sel.innerHTML = STATE.inventory.map(i => `<option value="${i.id}">${escapeHtml(i.name)} — ${i.qty} ${escapeHtml(i.unit)} on hand</option>`).join("");
}

function renderRecipeDraftList() {
  const wrap = $("#menuItemRecipeList");
  if (recipeDraft.length === 0) {
    wrap.innerHTML = `<p class="muted recipe-empty-state">No ingredients linked yet. Pick one below and click + Add. Stock won't auto-deduct until you do.</p>`;
    return;
  }
  wrap.innerHTML = recipeDraft.map((rl, idx) => {
    const inv = STATE.inventory.find(i => i.id === rl.inventoryId);
    const label = inv ? `${escapeHtml(inv.name)} (${inv.qty} ${escapeHtml(inv.unit)} on hand) — ${rl.qty} ${escapeHtml(inv.unit)} / serving` : `<span class="error-text">⚠ Missing ingredient (was deleted from Inventory) — stock won't deduct. Remove this line and re-add it.</span>`;
    return `<div class="recipe-line" data-idx="${idx}"><span>${label}</span><span class="cl-remove" data-act="remove">✕</span></div>`;
  }).join("");
  $all(".recipe-line", wrap).forEach(el => {
    el.querySelector('[data-act="remove"]').addEventListener("click", () => {
      recipeDraft.splice(Number(el.dataset.idx), 1);
      renderRecipeDraftList();
    });
  });
}

function addRecipeLine() {
  const invId = $("#recipeIngredientSelect").value;
  const qty = Number($("#recipeIngredientQty").value);
  if (!invId) { alert("Select an ingredient (add one in Inventory first)."); return; }
  if (!qty || qty <= 0) { alert("Enter a quantity greater than 0."); return; }
  const existing = recipeDraft.find(r => r.inventoryId === invId);
  if (existing) existing.qty = qty;
  else recipeDraft.push({ inventoryId: invId, qty });
  $("#recipeIngredientQty").value = "";
  renderRecipeDraftList();
}

function saveMenuItem() {
  const name = $("#menuItemName").value.trim();
  let category = $("#menuItemCategory").value;
  if (category === "__new__") {
    category = prompt("New category name:", "");
    if (!category || !category.trim()) return;
    category = category.trim();
    if (!STATE.categories.includes(category)) STATE.categories.push(category);
  }
  const price = Number($("#menuItemPrice").value) || 0;
  const active = $("#menuItemActive").checked;

  if (!name) { alert("Please enter an item name."); return; }

  if (editingMenuId) {
    const m = STATE.menu.find(x => x.id === editingMenuId);
    m.name = name; m.category = category; m.price = price; m.active = active;
    if (menuItemImageDraft !== undefined) m.image = menuItemImageDraft;
    if (recipeDraft.length) STATE.recipes[editingMenuId] = recipeDraft; else delete STATE.recipes[editingMenuId];
  } else {
    const id = uid("mi") + "-" + slug(category) + "-" + slug(name);
    STATE.menu.push({ id, name, category, price, active, image: menuItemImageDraft || null });
    if (recipeDraft.length) STATE.recipes[id] = recipeDraft;
  }
  saveState();
  closeMenuItemModal();
  renderMenuTable();
  renderPOS();
  renderDashboard();
}

function deleteMenuItem() {
  if (!editingMenuId) return;
  if (!confirm("Delete this menu item? This cannot be undone.")) return;
  STATE.menu = STATE.menu.filter(m => m.id !== editingMenuId);
  delete STATE.recipes[editingMenuId];
  saveState();
  closeMenuItemModal();
  renderMenuTable();
  renderPOS();
  renderDashboard();
}

function fillDefaultMenuPhotos() {
  const proceed = confirm(
    "This fills in free stock placeholder photos for generic dishes that don't already have a " +
    "photo (pizzas, pasta, burgers, fries, wings, etc.). Specific Filipino dishes without a good " +
    "free-photo match (Cansi Steak, Tokwat & Baboy, Sisig, Salpicao, Bangus, Inasal, etc.) are left " +
    "blank on purpose — add those yourself once you have real photos from the cafe.\n\n" +
    "Items that already have a photo are left untouched. Continue?"
  );
  if (!proceed) return;

  let filled = 0;
  STATE.menu.forEach(m => {
    if (m.image) return;
    const defaultImg = lookupDefaultImage(m.category, m.name);
    if (defaultImg) { m.image = defaultImg; filled++; }
  });

  saveState();
  renderMenuTable();
  renderPOS();
  alert(filled > 0
    ? `Added ${filled} placeholder photo${filled === 1 ? "" : "s"}. Replace them with real cafe photos anytime via Menu > Edit item > Choose Image.`
    : "No matching placeholder photos found — everything either already has a photo or is a dish without a good free-stock match.");
}

/* ==========================================================================
   INVENTORY
   ========================================================================== */

function getInventoryItemCategories(invId) {
  const cats = new Set();
  Object.keys(STATE.recipes).forEach(menuId => {
    if (STATE.recipes[menuId].some(rl => rl.inventoryId === invId)) {
      const m = STATE.menu.find(x => x.id === menuId);
      if (m) cats.add(m.category);
    }
  });
  STATE.menu.forEach(m => {
    if (m.bucket && m.bucket.optionInventoryIds.includes(invId)) cats.add(m.category);
  });
  return cats;
}

function getLinkedMenuItemNames(invId) {
  const names = new Set();
  Object.keys(STATE.recipes).forEach(menuId => {
    if (STATE.recipes[menuId].some(rl => rl.inventoryId === invId)) {
      const m = STATE.menu.find(x => x.id === menuId);
      if (m) names.add(m.name);
    }
  });
  STATE.menu.forEach(m => {
    if (m.bucket && m.bucket.optionInventoryIds.includes(invId)) names.add(`${m.name} (bucket option)`);
  });
  return Array.from(names);
}

function getLinkedMenuItems(invId) {
  const items = new Set();
  Object.keys(STATE.recipes).forEach(menuId => {
    if (STATE.recipes[menuId].some(rl => rl.inventoryId === invId)) {
      const m = STATE.menu.find(x => x.id === menuId);
      if (m) items.add(m);
    }
  });
  STATE.menu.forEach(m => {
    if (m.bucket && m.bucket.optionInventoryIds.includes(invId)) items.add(m);
  });
  return Array.from(items);
}

// An ingredient only used by dish(es) that are all currently On Hold (or hidden) isn't
// worth flagging as low stock — nobody's selling it right now, so there's no urgency.
// Unlinked ingredients are never exempt this way; that's a separate "unused" concern.
function isInventoryItemExemptFromLowStock(invId) {
  const linked = getLinkedMenuItems(invId);
  if (linked.length === 0) return false;
  return linked.every(m => m.onHold || !m.active);
}

let onHoldPanelExpanded = false;

function renderOnHoldPanel() {
  const onHoldItems = STATE.menu.filter(m => m.onHold);
  $("#onHoldPanel").classList.toggle("hidden", onHoldItems.length === 0);
  $("#onHoldCount").textContent = onHoldItems.length;
  $("#onHoldContent").classList.toggle("hidden", !onHoldPanelExpanded);
  $("#onHoldCaret").textContent = onHoldPanelExpanded ? "▴" : "▾";
  const ohBody = $("#onHoldTable tbody");
  ohBody.innerHTML = onHoldItems.length
    ? onHoldItems.map(m => `<tr class="low-stock"><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.category)}</td></tr>`).join("")
    : "";
}

function toggleOnHoldPanel() {
  onHoldPanelExpanded = !onHoldPanelExpanded;
  renderOnHoldPanel();
}

function renderInventoryCategoryTabs() {
  const catTabs = $("#inventoryCategoryTabs");
  const catCounts = {};
  let unassignedCount = 0;
  STATE.inventory.forEach(i => {
    const cats = getInventoryItemCategories(i.id);
    if (cats.size === 0) { unassignedCount++; return; }
    cats.forEach(c => { catCounts[c] = (catCounts[c] || 0) + 1; });
  });

  const groupIcons = { Food: "🍽️", Beverages: "🥤", Promos: "🎉", Other: "🗂️" };
  const groups = {};
  Object.keys(catCounts).forEach(c => {
    const g = getCategoryGroup(c);
    (groups[g] = groups[g] || []).push(c);
  });
  const order = CATEGORY_GROUP_OPTIONS.filter(g => groups[g] && groups[g].length);

  catTabs.innerHTML =
    `<button class="pos-toplevel-btn ${invSelectedCategory === "All" ? "active" : ""}" data-cat="All">All</button>` +
    order.map(group => {
      const categories = groups[group];
      const isGroupActive = categories.includes(invSelectedCategory);
      return `
      <div class="pos-group-dropdown">
        <button type="button" class="pos-group-toggle ${isGroupActive ? "active" : ""}" data-group="${escapeHtml(group)}">
          ${groupIcons[group] || ""} ${escapeHtml(group)} <span class="dropdown-caret">▾</span>
        </button>
        <div class="pos-group-menu">
          ${categories.map(c => `<button class="${c === invSelectedCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="muted">(${catCounts[c]})</span></button>`).join("")}
        </div>
      </div>`;
    }).join("") +
    (unassignedCount > 0 ? `<button class="pos-toplevel-btn ${invSelectedCategory === "Unassigned" ? "active" : ""}" data-cat="Unassigned">Unlinked (${unassignedCount})</button>` : "");

  $all("button[data-cat]", catTabs).forEach(b => b.addEventListener("click", () => {
    invSelectedCategory = b.dataset.cat;
    renderInventoryTable();
  }));
  $all(".pos-group-toggle", catTabs).forEach(toggle => toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = toggle.nextElementSibling;
    const wasOpen = menu.classList.contains("open");
    $all(".pos-group-menu.open", catTabs).forEach(m => m.classList.remove("open"));
    if (!wasOpen) menu.classList.add("open");
  }));
}

function renderInventoryTable() {
  renderOnHoldPanel();
  renderInventoryCategoryTabs();
  const search = $("#inventorySearchInput").value.trim().toLowerCase();
  const lowOnly = $("#lowStockOnlyToggle").checked;
  const rows = STATE.inventory.filter(i =>
    (!search || i.name.toLowerCase().includes(search)) &&
    (!lowOnly || (i.qty <= i.reorderLevel && !isInventoryItemExemptFromLowStock(i.id))) &&
    (invSelectedCategory === "All" ||
      (invSelectedCategory === "Unassigned"
        ? getInventoryItemCategories(i.id).size === 0
        : getInventoryItemCategories(i.id).has(invSelectedCategory)))
  ).sort((a, b) => {
    const aLow = a.qty <= a.reorderLevel && !isInventoryItemExemptFromLowStock(a.id);
    const bLow = b.qty <= b.reorderLevel && !isInventoryItemExemptFromLowStock(b.id);
    if (aLow !== bLow) return aLow ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const tbody = $("#inventoryTable tbody");
  let seenLowHeader = false, seenNormalHeader = false;
  const hasAnyLow = rows.some(i => i.qty <= i.reorderLevel && !isInventoryItemExemptFromLowStock(i.id));
  const hasAnyNormal = rows.some(i => !(i.qty <= i.reorderLevel && !isInventoryItemExemptFromLowStock(i.id)));
  // drop selections for items no longer present (deleted/merged elsewhere)
  const liveIds = new Set(STATE.inventory.map(i => i.id));
  Array.from(selectedInventoryIds).forEach(id => { if (!liveIds.has(id)) selectedInventoryIds.delete(id); });

  tbody.innerHTML = rows.length ? rows.map(i => {
    const isLow = i.qty <= i.reorderLevel && !isInventoryItemExemptFromLowStock(i.id);
    let headerRow = "";
    if (hasAnyLow && isLow && !seenLowHeader) {
      seenLowHeader = true;
      headerRow = `<tr class="category-divider low"><td colspan="8">⚠ Needs Restocking</td></tr>`;
    } else if (hasAnyLow && hasAnyNormal && !isLow && !seenNormalHeader) {
      seenNormalHeader = true;
      headerRow = `<tr class="category-divider"><td colspan="8">Stock OK</td></tr>`;
    }
    const linkedItems = getLinkedMenuItems(i.id);
    const usedBy = getLinkedMenuItemNames(i.id);
    const usedByCell = usedBy.length
      ? `<span title="${escapeHtml(usedBy.join(", "))}">${escapeHtml(usedBy.slice(0, 2).join(", "))}${usedBy.length > 2 ? ` <span class="muted">+${usedBy.length - 2} more</span>` : ""}</span>`
      : `<span class="error-text">⚠ none — unused</span>`;
    const allHeld = linkedItems.length > 0 && linkedItems.every(m => m.onHold);
    const holdBtn = linkedItems.length > 0
      ? `<button class="btn btn-secondary btn-small" data-act="hold">${allHeld ? "Resume" : "Put On Hold"}</button>`
      : "";
    return headerRow + `
    <tr class="${isLow ? "low-stock" : ""}" data-id="${i.id}">
      <td><input type="checkbox" class="inventory-row-checkbox" data-id="${i.id}" ${selectedInventoryIds.has(i.id) ? "checked" : ""}></td>
      <td>${isLow ? "⚠ " : ""}${escapeHtml(i.name)}</td>
      <td>${i.qty}</td>
      <td>${escapeHtml(i.unit)}</td>
      <td>${i.reorderLevel}</td>
      <td>${formatMoney(i.cost)}</td>
      <td>${usedByCell}</td>
      <td>
        <button class="btn btn-secondary btn-small" data-act="adjust">Adjust</button>
        <button class="btn btn-secondary btn-small" data-act="history">History</button>
        <button class="btn btn-secondary btn-small" data-act="merge">Merge</button>
        ${holdBtn}
        <button class="btn btn-secondary btn-small" data-act="edit">Edit</button>
        <button class="btn btn-danger btn-small" data-act="remove">Remove</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="muted">No inventory items yet. Add ingredients to enable auto stock deduction.</td></tr>`;

  $all("tr[data-id]", tbody).forEach(tr => {
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openInventoryItemModal(tr.dataset.id));
    tr.querySelector('[data-act="adjust"]').addEventListener("click", () => openStockAdjustModal(tr.dataset.id));
    tr.querySelector('[data-act="history"]').addEventListener("click", () => openStockHistoryModal(tr.dataset.id));
    tr.querySelector('[data-act="merge"]').addEventListener("click", () => openMergeInventoryModal(tr.dataset.id));
    tr.querySelector('[data-act="remove"]').addEventListener("click", () => removeSingleInventoryItem(tr.dataset.id));
    const holdBtnEl = tr.querySelector('[data-act="hold"]');
    if (holdBtnEl) holdBtnEl.addEventListener("click", () => toggleHoldForLinkedMenuItems(tr.dataset.id));
    tr.querySelector(".inventory-row-checkbox").addEventListener("change", (e) => {
      if (e.target.checked) selectedInventoryIds.add(tr.dataset.id);
      else selectedInventoryIds.delete(tr.dataset.id);
      updateInventoryDeleteSelectedButton();
    });
  });

  updateInventoryDeleteSelectedButton();
  renderDashboard();
}

function updateInventoryDeleteSelectedButton() {
  const btn = $("#inventoryDeleteSelectedBtn");
  const count = selectedInventoryIds.size;
  btn.textContent = `Delete Selected (${count})`;
  btn.classList.toggle("hidden", count === 0);

  const visibleCbs = $all(".inventory-row-checkbox");
  const selectAll = $("#inventorySelectAllCheckbox");
  const checkedCount = visibleCbs.filter(cb => cb.checked).length;
  selectAll.checked = visibleCbs.length > 0 && checkedCount === visibleCbs.length;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCbs.length;
}

function toggleSelectAllInventory() {
  const checked = $("#inventorySelectAllCheckbox").checked;
  $all(".inventory-row-checkbox").forEach(cb => {
    cb.checked = checked;
    if (checked) selectedInventoryIds.add(cb.dataset.id);
    else selectedInventoryIds.delete(cb.dataset.id);
  });
  updateInventoryDeleteSelectedButton();
}

// Shared removal used by the single quick-Remove button, the Edit modal's Delete
// button, and bulk "Delete Selected" — cleans up every reference so nothing is
// left pointing at a deleted ingredient (recipes, bucket options).
function removeInventoryItems(ids) {
  ids.forEach(id => {
    STATE.inventory = STATE.inventory.filter(i => i.id !== id);
    Object.keys(STATE.recipes).forEach(menuId => {
      STATE.recipes[menuId] = STATE.recipes[menuId].filter(r => r.inventoryId !== id);
      if (STATE.recipes[menuId].length === 0) delete STATE.recipes[menuId];
    });
    STATE.menu.forEach(m => {
      if (m.bucket) m.bucket.optionInventoryIds = m.bucket.optionInventoryIds.filter(oid => oid !== id);
    });
    selectedInventoryIds.delete(id);
  });
}

function removeSingleInventoryItem(id) {
  const item = STATE.inventory.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Remove "${item.name}" from Inventory? Any menu item linked to it will lose that link and stop auto-deducting stock. This cannot be undone.`)) return;
  removeInventoryItems([id]);
  saveState();
  renderInventoryTable();
  renderMenuTable();
}

function deleteSelectedInventory() {
  const ids = Array.from(selectedInventoryIds);
  if (ids.length === 0) return;
  const names = ids.map(id => { const i = STATE.inventory.find(x => x.id === id); return i ? i.name : null; }).filter(Boolean);
  if (!confirm(
    `Delete ${ids.length} ingredient${ids.length === 1 ? "" : "s"}?\n\n${names.join(", ")}\n\n` +
    `Any menu items linked to these will lose that link and stop auto-deducting stock. This cannot be undone.`
  )) return;

  removeInventoryItems(ids);
  saveState();
  renderInventoryTable();
  renderMenuTable();
}

function openInventoryItemModal(id) {
  editingInventoryId = id || null;
  $("#inventoryItemModalTitle").textContent = id ? "Edit Ingredient" : "Add Ingredient";
  $("#inventoryItemDeleteBtn").classList.toggle("hidden", !id);
  if (id) {
    const i = STATE.inventory.find(x => x.id === id);
    $("#inventoryItemId").value = i.id;
    $("#inventoryItemName").value = i.name;
    $("#inventoryItemUnit").value = i.unit;
    $("#inventoryItemQty").value = i.qty;
    $("#inventoryItemReorder").value = i.reorderLevel;
    $("#inventoryItemCost").value = i.cost;
  } else {
    $("#inventoryItemId").value = "";
    $("#inventoryItemName").value = "";
    $("#inventoryItemUnit").value = "";
    $("#inventoryItemQty").value = 0;
    $("#inventoryItemReorder").value = 0;
    $("#inventoryItemCost").value = 0;
  }
  $("#inventoryItemModal").classList.remove("hidden");
}
function closeInventoryItemModal() { $("#inventoryItemModal").classList.add("hidden"); }

function saveInventoryItem() {
  const name = $("#inventoryItemName").value.trim();
  const unit = $("#inventoryItemUnit").value.trim() || "pcs";
  const qty = Number($("#inventoryItemQty").value) || 0;
  const reorderLevel = Number($("#inventoryItemReorder").value) || 0;
  const cost = Number($("#inventoryItemCost").value) || 0;
  if (!name) { alert("Please enter an ingredient name."); return; }

  const duplicate = STATE.inventory.find(i => i.id !== editingInventoryId && i.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    const proceed = confirm(
      `You already have an ingredient named "${duplicate.name}" (${duplicate.qty} ${duplicate.unit} on hand).\n\n` +
      `Adding another with the same name makes them impossible to tell apart in lists, and a recipe can only ` +
      `deduct from one of them — this is a common cause of "stock isn't dropping" confusion.\n\n` +
      `If you meant to restock the existing one, click Cancel and use Adjust Stock instead. Continue and create a duplicate anyway?`
    );
    if (!proceed) return;
  }

  if (editingInventoryId) {
    const i = STATE.inventory.find(x => x.id === editingInventoryId);
    i.name = name; i.unit = unit; i.qty = qty; i.reorderLevel = reorderLevel; i.cost = cost;
  } else {
    STATE.inventory.push({ id: uid("inv"), name, unit, qty, reorderLevel, cost });
  }
  saveState();
  closeInventoryItemModal();
  renderInventoryTable();
}

function deleteInventoryItem() {
  if (!editingInventoryId) return;
  if (!confirm("Delete this ingredient? Any menu items linked to it will lose that link.")) return;
  removeInventoryItems([editingInventoryId]);
  saveState();
  closeInventoryItemModal();
  renderInventoryTable();
  renderMenuTable();
}

function bulkAddInventoryForMenu() {
  const proceed = confirm(
    "This will create an Inventory item for every Menu item that doesn't already have one, " +
    "and auto-link it so 1 order deducts 1 unit — the same way you set up Cansi Steak by hand.\n\n" +
    "If a dish name already exists in Inventory (something you set up manually), that item is reused. " +
    "Dishes that share a name across different categories (e.g. a Pizza and a Pasta both called " +
    "\"Carbonara\") get their own separate inventory items labeled with their category, so ringing up " +
    "one never deducts stock meant for the other.\n\n" +
    "Existing ingredients and recipe links are left untouched. Continue?"
  );
  if (!proceed) return;

  // Menu items sharing a name across different categories are treated as different
  // trackable stock — otherwise ordering one would silently deduct the other's stock.
  const nameToCategories = {};
  STATE.menu.forEach(m => {
    const key = m.name.trim().toLowerCase();
    (nameToCategories[key] = nameToCategories[key] || new Set()).add(m.category);
  });
  const preExistingNames = new Set(STATE.inventory.map(i => i.name.trim().toLowerCase()));

  let created = 0, linked = 0;
  STATE.menu.forEach(m => {
    // already has ingredient(s) linked (e.g. shares Dough or Chicken Wings with other
    // items in its category) — nothing to add, and no orphaned inventory row to create.
    // Bucket items (Bucket of Beers) track stock through their own bottle options instead
    // of a normal recipe, so they need to be skipped here too, or this creates a bogus
    // "Bucket of Beers" inventory row that never actually gets used or restocked.
    if ((STATE.recipes[m.id] || []).length > 0 || m.bucket) return;

    const lname = m.name.trim().toLowerCase();
    const isCrossCategoryDuplicate = nameToCategories[lname].size > 1;
    const invName = isCrossCategoryDuplicate ? `${m.name} (${m.category})` : m.name;

    let inv = STATE.inventory.find(i => i.name.trim().toLowerCase() === invName.trim().toLowerCase());
    if (!inv && !isCrossCategoryDuplicate && preExistingNames.has(lname)) {
      inv = STATE.inventory.find(i => i.name.trim().toLowerCase() === lname);
    }
    if (!inv) {
      inv = { id: uid("inv"), name: invName, unit: "pcs", qty: 0, reorderLevel: 5, cost: 0 };
      STATE.inventory.push(inv);
      created++;
    }

    STATE.recipes[m.id] = [{ inventoryId: inv.id, qty: 1 }];
    linked++;
  });

  saveState();
  renderInventoryTable();
  renderMenuTable();
  renderDashboard();
  alert(`Done. Added ${created} new inventory item${created === 1 ? "" : "s"} and linked ${linked} menu item${linked === 1 ? "" : "s"}.\n\nEach dish now tracks its own on-hand count in Inventory — go set real starting quantities and reorder levels there.`);
}

function openStockAdjustModal(id) {
  stockAdjustTargetId = id;
  const i = STATE.inventory.find(x => x.id === id);
  $("#stockAdjustItemLabel").textContent = `${i.name} — currently ${i.qty} ${i.unit} on hand`;
  $("#stockAdjustType").value = "add";
  $("#stockAdjustAmount").value = "";
  $("#stockAdjustReason").value = "Restock / Delivery";
  $("#stockAdjustModal").classList.remove("hidden");
}
function closeStockAdjustModal() { $("#stockAdjustModal").classList.add("hidden"); }

function applyStockAdjust() {
  const i = STATE.inventory.find(x => x.id === stockAdjustTargetId);
  if (!i) return;
  const type = $("#stockAdjustType").value;
  const reason = $("#stockAdjustReason").value;
  const amount = Number($("#stockAdjustAmount").value);
  if (isNaN(amount) || amount < 0) { alert("Enter a valid amount."); return; }
  const before = i.qty;
  if (type === "add") i.qty += amount;
  else if (type === "remove") i.qty = Math.max(0, i.qty - amount);
  else if (type === "set") i.qty = amount;
  i.qty = Math.round(i.qty * 1000) / 1000;

  STATE.stockLog.push({
    id: uid("log"),
    inventoryId: i.id,
    itemName: i.name,
    timestamp: Date.now(),
    type, reason,
    amount,
    before,
    after: i.qty
  });

  saveState();
  closeStockAdjustModal();
  renderInventoryTable();
}

function openStockHistoryModal(id) {
  const i = STATE.inventory.find(x => x.id === id);
  if (!i) return;
  $("#stockHistoryItemLabel").textContent = `${i.name} — ${i.qty} ${i.unit} on hand`;
  const entries = STATE.stockLog.filter(l => l.inventoryId === id).sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  const list = $("#stockHistoryList");
  list.innerHTML = entries.length
    ? entries.map(l => {
        const delta = l.type === "add" ? `+${l.amount}` : l.type === "remove" ? `−${l.amount}` : `set to ${l.amount}`;
        return `<div class="recipe-line"><span>${formatDateTime(l.timestamp)}<br><small class="muted">${escapeHtml(l.reason)} · ${delta} ${escapeHtml(i.unit)} (${l.before} → ${l.after})</small></span></div>`;
      }).join("")
    : `<p class="muted" style="font-size:12px;margin:0;">No adjustments recorded yet for this item.</p>`;
  $("#stockHistoryModal").classList.remove("hidden");
}
function closeStockHistoryModal() { $("#stockHistoryModal").classList.add("hidden"); }

let mergeInventorySourceId = null;
function openMergeInventoryModal(id) {
  const source = STATE.inventory.find(i => i.id === id);
  if (!source) return;
  mergeInventorySourceId = id;
  $("#mergeInventorySourceLabel").textContent = `Merge "${source.name}" (${source.qty} ${source.unit} on hand) into:`;
  const others = STATE.inventory.filter(i => i.id !== id);
  const targetSel = $("#mergeInventoryTarget");
  targetSel.innerHTML = others.length
    ? others.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (${i.qty} ${escapeHtml(i.unit)} on hand)</option>`).join("")
    : `<option value="">No other ingredients yet</option>`;
  $("#mergeInventoryModal").classList.remove("hidden");
}
function closeMergeInventoryModal() { $("#mergeInventoryModal").classList.add("hidden"); mergeInventorySourceId = null; }

function mergeInventoryItems(sourceId, targetId) {
  const source = STATE.inventory.find(i => i.id === sourceId);
  const target = STATE.inventory.find(i => i.id === targetId);
  if (!source || !target || sourceId === targetId) return 0;

  target.qty = Math.round((target.qty + source.qty) * 1000) / 1000;

  let relinked = 0;
  Object.keys(STATE.recipes).forEach(menuId => {
    const lines = STATE.recipes[menuId];
    let touched = false;
    lines.forEach(rl => { if (rl.inventoryId === sourceId) { rl.inventoryId = targetId; touched = true; } });
    if (touched) {
      relinked++;
      const merged = {};
      lines.forEach(rl => {
        if (merged[rl.inventoryId]) merged[rl.inventoryId].qty += rl.qty;
        else merged[rl.inventoryId] = { inventoryId: rl.inventoryId, qty: rl.qty };
      });
      STATE.recipes[menuId] = Object.values(merged);
    }
  });

  STATE.menu.forEach(m => {
    if (m.bucket && m.bucket.optionInventoryIds.includes(sourceId)) {
      m.bucket.optionInventoryIds = Array.from(new Set(
        m.bucket.optionInventoryIds.map(id => id === sourceId ? targetId : id)
      ));
    }
  });

  STATE.stockLog.forEach(l => { if (l.inventoryId === sourceId) l.inventoryId = targetId; });

  STATE.inventory = STATE.inventory.filter(i => i.id !== sourceId);
  return relinked;
}

function confirmMergeInventory() {
  const targetId = $("#mergeInventoryTarget").value;
  if (!targetId) { alert("Add another ingredient first — there's nothing to merge into yet."); return; }
  const source = STATE.inventory.find(i => i.id === mergeInventorySourceId);
  const target = STATE.inventory.find(i => i.id === targetId);
  if (!confirm(`Merge "${source.name}" into "${target.name}"? This cannot be undone.`)) return;

  const relinked = mergeInventoryItems(mergeInventorySourceId, targetId);
  saveState();
  closeMergeInventoryModal();
  renderInventoryTable();
  renderMenuTable();
  renderDashboard();
  alert(`Merged "${source.name}" into "${target.name}". ${relinked} menu item${relinked === 1 ? "" : "s"} re-linked.`);
}

/* ==========================================================================
   REPORTS
   ========================================================================== */

function setupReportDefaultRange() {
  if (!$("#reportFrom").value) $("#reportFrom").value = todayISO();
  if (!$("#reportTo").value) $("#reportTo").value = todayISO();
}

function runReport() {
  const from = $("#reportFrom").value;
  const to = $("#reportTo").value;
  const orders = STATE.orders.filter(o => isSameOrBetween(o.timestamp, from, to));
  const completed = orders.filter(o => o.status === "completed");

  const totalSales = completed.reduce((s, o) => s + o.total, 0);
  $("#reportTotalSales").textContent = formatMoney(totalSales);
  $("#reportOrderCount").textContent = completed.length;
  $("#reportAvgOrder").textContent = formatMoney(completed.length ? totalSales / completed.length : 0);

  const agg = {};
  completed.forEach(o => o.items.forEach(it => {
    if (!agg[it.name]) agg[it.name] = { qty: 0, revenue: 0 };
    agg[it.name].qty += it.qty;
    agg[it.name].revenue += it.subtotal;
  }));
  const sorted = Object.entries(agg).sort((a, b) => b[1].qty - a[1].qty).slice(0, 15);
  $("#reportTopItemsTable tbody").innerHTML = sorted.length
    ? sorted.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${v.qty}</td><td>${formatMoney(v.revenue)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No sales in this range.</td></tr>`;

  const ordersSorted = orders.slice().sort((a, b) => b.timestamp - a.timestamp);
  $("#reportOrdersTable tbody").innerHTML = ordersSorted.length
    ? ordersSorted.map(o => `
      <tr data-id="${o.id}" class="${o.status === "voided" ? "inactive" : ""}">
        <td>${escapeHtml(o.orderNo)}</td>
        <td>${formatDateTime(o.timestamp)}</td>
        <td>${o.items.reduce((s, it) => s + it.qty, 0)}</td>
        <td>${formatMoney(o.total)}</td>
        <td>${o.status === "voided" ? "Voided" : "Completed"}</td>
        <td>
          <button class="btn btn-secondary btn-small" data-act="editdate">Edit Date</button>
          ${o.status === "completed" ? '<button class="btn btn-danger btn-small" data-act="void">Void</button>' : ""}
        </td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">No orders in this range.</td></tr>`;

  $all('#reportOrdersTable tbody tr[data-id]').forEach(tr => {
    const voidBtn = tr.querySelector('[data-act="void"]');
    if (voidBtn) voidBtn.addEventListener("click", () => confirmVoidOrder(tr.dataset.id));
    tr.querySelector('[data-act="editdate"]').addEventListener("click", () => openEditOrderDateModal(tr.dataset.id));
  });
}

function confirmVoidOrder(orderId) {
  requireManagerPin(() => performVoidOrder(orderId), "Enter the manager PIN to void this order.");
}

/* ----- edit order date (backdating late-entered orders) ----- */

function timestampToLocalDatetimeValue(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let editingOrderDateId = null;
function openEditOrderDateModal(orderId) {
  const order = STATE.orders.find(o => o.id === orderId);
  if (!order) return;
  editingOrderDateId = orderId;
  $("#editOrderDateLabel").textContent = `${order.orderNo} — currently ${formatDateTime(order.timestamp)}`;
  $("#editOrderDateInput").value = timestampToLocalDatetimeValue(order.timestamp);
  $("#editOrderDateModal").classList.remove("hidden");
}
function closeEditOrderDateModal() {
  $("#editOrderDateModal").classList.add("hidden");
  editingOrderDateId = null;
}
function saveOrderDate() {
  const order = STATE.orders.find(o => o.id === editingOrderDateId);
  if (!order) return;
  const val = $("#editOrderDateInput").value;
  const newTs = val ? new Date(val).getTime() : NaN;
  if (!val || isNaN(newTs)) { alert("Pick a valid date and time."); return; }
  if (newTs > Date.now() + 60000 && !confirm("This date/time is in the future. Save it anyway?")) return;

  order.timestamp = newTs;
  saveState();
  closeEditOrderDateModal();
  runReport();
  renderDashboard();
}

function performVoidOrder(orderId) {
  const order = STATE.orders.find(o => o.id === orderId);
  if (!order || order.status !== "completed") return;
  if (!confirm(`Void order ${order.orderNo}? Ingredients used will be returned to inventory.`)) return;
  order.status = "voided";
  deductInventoryForOrder(order, true);
  saveState();
  if ($("#tab-reports").classList.contains("active")) runReport();
  renderDashboard();
  renderInventoryTable();
  if (receiptOrderId === orderId) $("#receiptVoidBtn").classList.add("hidden");
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */

function loadSettingsForm() {
  const s = STATE.settings;
  $("#settingRestaurantName").value = s.restaurantName;
  $("#settingCurrency").value = s.currency;
  $("#settingTaxRate").value = s.taxRate;
  $("#settingServiceRate").value = s.serviceRate;
  $("#settingReceiptFooter").value = s.receiptFooter;
  $("#settingManagerPin").value = s.managerPin;

  const hh = s.happyHour;
  $("#settingHappyHourEnabled").checked = hh.enabled;
  const catSel = $("#settingHappyHourCategory");
  const cats = getAllCategories();
  catSel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  catSel.value = cats.includes(hh.categoryName) ? hh.categoryName : cats[0];
  $("#settingHappyHourStart").value = hh.startTime;
  $("#settingHappyHourEnd").value = hh.endTime;
}

function saveSettings() {
  STATE.settings.restaurantName = $("#settingRestaurantName").value.trim() || "Quatro Qantos";
  STATE.settings.currency = $("#settingCurrency").value.trim() || "₱";
  STATE.settings.taxRate = Number($("#settingTaxRate").value) || 0;
  STATE.settings.serviceRate = Number($("#settingServiceRate").value) || 0;
  STATE.settings.receiptFooter = $("#settingReceiptFooter").value.trim();
  const newPin = $("#settingManagerPin").value.trim();
  STATE.settings.managerPin = newPin || STATE.settings.managerPin;
  saveState();
  renderDashboard();
  renderPOS();
  alert("Settings saved.");
}

function saveHappyHourSettings() {
  const startTime = $("#settingHappyHourStart").value;
  const endTime = $("#settingHappyHourEnd").value;
  if (!startTime || !endTime) { alert("Please set both a start and end time."); return; }
  if (startTime >= endTime) { alert("Start time must be before end time."); return; }
  STATE.settings.happyHour = {
    enabled: $("#settingHappyHourEnabled").checked,
    categoryName: $("#settingHappyHourCategory").value,
    startTime, endTime
  };
  saveState();
  renderPOS();
  renderDashboard();
  alert("Happy Hour settings saved.");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qq-pos-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.menu || !parsed.inventory) throw new Error("Invalid backup file.");
      if (!confirm("Import this backup? It will replace all current data.")) return;
      STATE = parsed;
      saveState();
      switchTab("dashboard");
      alert("Backup imported successfully.");
    } catch (e) {
      alert("Could not import file: " + e.message);
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm("Reset ALL data (menu, inventory, orders, settings)? This cannot be undone.")) return;
  if (!confirm("Are you absolutely sure? This will permanently erase everything stored in this browser.")) return;
  STATE = buildDefaultState();
  saveState();
  switchTab("dashboard");
}

/* ==========================================================================
   INIT
   ========================================================================== */

function init() {
  initTabs();
  tickClock();
  setInterval(tickClock, 30000);

  // POS
  $("#clearCartBtn").addEventListener("click", () => { cart = []; renderCart(); });
  $("#posSearchInput").addEventListener("input", renderPOS);
  $("#checkoutBtn").addEventListener("click", openCheckoutModal);
  $("#bucketBuilderCancelBtn").addEventListener("click", closeBucketBuilderModal);
  $("#bucketBuilderAddBtn").addEventListener("click", confirmBucketBuilder);
  $("#checkoutCancelBtn").addEventListener("click", closeCheckoutModal);
  $("#checkoutConfirmBtn").addEventListener("click", confirmCheckout);
  $("#checkoutCashTendered").addEventListener("input", updateChangeDisplay);
  $("#checkoutPaymentMethod").addEventListener("change", () => {
    const isCash = $("#checkoutPaymentMethod").value === "Cash";
    $("#cashTenderedWrap").classList.toggle("hidden", !isCash);
    updateChangeDisplay();
  });
  $("#checkoutDiscountType").addEventListener("change", () => {
    $("#checkoutDiscountFields").classList.toggle("hidden", $("#checkoutDiscountType").value === "none");
    renderCheckoutBreakdown();
  });
  $("#receiptCloseBtn").addEventListener("click", () => $("#receiptModal").classList.add("hidden"));
  $("#receiptPrintBtn").addEventListener("click", () => window.print());
  $("#receiptVoidBtn").addEventListener("click", () => { if (receiptOrderId) confirmVoidOrder(receiptOrderId); });

  // Menu
  $("#addMenuItemBtn").addEventListener("click", () => openMenuItemModal(null));
  $("#fillDefaultPhotosBtn").addEventListener("click", fillDefaultMenuPhotos);
  $("#manageCategoriesBtn").addEventListener("click", openCategoryManagerModal);
  $("#categoryManagerCancelBtn").addEventListener("click", closeCategoryManagerModal);
  $("#categoryManagerSaveBtn").addEventListener("click", saveCategoryChanges);
  $("#menuItemCancelBtn").addEventListener("click", closeMenuItemModal);
  $("#menuItemSaveBtn").addEventListener("click", saveMenuItem);
  $("#menuItemDeleteBtn").addEventListener("click", deleteMenuItem);
  $("#addRecipeLineBtn").addEventListener("click", addRecipeLine);
  $("#menuCategoryFilter").addEventListener("change", renderMenuTable);
  $("#menuSearchInput").addEventListener("input", renderMenuTable);
  $("#menuItemImagePickBtn").addEventListener("click", () => $("#menuItemImageInput").click());
  $("#menuItemImageInput").addEventListener("change", (e) => {
    if (e.target.files[0]) handleMenuImageFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#menuItemImageRemoveBtn").addEventListener("click", () => {
    menuItemImageDraft = null;
    setMenuImagePreview(null);
  });

  // Inventory
  $("#addInventoryItemBtn").addEventListener("click", () => openInventoryItemModal(null));
  $("#bulkAddInventoryBtn").addEventListener("click", bulkAddInventoryForMenu);
  $("#onHoldToggleHeader").addEventListener("click", toggleOnHoldPanel);
  $("#inventorySelectAllCheckbox").addEventListener("change", toggleSelectAllInventory);
  $("#inventoryDeleteSelectedBtn").addEventListener("click", deleteSelectedInventory);
  $("#inventoryItemCancelBtn").addEventListener("click", closeInventoryItemModal);
  $("#inventoryItemSaveBtn").addEventListener("click", saveInventoryItem);
  $("#inventoryItemDeleteBtn").addEventListener("click", deleteInventoryItem);
  $("#inventorySearchInput").addEventListener("input", renderInventoryTable);
  $("#lowStockOnlyToggle").addEventListener("change", renderInventoryTable);
  $("#stockAdjustCancelBtn").addEventListener("click", closeStockAdjustModal);
  $("#stockAdjustSaveBtn").addEventListener("click", applyStockAdjust);
  $("#stockHistoryCloseBtn").addEventListener("click", closeStockHistoryModal);
  $("#mergeInventoryCancelBtn").addEventListener("click", closeMergeInventoryModal);
  $("#mergeInventoryConfirmBtn").addEventListener("click", confirmMergeInventory);
  $("#editOrderDateCancelBtn").addEventListener("click", closeEditOrderDateModal);
  $("#editOrderDateSaveBtn").addEventListener("click", saveOrderDate);

  // Purchase Requests
  $("#addRequestBtn").addEventListener("click", () => openRequestModal(null));
  $("#requestCancelBtn").addEventListener("click", closeRequestModal);
  $("#requestSaveBtn").addEventListener("click", saveRequest);
  $("#requestDeleteBtn").addEventListener("click", deleteRequest);
  $("#requestItemName").addEventListener("blur", autoSuggestRequestFromInventory);
  $("#requestDeptFilter").addEventListener("change", renderRequestsTable);
  $("#requestShowPurchased").addEventListener("change", renderRequestsTable);

  // Reports
  $("#reportRunBtn").addEventListener("click", runReport);
  $("#reportTodayBtn").addEventListener("click", () => {
    $("#reportFrom").value = todayISO();
    $("#reportTo").value = todayISO();
    runReport();
  });

  // Settings
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#saveHappyHourBtn").addEventListener("click", saveHappyHourSettings);
  $("#exportDataBtn").addEventListener("click", exportBackup);
  $("#importDataBtn").addEventListener("click", () => $("#importFileInput").click());
  $("#importFileInput").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });
  $("#resetDataBtn").addEventListener("click", resetAllData);

  // Manager PIN gate
  $("#pinCancelBtn").addEventListener("click", closePinModal);
  $("#pinSubmitBtn").addEventListener("click", submitPin);
  $("#pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
  $("#lockManagerBtn").addEventListener("click", lockManager);

  // Admin dropdown
  $("#adminDropdownToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#adminDropdownMenu").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    const menu = $("#adminDropdownMenu");
    if (!menu.classList.contains("hidden") && !e.target.closest(".nav-dropdown")) {
      menu.classList.add("hidden");
    }
    if (!e.target.closest(".pos-group-dropdown")) {
      $all(".pos-group-menu.open").forEach(m => m.classList.remove("open"));
    }
  });
  $all("#adminDropdownMenu .tab-btn[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => $("#adminDropdownMenu").classList.add("hidden"));
  });

  // close modals on overlay click — only for read-only modals, so in-progress
  // form edits (menu items, ingredients, recipes, checkout) are never lost
  // by an accidental click outside the box.
  const DISMISSABLE_ON_BACKDROP = ["receiptModal", "stockHistoryModal"];
  $all(".modal-overlay").forEach(ov => {
    ov.addEventListener("click", (e) => {
      if (e.target !== ov) return;
      if (ov.id === "pinModal") closePinModal();
      else if (DISMISSABLE_ON_BACKDROP.includes(ov.id)) ov.classList.add("hidden");
    });
  });

  renderDashboard();
  renderPOS();
}

document.addEventListener("DOMContentLoaded", init);

// Registers the service worker so the app can be installed to a home screen and
// keeps working offline. Requires being served over http(s) — file:// pages can't
// register a service worker, so this silently no-ops when opened that way.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker registration failed:", err));
  });
}
