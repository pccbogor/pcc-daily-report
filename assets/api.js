/**
 * API client. Live mode talks to the Apps Script Web App; demo mode runs the
 * same rules (PCC.* from logic.js) against localStorage so the site can be
 * tried before the backend is deployed.
 */
(function () {
  var cfg = window.PCC_CONFIG || {};
  var LIVE = !!(cfg.API_URL && /^https:\/\/script\.google\.com\//.test(cfg.API_URL));

  function live(action, payload) {
    var body = Object.assign({ action: action, pin: API.getPin() }, payload || {});
    // text/plain avoids a CORS preflight, which Apps Script does not answer.
    return fetch(cfg.API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('Server error ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.ok) {
          var e = new Error(data.error || 'Gagal memproses permintaan.');
          e.errors = data.errors || [];
          if (/PIN/.test(data.error || '')) e.pin = true;
          throw e;
        }
        return data;
      }, function (err) {
        if (err.errors || err.pin) throw err;
        throw new Error(navigator.onLine === false ? 'Tidak ada koneksi internet. Data masih tersimpan di form, coba kirim lagi.' : (err.message || 'Gagal terhubung ke server.'));
      });
  }

  // ---------------- demo backend ----------------
  // Same list and order as SEED_PRODUCTS in apps-script/Code.gs: [produk, harga, harga_modal, grup, label WA]
  var DEMO_PRODUCTS = [
    ['Raket', 50000, '', 'Lainnya', 'Penyewaan Raket'], ['Upgrade Raket', 20000, '', 'Lainnya', 'Upgrade Raket'],
    ['Bola', 90000, '', 'Lainnya', 'Pembelian Bola'], ['Sewa Bola', 50000, '', 'Lainnya', 'Sewa Bola'],
    ['Grip', 30000, '', 'Lainnya', 'Grip'], ['Sewa Handuk', 25000, '', 'Lainnya', 'Handuk'],
    ['Mineral', 10000, 1710, 'Minuman', 'Mineral'], ['Mineral Jumbo', 15000, '', 'Minuman', 'Mineral Jumbo'],
    ['Pocari Sweet', 15000, 5250, 'Minuman', 'Pocari Sweet'], ['Ion Water', 15000, 5250, 'Minuman', 'Ion Water'],
    ['Kara Coco', 18000, 10425, 'Minuman', 'Kara Coco'], ['UC 1000 Lemon', 15000, 6800, 'Minuman', 'UC 1000 Lemon'],
    ['UC 1000 Orange', 15000, 6800, 'Minuman', 'UC 1000 Orange'],
    ['Lemon Honey Red Ginger 250 ml', 15000, 12750, 'Minuman', 'Lemon Honey Red Ginger 250 ml'],
    ['Cinnamon Red Ginger 250 ml', 15000, 12750, 'Minuman', 'Cinnamon Red Ginger 250 ml'],
    ['Lemongrass Red Ginger 250 ml', 15000, 12750, 'Minuman', 'Lemongrass Red Ginger 250 ml'],
    ['Lestea 250 ml', 15000, 12750, 'Minuman', 'Lestea 250 ml'], ['Limegrass 250 ml', 15000, 12750, 'Minuman', 'Limegrass 250 ml'],
    ['Lemon Fresco 250 ml', 15000, 12750, 'Minuman', 'Lemon Fresco 250 ml'],
    ['Lemonade Red Ginger Honey 220 ml', 20000, 16150, 'Minuman', 'Lemonade Red Ginger Honey 220 ml'],
    ['Citroen Orange 220 ml', 20000, 16150, 'Minuman', 'Citroen Orange 220 ml'],
    ['Cinnamon Red Ginger 220 ml', 20000, 16150, 'Minuman', 'Cinnamon Red Ginger (220 ml)'],
    ['Lemongrass Red Ginger 220 ml', 20000, 16150, 'Minuman', 'Lemongrass Red Ginger (220 ml)'],
    ['Lemon Sereh Tea 220 ml', 20000, 16150, 'Minuman', 'Lemon Sereh Tea (220 ml)'],
    ['Kopi', 18000, 9000, 'Minuman', 'Kopi'], ['Americano', 15000, 10000, 'Minuman', 'Americano'],
    ['Fitbar Coklat', 10000, 7950, 'Snack', 'Fitbar Choco delight'], ['Fitbar Fruits', 10000, 7950, 'Snack', 'Fitbar fruits delight'],
    ['Fitbar Tiramisu', 10000, 7950, 'Snack', 'Fitbar tiramisu delight']
  ];
  var DB_KEY = 'pcc_demo_db_v1';
  function db() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || { reports: [], courts: [], sales: [], other: [], audit: [] }; }
    catch (e) { return { reports: [], courts: [], sales: [], other: [], audit: [] }; }
  }
  function save(d) { try { localStorage.setItem(DB_KEY, JSON.stringify(d)); } catch (e) { /* storage full or blocked */ } }
  function today() {
    var d = new Date(Date.now() + 7 * 3600000); // Asia/Jakarta
    return d.toISOString().slice(0, 10);
  }
  function demoConfig() {
    return {
      shifts: PCC.DEFAULT_OPTIONS.shifts.slice(), methods: PCC.DEFAULT_OPTIONS.methods.slice(), admins: ['Lutfhi', 'Haidar'],
      courtNames: ['Court 1 (Semi Indoor)', 'Court 2 (Semi Indoor)', 'Court 3 (Semi Indoor)'],
      priceSuggestions: [100000, 120000, 132000, 140000, 144500, 175000, 180000, 190000, 200000, 220000, 295000, 340000, 345000, 395000],
      maxHoursPerCourt: 17,
      courtShift: 'Shift 2',
      shiftHours: { 'Shift 1': '06.00-14.00', 'Shift 2': '14.00-22.00' },
      coaches: ['Abi Ipan', 'Arif'],
      otherCategories: PCC.OTHER_CATEGORIES.slice(),
      waTarget: '', // live mode reads the number from Apps Script; it is never stored in this public file
      waAuto: false,
      products: DEMO_PRODUCTS.map(function (p) { return { produk: p[0], harga: p[1], harga_modal: p[2], grup: p[3], label: p[4] }; }),
      today: today()
    };
  }
  function demo(action, p) {
    return new Promise(function (resolve) { setTimeout(resolve, 450); }).then(function () {
      var d = db();
      if (action === 'ping') return { ok: true };
      if (action === 'config') return { ok: true, data: demoConfig() };
      if (action === 'submit') {
        var dup = d.audit.filter(function (a) { return a.submission_id === p.submissionId; })[0];
        if (dup) return { ok: true, duplicate: true, reportId: dup.report_id, version: dup.version, message: 'Laporan ini sudah tersimpan sebelumnya.' };
        var c = demoConfig();
        var rep = PCC.normalize(p.report);
        var v = PCC.validate(rep, c);
        if (v.errors.length) { var e = new Error('Laporan belum valid.'); e.errors = v.errors; throw e; }
        var t = PCC.compute(rep);
        var key = PCC.reportKey(rep.tanggal, rep.shift, rep.admin);
        var now = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 19); // Asia/Jakarta wall time, like the backend
        var ex = d.reports.filter(function (r) { return r.report_key === key && r.status === 'ACTIVE'; })[0];
        var id = ex ? ex.report_id : 'PCC-' + rep.tanggal.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        var version = ex ? ex.version + 1 : 1;
        ['courts', 'sales', 'other'].forEach(function (k) { d[k] = d[k].filter(function (r) { return r.report_id !== id; }); });
        var base = { report_id: id, tanggal: rep.tanggal, shift: rep.shift, admin: rep.admin };
        rep.courts.forEach(function (r) { var rv = PCC.courtRowValues(r); d.courts.push(Object.assign({}, base, r, rv)); });
        rep.sales.forEach(function (r) { var sv = PCC.salesRowValues(r); d.sales.push(Object.assign({}, base, r, sv)); });
        rep.other.forEach(function (r) { d.other.push(Object.assign({}, base, r)); });
        var rec = Object.assign(PCC.flatten(t), { report_id: id, report_key: key, tanggal: rep.tanggal, shift: rep.shift, admin: rep.admin, catatan: rep.catatan, status: 'ACTIVE', version: version, created_at: ex ? ex.created_at : now, updated_at: now });
        if (ex) d.reports[d.reports.indexOf(ex)] = rec; else d.reports.push(rec);
        d.audit.push({ timestamp: now, action: ex ? 'UPDATE' : 'CREATE', report_id: id, submission_id: p.submissionId, version: version });
        save(d);
        var waText = PCC.waMessage(rep, { products: c.products, shiftHours: c.shiftHours, coaches: c.coaches, courtShift: c.courtShift, version: version });
        return { ok: true, duplicate: false, action: ex ? 'UPDATE' : 'CREATE', reportId: id, version: version, totals: t, warnings: v.warnings, archive: { status: 'skipped', reason: 'mode demo' },
          wa: { status: 'manual' }, waText: waText, message: ex ? 'Laporan diperbarui (versi ' + version + ').' : 'Laporan tersimpan.' };
      }
      var active = d.reports.filter(function (r) { return r.status === 'ACTIVE'; });
      if (action === 'history') return { ok: true, data: PCC.aggregate(active, [], p.from, p.to).reports };
      if (action === 'dashboard') return { ok: true, data: PCC.aggregate(active, d.sales, p.from, p.to) };
      if (action === 'report') {
        var r = active.filter(function (x) { return x.report_id === p.reportId; })[0];
        if (!r) throw new Error('Laporan tidak ditemukan.');
        var pick = function (k) { return d[k].filter(function (x) { return x.report_id === p.reportId; }); };
        return { ok: true, data: Object.assign({}, r, { courts: pick('courts'), sales: pick('sales'), other: pick('other') }) };
      }
      throw new Error('Aksi tidak dikenal.');
    });
  }

  var PIN_KEY = 'pcc_pin';
  var API = {
    live: LIVE,
    call: function (action, payload) { return LIVE ? live(action, payload) : demo(action, payload || {}); },
    getPin: function () { try { return sessionStorage.getItem(PIN_KEY) || localStorage.getItem(PIN_KEY) || API._pin || ''; } catch (e) { return API._pin || ''; } },
    setPin: function (pin, remember) {
      try {
        sessionStorage.setItem(PIN_KEY, pin);
        if (remember) localStorage.setItem(PIN_KEY, pin); else localStorage.removeItem(PIN_KEY);
      } catch (e) { /* storage blocked: PIN lasts for this page only */ API._pin = pin; }
    },
    clearPin: function () { try { sessionStorage.removeItem(PIN_KEY); localStorage.removeItem(PIN_KEY); } catch (e) {} },
    today: today
  };
  window.API = API;
})();
