// Minimal in-memory stand-in for the Google Apps Script services Code.gs uses.
// Formatting calls are no-ops; values, rows and deletions behave like Sheets.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeSheet(name, seed) {
  const sh = {
    name, data: seed ? JSON.parse(JSON.stringify(seed.values)) : [], formulas: seed ? Object.assign({}, seed.formulas) : {}, maxRows: 1000, inserted: 0,
    getName: () => name,
    getMaxRows: () => sh.maxRows,
    insertRowsAfter: (after, n) => { sh.maxRows += n; sh.inserted += n; },
    getLastRow: () => { for (let i = sh.data.length - 1; i >= 0; i--) if (sh.data[i].some((v) => v !== '' && v !== undefined)) return i + 1; return 0; },
    getLastColumn: () => sh.data.reduce((m, r) => Math.max(m, r.length), 0),
    getDataRange: () => range(sh, 1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') return range(sh, 1, 1, 1, 1); // A1 strings only used for formatting
      if (a < 1 || b < 1) throw new Error(`bad range ${a},${b} on ${sh.name}`);
      return range(sh, a, b, c || 1, d || 1);
    },
    deleteRows: (start, n) => { sh.data.splice(start - 1, n); },
    clear: () => { sh.data = []; sh.formulas = {}; },
    setName: (n) => { sh.name = n; },
  };
  // Other Sheet methods (freeze, widths…) are no-ops.
  const ps = new Proxy(sh, { get: (t, k) => (k in t ? t[k] : () => ps) });
  return ps;
}
function range(sh, row, col, nr, nc) {
  let p;
  const r = {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
      const v = (sh.data[row - 1 + i] || [])[col - 1 + j];
      return v === undefined ? '' : v;
    })),
    setValues: (vals) => {
      if (vals.length !== nr || vals.some((x) => x.length !== nc)) throw new Error(`setValues size mismatch on ${sh.name}`);
      if (row - 1 + nr > sh.maxRows) throw new Error(`range outside grid on ${sh.name}`);
      vals.forEach((rowVals, i) => {
        const ri = row - 1 + i;
        while (sh.data.length <= ri) sh.data.push([]);
        rowVals.forEach((v, j) => { sh.data[ri][col - 1 + j] = v; delete sh.formulas[`${ri + 1},${col + j}`]; });
      });
      return p;
    },
    setValue: (v) => r.setValues([[v]]),
    getValue: () => r.getValues()[0][0],
    getDisplayValues: () => r.getValues().map((x) => x.map(String)),
    setFormula: (f) => { sh.formulas[`${row},${col}`] = f; return p; },
    getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.formulas[`${row + i},${col + j}`] || '')),
    setFormulas: (fs2) => {
      if (fs2.length !== nr || fs2.some((x) => x.length !== nc)) throw new Error(`setFormulas size mismatch on ${sh.name}`);
      fs2.forEach((rowF, i) => rowF.forEach((f, j) => { sh.formulas[`${row + i},${col + j}`] = f; }));
      return p;
    },
  };
  // Any other Range method (formatting) is a chainable no-op.
  p = new Proxy(r, { get: (t, k) => (k in t ? t[k] : () => p) });
  return p;
}

function load(props) {
  const sheets = {};
  const archives = [];
  const fetches = [];
  const triggers = [];
  const folders = {}; // id -> { id, parent, children: {name: id} }
  const folder = (id) => {
    const f = folders[id] || (folders[id] = { id, children: {} });
    return {
      getId: () => id,
      getFoldersByName: (n) => { const list = f.children[n] ? [folder(f.children[n])] : []; let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
      createFolder: (n) => { const cid = id + '/' + n; f.children[n] = cid; folders[cid] = { id: cid, children: {} }; return folder(cid); },
    };
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getId: () => 'DB',
    getSpreadsheetLocale: () => props.__LOCALE || 'en_US',
  };
  archives.db = { id: 'DB', title: 'database' };
  const cache = {};
  const spreadsheet = (title, tabs) => {
    const a = {
      title, id: 'ARCH' + archives.length,
      getId: () => a.id, getName: () => a.title, rename: (n) => { a.title = n; }, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + a.id,
      getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = makeSheet(n)),
      getSheets: () => Object.values(tabs), deleteSheet: (s) => { delete tabs[s.getName()]; }, tabs,
    };
    return a;
  };
  if (props.__TEMPLATE) {
    const tabs = {};
    Object.entries(props.__TEMPLATE).forEach(([n, seed]) => { tabs[n] = makeSheet(n, seed); });
    archives.template = spreadsheet('TEMPLATE', tabs);
    archives.template.id = 'TPL';
  }
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: () => {},
      create: (title) => { const a = spreadsheet(title, { Sheet1: makeSheet('Sheet1') }); archives.push(a); return a; },
      openById: (id) => {
        if (id === 'TPL' && archives.template) return archives.template; const a = archives.find((x) => x.id === id); if (!a) throw new Error('not found'); return a; },
    },
    DriveApp: {
      getFolderById: (id) => folder(id),
      getFileById: (id) => {
        const a = id === 'DB' ? archives.db : id === 'TPL' ? archives.template : archives.find((x) => x.id === id);
        if (!a) throw new Error('file not found ' + id);
        return {
          getId: () => a.id,
          makeCopy: (title, f) => {
            const tabs = {};
            Object.values(a.tabs).forEach((t) => { tabs[t.getName()] = makeSheet(t.getName(), { values: t.data, formulas: t.formulas }); });
            const c = spreadsheet(title, tabs);
            c.folder = f.getId();
            archives.push(c);
            return ctx.DriveApp.getFileById(c.id);
          },
          moveTo: (f) => { a.folder = f.getId(); a.moves = (a.moves || 0) + 1; },
          setTrashed: (v) => { a.trashed = v; },
          getParents: () => { const list = a.folder ? [folder(a.folder)] : []; let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
        };
      },
    },
    Logger: { log: () => {} },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (fn) => { const b = { timeBased: () => b, onMonthDay: (d) => { b.day = d; return b; }, atHour: (h) => { b.hour = h; return b; }, inTimezone: () => b,
        create: () => { const t = { fn, day: b.day, hour: b.hour, getHandlerFunction: () => fn }; triggers.push(t); return t; } }; return b; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props[k] === undefined ? null : props[k]) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const j = new Date(d.getTime() + 7 * 3600000); // Asia/Jakarta, UTC+7
        const p = (n) => String(n).padStart(2, '0');
        return fmt.replace('yyyy', j.getUTCFullYear()).replace('MM', p(j.getUTCMonth() + 1)).replace('dd', p(j.getUTCDate()))
          .replace("'T'", 'T').replace('HH', p(j.getUTCHours())).replace('mm', p(j.getUTCMinutes())).replace('ss', p(j.getUTCSeconds()));
      },
    },
    UrlFetchApp: { fetch: (url, opt) => { fetches.push({ url, opt }); return { getResponseCode: () => 200, getContentText: () => '{"status":true}' }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  // Test exactly what gets pasted into Apps Script: the single bundled file.
  vm.runInContext(fs.readFileSync(path.join(dir, 'SALIN-KE-APPS-SCRIPT.gs'), 'utf8'), ctx, { filename: 'SALIN-KE-APPS-SCRIPT.gs' });
  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { ctx, sheets, archives, call, fetches, folders, triggers };
}

module.exports = { load };
