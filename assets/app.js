/* PCC Daily Report — website (no framework). Pages are hash routes. */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var rp = PCC.formatRupiah;
  var app = $('#app');
  var CFG = window.PCC_CONFIG || {};
  var DRAFT_KEY = 'pcc_draft_v1';
  var CONF_KEY = 'pcc_conf_cache_v1';
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  var state = { conf: null, draft: null, submitting: false, lastResult: null, dash: { mode: 'daily', ref: null, from: null, to: null }, hist: { from: null, to: null }, charts: [] };

  // ---------------- utils ----------------
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  function fmtNum(n) { n = Number(n) || 0; return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtHours(h) { h = Math.round((Number(h) || 0) * 100) / 100; return String(h).replace('.', ',') + ' jam'; }
  function longDate(ymd) {
    if (!ymd) return '-';
    var p = ymd.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return HARI[d.getUTCDay()] + ', ' + p[2] + ' ' + BULAN[p[1] - 1] + ' ' + p[0];
  }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'ok'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
  }
  function errList(e) {
    return '<div class="alert err"><b>' + esc(e.message) + '</b>' + (e.errors && e.errors.length ? '<ul>' + e.errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  // ---------------- draft ----------------
  function blankDraft(conf) {
    var courts = [];
    PCC.COURTS.forEach(function (c) {
      courts.push({ court: c, kategori: 'AYO', harga: '', jumlah: '', durasi: 1, metode: 'AYO' });
      courts.push({ court: c, kategori: 'Manual', harga: '', jumlah: '', durasi: 1, metode: '' });
    });
    return {
      tanggal: conf.today, shift: '', admin: '', catatan: '',
      sales: conf.products.map(function (p) { return { produk: p.produk, harga: p.harga, harga_modal: p.harga_modal, qty: 0, metode: '' }; }),
      courts: courts, other: [], submissionId: uid(), editOf: null
    };
  }
  function saveDraft() { store(DRAFT_KEY, state.draft); }
  function normalized() { return PCC.normalize(state.draft); }

  // ---------------- boot ----------------
  function logo() {
    $('#logo').innerHTML = CFG.LOGO_URL
      ? '<img src="' + esc(CFG.LOGO_URL) + '" alt="Padel Culture Club Bogor">'
      : '<div class="logo-mark">PCC</div><div class="logo-text"><b>Padel Culture Club</b><span>BOGOR</span></div>';
  }

  function ensureConfig() {
    if (state.conf) return Promise.resolve(state.conf);
    return API.call('config').then(function (r) {
      state.conf = r.data; store(CONF_KEY, r.data); return r.data;
    }).catch(function (e) {
      var cached = load(CONF_KEY);
      if (cached && !e.pin) { state.conf = cached; toast('Offline: memakai daftar produk terakhir.', 'err'); return cached; }
      throw e;
    });
  }

  function pinScreen(message) {
    $('#totalbar').hidden = true;
    app.className = '';
    app.innerHTML =
      '<section class="card"><h2><span class="num">🔒</span>Masuk</h2>' +
      '<p class="hint">Masukkan PIN admin PCC untuk membuka laporan.</p>' +
      (message ? '<div class="alert err">' + esc(message) + '</div>' : '') +
      '<label class="f" for="pin">PIN <span class="req">*</span></label>' +
      '<input id="pin" class="input" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••">' +
      '<label style="display:flex;gap:8px;align-items:center;margin:12px 0;font-size:12.5px"><input type="checkbox" id="remember"> Ingat di perangkat ini</label>' +
      '<button class="btn" id="pin-go">Masuk</button></section>';
    var go = function () {
      var pin = $('#pin').value.trim();
      if (!pin) return;
      API.setPin(pin, $('#remember').checked);
      $('#pin-go').disabled = true; $('#pin-go').innerHTML = '<span class="spinner"></span> Memeriksa…';
      state.conf = null;
      route();
    };
    $('#pin-go').onclick = go;
    $('#pin').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    $('#pin').focus();
  }

  function route() {
    var r = (location.hash.replace(/^#\/?/, '') || 'input').split('?')[0];
    if (['dashboard', 'input', 'court', 'summary', 'history'].indexOf(r) < 0) r = 'input';
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === r); });
    destroyCharts();
    if (API.live && !API.getPin()) return pinScreen();
    app.innerHTML = '<div class="empty"><span class="spinner" style="border-color:#e6cfc8;border-top-color:#7B1E1E;display:inline-block"></span></div>';
    ensureConfig().then(function (conf) {
      if (!state.draft) {
        var saved = load(DRAFT_KEY);
        state.draft = saved && saved.sales ? mergeDraft(saved, conf) : blankDraft(conf);
      }
      ({ dashboard: pageDashboard, input: pageInput, court: pageCourt, summary: pageSummary, history: pageHistory })[r]();
      window.scrollTo(0, 0);
    }).catch(function (e) {
      if (e.pin) { API.clearPin(); return pinScreen(e.message); }
      app.className = '';
      app.innerHTML = errList(e) + '<button class="btn ghost" onclick="location.reload()">Coba lagi</button>';
    });
  }
  // Keep a saved draft but add products that were added to Master_Produk since.
  function mergeDraft(saved, conf) {
    var have = {}; saved.sales.forEach(function (s) { have[s.produk] = true; });
    conf.products.forEach(function (p) { if (!have[p.produk]) saved.sales.push({ produk: p.produk, harga: p.harga, harga_modal: p.harga_modal, qty: 0, metode: '' }); });
    if (!saved.submissionId) saved.submissionId = uid();
    return saved;
  }

  // ---------------- shared bits ----------------
  function methodOptions(selected, exclude) {
    return '<option value="">Metode bayar…</option>' + state.conf.methods.filter(function (m) { return m !== exclude; }).map(function (m) {
      return '<option' + (m === selected ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
  }
  function totalBar(label, nextHref, nextText) {
    var bar = $('#totalbar');
    var t = PCC.compute(normalized());
    bar.hidden = false;
    bar.innerHTML = '<div class="totalbar-in"><div class="tb-sum"><span>' + esc(label) + '</span><b id="tb-total">' + rp(t.grandTotal) + '</b></div>' +
      (nextHref ? '<a class="btn" href="' + nextHref + '">' + nextText + '</a>' : '') + '</div>';
  }
  function refreshTotalBar() { var el = $('#tb-total'); if (el) el.textContent = rp(PCC.compute(normalized()).grandTotal); }
  function editBanner() {
    if (!state.draft.editOf) return '';
    return '<div class="edit-banner"><span>Mode koreksi laporan <b>' + esc(state.draft.editOf) + '</b>. Tanggal, shift, dan nama dikunci; submit akan menimpa versi sebelumnya.</span>' +
      '<button class="chip-btn" id="cancel-edit">Batal</button></div>';
  }
  function bindEditBanner() {
    var b = $('#cancel-edit');
    if (b) b.onclick = function () {
      if (!confirm('Batalkan koreksi dan kosongkan form?')) return;
      state.draft = blankDraft(state.conf); saveDraft(); route();
    };
  }

  // ---------------- page: input (info + sales + other) ----------------
  function pageInput() {
    app.className = '';
    var d = state.draft, c = state.conf, locked = !!d.editOf;
    app.innerHTML = editBanner() +
      '<section class="card"><h2><span class="num">1</span>Informasi Laporan</h2>' +
      '<label class="f" for="tanggal">Tanggal laporan <span class="req">*</span></label>' +
      '<input id="tanggal" class="input" type="date" value="' + esc(d.tanggal) + '" max="' + esc(c.today) + '"' + (locked ? ' readonly' : '') + '>' +
      '<div class="hint" style="margin:6px 0 0">' + esc(longDate(d.tanggal)) + '</div>' +
      '<label class="f" for="admin">Nama admin <span class="req">*</span></label>' +
      '<input id="admin" class="input" list="admins" placeholder="Nama yang bertugas" value="' + esc(d.admin) + '"' + (locked ? ' readonly' : '') + ' autocomplete="name">' +
      '<datalist id="admins">' + c.admins.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
      '<label class="f">Shift kerja <span class="req">*</span></label>' +
      '<div class="seg' + (locked ? ' disabled' : '') + '" id="shift">' + c.shifts.map(function (s) { return '<button type="button" data-v="' + esc(s) + '" class="' + (d.shift === s ? 'on' : '') + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
      (c.courtShift ? '<p class="hint" style="margin:6px 0 0">Booking court dicatat per hari oleh <b>' + esc(c.courtShift) + '</b>. Shift lain cukup mengisi penjualan.</p>' : '') +
      '<label class="f" for="catatan">Catatan operasional</label>' +
      '<textarea id="catatan" class="input" placeholder="Kendala, kejadian penting, info untuk shift berikutnya">' + esc(d.catatan) + '</textarea>' +
      '<p class="hint" style="margin:10px 0 0">Kirim ulang dengan tanggal, shift, dan nama yang sama akan menimpa laporan sebelumnya.</p></section>' +

      '<section class="card"><h2><span class="num">2</span>Penjualan & Sewa Produk<span class="right" id="sales-total"></span></h2>' +
      '<div class="toolbar"><input class="input" id="q" placeholder="Cari produk…"><button class="chip-btn" id="only">Hanya yang terjual</button></div>' +
      '<div id="prods"></div></section>' +

      '<section class="card"><h2><span class="num">3</span>Pemasukan Lainnya<span class="right" id="other-total"></span></h2>' +
      '<p class="hint">Opsional. Photoshoot, event (lapangan, kebersihan, keamanan, pemasangan alat), biaya tambahan, coaching per coach, atau lainnya. Masuk ke kolom yang sama di Rekap Bulanan.</p>' +
      '<div id="others"></div><button class="chip-btn" id="add-other">+ Tambah pemasukan</button></section>';

    $('#tanggal').onchange = function () { d.tanggal = this.value; saveDraft(); pageInput(); };
    $('#admin').oninput = function () { d.admin = this.value; saveDraft(); };
    $('#catatan').oninput = function () { d.catatan = this.value; saveDraft(); };
    $$('#shift button').forEach(function (b) {
      b.onclick = function () { d.shift = b.dataset.v; saveDraft(); $$('#shift button').forEach(function (x) { x.classList.toggle('on', x === b); }); inputNext(); };
    });
    var onlySold = false;
    $('#q').oninput = function () { renderProducts(this.value, onlySold); };
    $('#only').onclick = function () { onlySold = !onlySold; this.classList.toggle('on', onlySold); renderProducts($('#q').value, onlySold); };
    $('#add-other').onclick = function () { d.other.push({ kategori: 'Photoshoot', keterangan: '', nominal: '', jam: '', metode: '' }); saveDraft(); renderOthers(); };
    renderProducts('', false);
    renderOthers();
    bindEditBanner();
    inputNext();
  }
  // Shifts that do not record court bookings go straight to the summary.
  function courtShiftFor(shift) { return PCC.recordsCourts(shift, { courtShift: state.conf.courtShift }); }
  function inputNext() {
    var s = state.draft.shift;
    if (s && !courtShiftFor(s)) totalBar('Grand total sementara', '#/summary', 'Lanjut: Summary →');
    else totalBar('Grand total sementara', '#/court', 'Lanjut: Booking Court →');
  }

  function renderProducts(q, onlySold) {
    var d = state.draft, box = $('#prods');
    q = (q || '').toLowerCase();
    var html = '';
    d.sales.forEach(function (s, i) {
      if (q && s.produk.toLowerCase().indexOf(q) < 0) return;
      if (onlySold && !(Number(s.qty) > 0)) return;
      var split = d.sales.filter(function (x) { return x.produk === s.produk; }).length > 1;
      html += '<div class="prod' + (Number(s.qty) > 0 ? ' filled' : '') + '" data-i="' + i + '">' +
        '<div class="prod-top"><div class="prod-name"><b>' + esc(s.produk) + '</b><span>' + rp(s.harga) + (split ? ' · pembayaran terpisah' : '') + '</span></div>' +
        '<div class="stepper"><button type="button" data-step="-1" aria-label="Kurangi">−</button><input inputmode="numeric" value="' + (Number(s.qty) || 0) + '" aria-label="Jumlah ' + esc(s.produk) + '"><button type="button" data-step="1" aria-label="Tambah">+</button></div></div>' +
        (Number(s.qty) > 0 ? '<div class="prod-bottom"><select class="input">' + methodOptions(s.metode) + '</select><span class="sub">' + rp(s.harga * s.qty) + '</span></div>' +
          '<button type="button" class="link-btn" data-split>+ Pisah metode bayar</button>' + (split ? ' <button type="button" class="link-btn" data-remove style="color:#7A6460;margin-left:10px">Hapus baris</button>' : '') : '') +
        '</div>';
    });
    box.innerHTML = html || '<div class="empty">Tidak ada produk yang cocok.</div>';
    $$('.prod', box).forEach(function (el) {
      var i = Number(el.dataset.i), s = d.sales[i], inp = $('.stepper input', el);
      var set = function (v) {
        v = Math.max(0, Math.floor(PCC.toNum(v) || 0));
        var was = Number(s.qty) > 0; s.qty = v; saveDraft();
        if (was !== v > 0) renderProducts($('#q').value, onlySold); else { inp.value = v; var sub = $('.sub', el); if (sub) sub.textContent = rp(s.harga * v); }
        salesTotals();
      };
      $$('[data-step]', el).forEach(function (b) { b.onclick = function () { set((Number(s.qty) || 0) + Number(b.dataset.step)); }; });
      inp.onchange = function () { set(inp.value); };
      inp.onfocus = function () { inp.select(); };
      var sel = $('select', el); if (sel) sel.onchange = function () { s.metode = sel.value; saveDraft(); };
      var sp = $('[data-split]', el); if (sp) sp.onclick = function () { d.sales.splice(i + 1, 0, { produk: s.produk, harga: s.harga, harga_modal: s.harga_modal, qty: 1, metode: '' }); saveDraft(); renderProducts($('#q').value, onlySold); salesTotals(); };
      var rm = $('[data-remove]', el); if (rm) rm.onclick = function () { d.sales.splice(i, 1); saveDraft(); renderProducts($('#q').value, onlySold); salesTotals(); };
    });
    salesTotals();
  }
  function salesTotals() {
    var t = PCC.compute(normalized());
    var el = $('#sales-total'); if (el) el.textContent = t.salesQty + ' item · ' + rp(t.revenueSales);
    var o = $('#other-total'); if (o) o.textContent = rp(t.revenueOther);
    refreshTotalBar();
  }
  function renderOthers() {
    var d = state.draft, box = $('#others');
    var cats = state.conf.otherCategories || PCC.OTHER_CATEGORIES;
    var coaches = state.conf.coaches || [];
    box.innerHTML = '<datalist id="coaches">' + coaches.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      d.other.map(function (o, i) {
        var k = o.kategori || 'Lainnya', isCoach = k === 'Coaching', withHours = PCC.OTHER_WITH_HOURS.indexOf(k) >= 0;
        return '<div class="rate" data-i="' + i + '"><div class="row2"><div><label class="f" style="margin-top:0">Kategori</label>' +
          '<select class="input" data-k="kategori" data-rerender>' + cats.map(function (c) { return '<option' + (c === k ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
          '<div><label class="f" style="margin-top:0">' + (isCoach ? 'Nama coach' : 'Keterangan') + '</label><input class="input" data-k="keterangan" value="' + esc(o.keterangan) + '"' +
          (isCoach ? ' list="coaches" placeholder="Pilih coach"' : ' placeholder="Mis. nama klien / acara"') + '></div></div>' +
          '<div class="row2" style="margin-top:8px"><input class="input" data-k="nominal" inputmode="numeric" placeholder="Nominal (Rp)" value="' + (o.nominal ? fmtNum(PCC.toNum(o.nominal)) : '') + '">' +
          '<select class="input" data-k="metode">' + methodOptions(o.metode) + '</select></div>' +
          (withHours ? '<label class="f">Jam pemakaian court</label><input class="input" data-k="jam" inputmode="decimal" placeholder="0" value="' + esc(o.jam || '') + '">' : '') +
          '<button type="button" class="link-btn" data-del style="color:#7A6460">Hapus</button></div>';
      }).join('');
    $$('.rate', box).forEach(function (el) {
      var o = d.other[Number(el.dataset.i)];
      $$('[data-k]', el).forEach(function (inp) {
        inp.oninput = inp.onchange = function () {
          o[inp.dataset.k] = inp.value; saveDraft(); salesTotals();
          if (inp.hasAttribute('data-rerender')) renderOthers(); // label and hour field depend on the category
        };
        if (inp.dataset.k === 'nominal') inp.onblur = function () { if (inp.value) inp.value = fmtNum(PCC.toNum(inp.value)); };
      });
      $('[data-del]', el).onclick = function () { d.other.splice(Number(el.dataset.i), 1); saveDraft(); renderOthers(); salesTotals(); };
    });
    salesTotals();
  }

  // ---------------- page: court booking ----------------
  function pageCourt() {
    app.className = '';
    var c = state.conf, d = state.draft;
    if (d.shift && !courtShiftFor(d.shift)) {
      var filled = normalized().courts.length;
      app.innerHTML = editBanner() +
        '<section class="card"><h2><span class="num">4</span>Booking Court</h2>' +
        '<div class="alert info">Booking court dicatat <b>per hari oleh ' + esc(c.courtShift) + '</b>. Laporan ' + esc(d.shift) + ' cukup berisi penjualan dan pemasukan lain, supaya jam dan revenue court tidak terhitung dua kali.</div>' +
        (filled ? '<div class="alert warn">Form ini masih berisi ' + filled + ' baris booking court (mungkin dari shift yang dipilih sebelumnya). Laporan ' + esc(d.shift) + ' tidak bisa dikirim selama isian itu ada.<div style="margin-top:8px"><button class="chip-btn" id="clear-courts">Kosongkan booking court</button></div></div>' : '') +
        '<a class="btn" href="#/summary">Lanjut: Summary →</a></section>';
      bindEditBanner();
      $('#totalbar').hidden = true;
      var cl = $('#clear-courts');
      if (cl) cl.onclick = function () {
        d.courts = blankDraft(c).courts; saveDraft(); toast('Isian booking court dikosongkan.'); pageCourt();
      };
      return;
    }
    app.innerHTML = editBanner() +
      '<section class="card"><h2><span class="num">4</span>Booking Court<span class="right" id="court-total"></span></h2>' +
      '<p class="hint">Isi booking satu hari penuh' + (c.courtShift ? ' (dicatat oleh ' + esc(c.courtShift) + ')' : '') + '. Tambahkan satu baris per tarif. Revenue = harga per jam × total jam; total jam = jumlah booking × durasi.</p>' +
      '<datalist id="prices">' + c.priceSuggestions.map(function (p) { return '<option value="' + fmtNum(p) + '">'; }).join('') + '</datalist>' +
      PCC.COURTS.map(function (n) {
        return '<div class="court" data-court="' + n + '"><div class="court-head"><b>' + esc(c.courtNames[n - 1] || 'Court ' + n) + '</b><span class="pill" data-court-sum></span></div>' +
          ['AYO', 'Manual'].map(function (k) {
            return '<div class="cat" data-cat="' + k + '"><div class="cat-title"><span><span class="tag' + (k === 'Manual' ? ' manual' : '') + '">' + (k === 'AYO' ? 'AYO' : 'MANUAL') + '</span>' + (k === 'AYO' ? 'Booking online AYO' : 'Booking manual / admin') + '</span><span data-cat-sum></span></div>' +
              '<div data-rows></div><button type="button" class="link-btn" data-add>+ Tambah tarif</button></div>';
          }).join('') + '</div>';
      }).join('') + '</section>';
    $$('.court').forEach(function (courtEl) {
      $$('.cat', courtEl).forEach(function (catEl) { renderRates(courtEl, catEl); });
    });
    bindEditBanner();
    courtTotals();
    totalBar('Grand total sementara', '#/summary', 'Lanjut: Summary →');
  }
  function renderRates(courtEl, catEl) {
    var d = state.draft, n = Number(courtEl.dataset.court), k = catEl.dataset.cat;
    var box = $('[data-rows]', catEl);
    var idx = [];
    d.courts.forEach(function (r, i) { if (r.court === n && r.kategori === k) idx.push(i); });
    box.innerHTML = idx.map(function (i) {
      var r = d.courts[i];
      return '<div class="rate" data-i="' + i + '"><div class="rate-grid">' +
        '<div><label>Harga / jam</label><input class="input" data-k="harga" list="prices" inputmode="numeric" placeholder="Rp" value="' + (r.harga !== '' ? fmtNum(PCC.toNum(r.harga)) : '') + '"></div>' +
        '<div><label>Jumlah booking</label><input class="input" data-k="jumlah" inputmode="numeric" placeholder="0" value="' + esc(r.jumlah) + '"></div>' +
        '<div><label>Durasi (jam)</label><input class="input" data-k="durasi" inputmode="decimal" value="' + esc(String(r.durasi).replace('.', ',')) + '"></div></div>' +
        '<div class="rate-foot"><span data-line></span>' +
        (k === 'Manual' ? '<select class="input" data-k="metode">' + methodOptions(r.metode, 'AYO') + '</select>' : '') +
        '<button type="button" class="link-btn" data-del style="color:#7A6460">Hapus</button></div></div>';
    }).join('');
    $$('.rate', box).forEach(function (el) {
      var r = d.courts[Number(el.dataset.i)];
      $$('[data-k]', el).forEach(function (inp) {
        inp.oninput = inp.onchange = function () { r[inp.dataset.k] = inp.value; saveDraft(); lineTotal(el, r); courtTotals(); };
        if (inp.dataset.k === 'harga') inp.onblur = function () { if (inp.value) inp.value = fmtNum(PCC.toNum(inp.value)); };
      });
      $('[data-del]', el).onclick = function () { d.courts.splice(Number(el.dataset.i), 1); saveDraft(); rerenderCourts(); };
      lineTotal(el, r);
    });
    $('[data-add]', catEl).onclick = function () {
      d.courts.push({ court: n, kategori: k, harga: '', jumlah: '', durasi: 1, metode: k === 'AYO' ? 'AYO' : '' });
      saveDraft(); rerenderCourts();
      var rows = $$('[data-court="' + n + '"] [data-cat="' + k + '"] .rate'); if (rows.length) $('input', rows[rows.length - 1]).focus();
    };
  }
  function rerenderCourts() { $$('.court').forEach(function (courtEl) { $$('.cat', courtEl).forEach(function (catEl) { renderRates(courtEl, catEl); }); }); courtTotals(); }
  function lineTotal(el, r) {
    var h = (PCC.toNum(r.jumlah) || 0) * (PCC.toNum(r.durasi) || 0);
    $('[data-line]', el).innerHTML = fmtHours(h) + ' · <b>' + rp((PCC.toNum(r.harga) || 0) * h) + '</b>';
  }
  function courtTotals() {
    var t = PCC.compute(normalized());
    $$('.court').forEach(function (courtEl) {
      var c = t.courts[Number(courtEl.dataset.court)];
      $('[data-court-sum]', courtEl).textContent = c.bookings + ' booking · ' + fmtHours(c.hours) + ' · ' + rp(c.revenue);
      $$('.cat', courtEl).forEach(function (catEl) {
        var b = catEl.dataset.cat === 'AYO' ? c.ayo : c.manual;
        $('[data-cat-sum]', catEl).textContent = rp(b.revenue);
      });
    });
    var el = $('#court-total'); if (el) el.textContent = rp(t.revenueCourt);
    refreshTotalBar();
  }

  // ---------------- page: summary + submit ----------------
  function summaryBlocks(t, conf) {
    var courtRows = PCC.COURTS.map(function (n) {
      var c = t.courts[n];
      return '<tr><td>' + esc((conf.courtNames[n - 1] || 'Court ' + n).replace(/\s*\(.*\)/, '')) + '</td><td class="n">' + c.bookings + '</td><td class="n">' + fmtHours(c.hours) + '</td><td class="n">' + rp(c.ayo.revenue) + '</td><td class="n">' + rp(c.manual.revenue) + '</td><td class="n"><b>' + rp(c.revenue) + '</b></td></tr>';
    }).join('');
    return '<ul class="sum-list">' +
      '<li><span>Total revenue AYO</span><b>' + rp(t.revenueAyo) + '</b></li>' +
      '<li><span>Total revenue Manual</span><b>' + rp(t.revenueManual) + '</b></li>' +
      '<li><span>Total revenue Court</span><b>' + rp(t.revenueCourt) + '</b></li>' +
      '<li><span>Total revenue Sales (' + t.salesQty + ' item)</span><b>' + rp(t.revenueSales) + '</b></li>' +
      '<li><span>Total pemasukan lainnya</span><b>' + rp(t.revenueOther) + '</b></li></ul>' +
      '<div class="grand"><span>Grand Total Revenue</span><b>' + rp(t.grandTotal) + '</b></div>' +
      '<h3>Court Utilization</h3><div class="scroll-x"><table class="t"><thead><tr><th>Court</th><th class="n">Booking</th><th class="n">Jam</th><th class="n">AYO</th><th class="n">Manual</th><th class="n">Total</th></tr></thead><tbody>' + courtRows +
      '<tr class="total"><td>Total</td><td class="n">' + t.totalBookings + '</td><td class="n">' + fmtHours(t.totalHours) + '</td><td class="n">' + rp(t.revenueAyo) + '</td><td class="n">' + rp(t.revenueManual) + '</td><td class="n">' + rp(t.revenueCourt) + '</td></tr></tbody></table></div>' +
      (Object.keys(t.byMethod).length ? '<h3>Per metode pembayaran</h3><ul class="sum-list">' + Object.keys(t.byMethod).map(function (m) { return '<li><span>' + esc(m) + '</span><b>' + rp(t.byMethod[m]) + '</b></li>'; }).join('') + '</ul>' : '');
  }

  function pageSummary() {
    app.className = '';
    $('#totalbar').hidden = true;
    var d = state.draft, conf = state.conf;
    var rep = normalized();
    var v = PCC.validate(rep, conf);
    var t = PCC.compute(rep);
    var soldLines = rep.sales.map(function (s) { return '<tr><td>' + esc(s.produk) + '</td><td class="n">' + s.qty + '</td><td>' + esc(s.metode || '-') + '</td><td class="n">' + rp(s.harga * s.qty) + '</td></tr>'; }).join('');
    app.innerHTML = editBanner() +
      '<section class="card"><h2><span class="num">5</span>Daily Summary</h2>' +
      '<ul class="sum-list"><li><span>Tanggal</span><b>' + esc(longDate(rep.tanggal)) + '</b></li><li><span>Shift</span><b>' + esc(rep.shift || '-') + '</b></li><li><span>Admin</span><b>' + esc(rep.admin || '-') + '</b></li></ul>' +
      '</section><section class="card"><h2><span class="num">Σ</span>Revenue Summary</h2>' + summaryBlocks(t, conf) + '</section>' +
      (soldLines ? '<section class="card"><h2><span class="num">🛒</span>Produk terjual</h2><div class="scroll-x"><table class="t"><thead><tr><th>Produk</th><th class="n">Qty</th><th>Metode</th><th class="n">Total</th></tr></thead><tbody>' + soldLines + '</tbody></table></div></section>' : '') +
      '<section class="card"><h2><span class="num">✓</span>Kirim laporan</h2>' +
      (v.errors.length ? '<div class="alert err"><b>Lengkapi dulu sebelum kirim:</b><ul>' + v.errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      (v.warnings.length ? '<div class="alert warn"><b>Periksa lagi:</b><ul>' + v.warnings.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      (!v.errors.length ? '<div class="alert info">Setelah dikirim, data masuk ke Google Sheets dan arsip harian di Google Drive diperbarui otomatis.</div>' : '') +
      (rep.admin && rep.shift ? '<details style="margin:10px 0"><summary class="hint" style="cursor:pointer;margin:0">Pratinjau pesan WhatsApp yang akan dikirim</summary><pre style="white-space:pre-wrap;font:12px/1.5 var(--body);background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;max-height:320px;overflow:auto">' +
        esc(PCC.waMessage(rep, { products: conf.products, shiftHours: conf.shiftHours, coaches: conf.coaches, courtShift: conf.courtShift })) + '</pre></details>' : '') +
      '<div id="overwrite-check"></div><div id="submit-msg"></div>' +
      '<button class="btn" id="submit"' + (v.errors.length ? ' disabled style="cursor:not-allowed"' : '') + '>Kirim Laporan</button>' +
      '<div class="btn-row"><a class="btn ghost" href="#/input">← Edit produk</a><a class="btn ghost" href="#/court">← Edit court</a></div></section>';
    bindEditBanner();
    var btn = $('#submit');
    if (!v.errors.length) btn.onclick = submit;
    if (!v.errors.length && !d.editOf) checkOverwrite(rep);
  }

  // Same tanggal + shift + nama already stored? Submitting replaces the whole report, so say so first.
  function checkOverwrite(rep) {
    var key = PCC.reportKey(rep.tanggal, rep.shift, rep.admin);
    API.call('history', { from: rep.tanggal, to: rep.tanggal }).then(function (r) {
      var hit = r.data.filter(function (x) { return PCC.reportKey(x.tanggal, x.shift, x.admin) === key; })[0];
      var box = $('#overwrite-check');
      if (!hit || !box) return;
      box.innerHTML = '<div class="alert warn"><b>Sudah ada laporan ' + esc(rep.shift) + ' · ' + esc(hit.admin) + ' untuk tanggal ini</b> (' + esc(hit.report_id) + ', v' + hit.version + ', ' + rp(hit.grand_total) + ').' +
        ' Kirim sekarang akan <b>menimpa seluruh isinya</b> dengan form ini. Kalau hanya ingin menambah atau membetulkan sebagian, muat laporan lama dulu.' +
        '<div style="margin-top:8px"><button class="chip-btn" id="load-old">Lihat & muat laporan lama</button></div></div>';
      $('#load-old').onclick = function () { openReport(hit.report_id); };
    }).catch(function () { /* the check is advisory; submit still works */ });
  }

  function submit() {
    if (state.submitting) return;
    var d = state.draft, btn = $('#submit');
    state.submitting = true;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mengirim laporan…';
    API.call('submit', { report: normalized(), submissionId: d.submissionId }).then(function (res) {
      state.submitting = false;
      state.lastResult = res;
      toast(res.duplicate ? 'Sudah tersimpan sebelumnya.' : res.message);
      var keep = { tanggal: d.tanggal, shift: d.shift, admin: d.admin };
      state.draft = blankDraft(state.conf);
      Object.assign(state.draft, keep); // same admin often sends Shift data again; keeps typing low
      state.draft.shift = keep.shift;
      saveDraft();
      successScreen(res);
    }).catch(function (e) {
      state.submitting = false;
      if (e.pin) { API.clearPin(); return pinScreen(e.message); }
      btn.disabled = false; btn.textContent = 'Kirim ulang';
      $('#submit-msg').innerHTML = errList(e) + '<div class="alert info">Form tidak dikosongkan. Kirim ulang aman: data tidak akan tercatat dua kali.</div>';
      toast('Gagal mengirim laporan.', 'err');
    });
  }

  function successScreen(res) {
    window.scrollTo(0, 0);
    var arch = res.archive || {};
    app.innerHTML = '<section class="card success"><div class="check">✓</div><h2>' + (res.action === 'UPDATE' ? 'Laporan Diperbarui!' : res.duplicate ? 'Sudah Tersimpan' : 'Laporan Terkirim!') + '</h2>' +
      '<p>' + esc(res.message || '') + '</p>' +
      '<ul class="sum-list" style="text-align:left"><li><span>ID laporan</span><b>' + esc(res.reportId) + '</b></li><li><span>Versi</span><b>' + esc(res.version) + '</b></li>' +
      (res.totals ? '<li><span>Grand total</span><b>' + rp(res.totals.grandTotal) + '</b></li>' : '') +
      '<li><span>Arsip Drive</span><b>' + (arch.status === 'ok' ? '<a href="' + esc(arch.url) + '" target="_blank" rel="noopener">Buka arsip</a>' : arch.status === 'error' ? 'Gagal (' + esc(arch.error) + ')' : 'Tidak aktif') + '</b></li></ul>' +
      (res.warnings && res.warnings.length ? '<div class="alert warn" style="text-align:left"><ul>' + res.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
      waBlock(res) +
      '<div class="btn-row"><a class="btn" href="#/input">Laporan baru</a><a class="btn ghost" href="#/history">Lihat riwayat</a></div></section>';
    bindWa(res.waText);
  }

  // WhatsApp: automatic (gateway) status, plus a button that opens WA with the recap ready to send.
  function waBlock(res) {
    if (!res.waText) return '';
    var wa = res.wa || {}, target = state.conf.waTarget || '';
    var status = wa.status === 'sent' ? '<div class="alert ok" style="text-align:left">✓ Rekap terkirim otomatis ke WhatsApp ' + esc(target) + '.</div>'
      : wa.status === 'error' ? '<div class="alert err" style="text-align:left">Kirim otomatis ke WhatsApp gagal (' + esc(wa.error) + '). Kirim manual dengan tombol di bawah.</div>'
      : '';
    return '<div style="text-align:left;margin-top:14px">' + status +
      '<a class="btn" style="background:linear-gradient(180deg,#25D366,#128C7E);box-shadow:0 4px 0 #0b5e54" target="_blank" rel="noopener" href="' + esc(PCC.waLink(target, res.waText)) + '">' +
      (wa.status === 'sent' ? 'Kirim ulang ke WhatsApp' : 'Kirim rekap ke WhatsApp') + (target ? '' : ' (pilih chat)') + '</a>' +
      '<div class="btn-row" style="grid-template-columns:1fr"><button type="button" class="btn ghost" id="wa-copy">Salin teks rekap</button></div>' +
      '<details style="margin-top:10px"><summary class="hint" style="cursor:pointer;margin:0">Lihat isi pesan</summary><pre id="wa-text" style="white-space:pre-wrap;font:12px/1.5 var(--body);background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;max-height:320px;overflow:auto">' + esc(res.waText) + '</pre></details></div>';
  }
  function bindWa(text) {
    var b = $('#wa-copy');
    if (!b) return;
    b.onclick = function () {
      var done = function () { toast('Teks rekap disalin.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      else { fallbackCopy(text); done(); }
    };
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* user can still copy from the preview */ }
    ta.remove();
  }

  // ---------------- page: history ----------------
  function pageHistory() {
    app.className = '';
    $('#totalbar').hidden = true;
    var h = state.hist;
    if (!h.from) { var m = PCC.rangeFor('monthly', state.conf.today); h.from = m.from; h.to = state.conf.today; }
    app.innerHTML = '<section class="card"><h2><span class="num">📁</span>Report History</h2>' +
      '<div class="row2"><div><label class="f" style="margin-top:0">Dari</label><input type="date" class="input" id="h-from" value="' + h.from + '"></div>' +
      '<div><label class="f" style="margin-top:0">Sampai</label><input type="date" class="input" id="h-to" value="' + h.to + '"></div></div>' +
      '<div id="h-list" style="margin-top:14px"><div class="empty">Memuat…</div></div></section>';
    var reload = function () {
      h.from = $('#h-from').value; h.to = $('#h-to').value;
      if (!h.from || !h.to) return;
      $('#h-list').innerHTML = '<div class="empty">Memuat…</div>';
      API.call('history', { from: h.from, to: h.to }).then(function (r) {
        var list = r.data;
        $('#h-list').innerHTML = list.length ? list.map(function (x) {
          var p = x.tanggal.split('-');
          return '<div class="hist" data-id="' + esc(x.report_id) + '"><div class="date"><b>' + Number(p[2]) + '</b><span>' + BULAN[Number(p[1]) - 1].slice(0, 3) + '</span></div>' +
            '<div class="info"><b>' + esc(x.shift) + ' · ' + esc(x.admin) + '</b><span>' + esc(x.report_id) + ' · v' + x.version + ' · ' + fmtHours(x.total_jam) + '</span></div><div class="amt">' + rp(x.grand_total) + '</div></div>';
        }).join('') : '<div class="empty">Belum ada laporan di rentang tanggal ini.</div>';
        $$('.hist').forEach(function (el) { el.onclick = function () { openReport(el.dataset.id); }; });
      }).catch(function (e) { $('#h-list').innerHTML = errList(e); });
    };
    $('#h-from').onchange = reload; $('#h-to').onchange = reload;
    reload();
  }

  function openReport(id) {
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal"><div class="modal-close"><button aria-label="Tutup">×</button></div><div class="empty">Memuat laporan…</div></div>';
    document.body.appendChild(bg);
    var close = function () { bg.remove(); };
    $('.modal-close button', bg).onclick = close;
    bg.onclick = function (e) { if (e.target === bg) close(); };
    API.call('report', { reportId: id }).then(function (r) {
      var rep = r.data;
      var norm = PCC.normalize(rep);
      var t = PCC.compute(norm);
      var body = '<section class="card"><h2><span class="num">📄</span>' + esc(rep.report_id) + '</h2>' +
        '<ul class="sum-list"><li><span>Tanggal</span><b>' + esc(longDate(rep.tanggal)) + '</b></li><li><span>Shift · Admin</span><b>' + esc(rep.shift) + ' · ' + esc(rep.admin) + '</b></li>' +
        '<li><span>Versi</span><b>' + esc(rep.version) + '</b></li><li><span>Terakhir diperbarui</span><b>' + esc(String(rep.updated_at || '').replace('T', ' ').slice(0, 16)) + '</b></li>' +
        (rep.archive_url ? '<li><span>Arsip Drive</span><b><a href="' + esc(rep.archive_url) + '" target="_blank" rel="noopener">Buka</a></b></li>' : '') + '</ul>' +
        (rep.catatan ? '<div class="alert info"><b>Catatan:</b> ' + esc(rep.catatan) + '</div>' : '') + '</section>' +
        '<section class="card">' + summaryBlocks(t, state.conf) + '</section>' +
        '<button class="btn" id="correct">Koreksi laporan ini</button>';
      $('.modal', bg).innerHTML = '<div class="modal-close"><button aria-label="Tutup">×</button></div>' + body;
      $('.modal-close button', bg).onclick = close;
      $('#correct').onclick = function () {
        if (!confirm('Muat laporan ini ke form untuk dikoreksi? Draft yang sedang diisi akan diganti.')) return;
        var dr = blankDraft(state.conf);
        dr.tanggal = rep.tanggal; dr.shift = rep.shift; dr.admin = rep.admin; dr.catatan = rep.catatan || ''; dr.editOf = rep.report_id;
        // Put stored quantities onto the product list; keep split-payment rows.
        var used = {};
        norm.sales.forEach(function (s) {
          var idx = -1;
          dr.sales.forEach(function (x, i) { if (idx < 0 && x.produk === s.produk && !used[i]) idx = i; });
          if (idx >= 0) { used[idx] = true; dr.sales[idx].qty = s.qty; dr.sales[idx].metode = s.metode; dr.sales[idx].harga = s.harga; }
          else { dr.sales.push({ produk: s.produk, harga: s.harga, harga_modal: s.harga_modal, qty: s.qty, metode: s.metode }); used[dr.sales.length - 1] = true; }
        });
        dr.courts = norm.courts.map(function (c) { return { court: c.court, kategori: c.kategori, harga: c.harga, jumlah: c.jumlah, durasi: c.durasi, metode: c.metode }; });
        PCC.COURTS.forEach(function (n) { ['AYO', 'Manual'].forEach(function (k) {
          if (!dr.courts.some(function (c) { return c.court === n && c.kategori === k; })) dr.courts.push({ court: n, kategori: k, harga: '', jumlah: '', durasi: 1, metode: k === 'AYO' ? 'AYO' : '' });
        }); });
        dr.other = norm.other.map(function (o) { return { kategori: o.kategori, keterangan: o.keterangan, nominal: o.nominal, jam: o.jam || '', metode: o.metode }; });
        state.draft = dr; saveDraft(); close();
        location.hash = '#/input';
        toast('Laporan dimuat. Ubah lalu kirim ulang dari halaman Summary.');
      };
    }).catch(function (e) { $('.modal', bg).innerHTML = '<div class="modal-close"><button aria-label="Tutup">×</button></div>' + errList(e); $('.modal-close button', bg).onclick = close; });
  }

  // ---------------- page: dashboard ----------------
  function destroyCharts() { state.charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); state.charts = []; }

  function pageDashboard() {
    app.className = 'wide';
    $('#totalbar').hidden = true;
    var s = state.dash;
    if (!s.ref) { s.ref = state.conf.today; s.from = s.ref; s.to = s.ref; }
    app.innerHTML = '<section class="card"><h2><span class="num">📊</span>Dashboard Manajemen<span class="right" id="d-range"></span></h2>' +
      '<div class="filters"><div class="seg" id="d-mode">' + [['daily', 'Harian'], ['weekly', 'Mingguan'], ['monthly', 'Bulanan'], ['custom', 'Custom']].map(function (m) {
        return '<button type="button" data-m="' + m[0] + '" class="' + (s.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>';
      }).join('') + '</div><div class="dates" id="d-dates"></div></div></section><div id="d-body"><div class="empty">Memuat data…</div></div>';
    var dates = function () {
      $('#d-dates').innerHTML = s.mode === 'custom'
        ? '<input type="date" class="input" id="d-from" value="' + s.from + '"><input type="date" class="input" id="d-to" value="' + s.to + '">'
        : '<input type="date" class="input" id="d-ref" value="' + s.ref + '" title="Tanggal acuan">';
      if (s.mode === 'custom') { $('#d-from').onchange = function () { s.from = this.value; fetchDash(); }; $('#d-to').onchange = function () { s.to = this.value; fetchDash(); }; }
      else $('#d-ref').onchange = function () { s.ref = this.value || state.conf.today; fetchDash(); };
    };
    $$('#d-mode button').forEach(function (b) {
      b.onclick = function () {
        s.mode = b.dataset.m; $$('#d-mode button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (s.mode === 'custom' && (!s.from || !s.to)) { var r = PCC.rangeFor('weekly', s.ref); s.from = r.from; s.to = r.to; }
        dates(); fetchDash();
      };
    });
    dates(); fetchDash();
  }

  function fetchDash() {
    var s = state.dash;
    var r = s.mode === 'custom' ? { from: s.from, to: s.to } : PCC.rangeFor(s.mode, s.ref);
    if (!r.from || !r.to || r.from > r.to) { $('#d-body').innerHTML = '<div class="alert err">Rentang tanggal tidak valid.</div>'; return; }
    $('#d-range').textContent = r.from === r.to ? longDate(r.from) : r.from + ' s.d. ' + r.to;
    $('#d-body').innerHTML = '<div class="empty">Memuat data…</div>';
    API.call('dashboard', { from: r.from, to: r.to }).then(function (res) { renderDash(res.data); })
      .catch(function (e) { $('#d-body').innerHTML = errList(e); });
  }

  function renderDash(data) {
    destroyCharts();
    var k = data.kpi;
    var maxCourt = Math.max.apply(null, data.courts.map(function (c) { return c.revenue; }).concat([1]));
    var top = data.topProducts.slice(0, 8);
    var maxProd = Math.max.apply(null, top.map(function (p) { return p.total; }).concat([1]));
    $('#d-body').innerHTML =
      '<div class="kpis">' +
      '<div class="kpi hl"><span>Total revenue</span><b>' + rp(k.grandTotal) + '</b></div>' +
      '<div class="kpi"><span>Total booking</span><b>' + fmtNum(k.totalBookings) + '</b></div>' +
      '<div class="kpi"><span>Jam penggunaan court</span><b>' + fmtHours(k.totalHours) + '</b></div>' +
      '<div class="kpi"><span>Total sales produk</span><b>' + rp(k.revenueSales) + '</b></div>' +
      '<div class="kpi"><span>Revenue AYO</span><b>' + rp(k.revenueAyo) + '</b></div>' +
      '<div class="kpi"><span>Revenue Manual</span><b>' + rp(k.revenueManual) + '</b></div>' +
      '<div class="kpi"><span>Pemasukan lainnya</span><b>' + rp(k.revenueOther) + '</b></div>' +
      '<div class="kpi"><span>Laporan masuk</span><b>' + k.reportCount + ' <small style="font:500 12px var(--body);color:var(--muted)">(' + k.days + ' hari)</small></b></div></div>' +
      '<div class="grid2">' +
      '<section class="card"><h2>AYO vs Manual</h2><div class="chart-box"><canvas id="c-ayo"></canvas></div></section>' +
      '<section class="card"><h2>Revenue per Court</h2>' + data.courts.map(function (c) {
        return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between"><b>Court ' + c.court + '</b><b>' + rp(c.revenue) + '</b></div>' +
          '<div class="bar"><i style="width:' + Math.round(c.revenue / maxCourt * 100) + '%"></i></div>' +
          '<div class="hint" style="margin:4px 0 0">' + c.bookings + ' booking · ' + fmtHours(c.hours) + ' · AYO ' + rp(c.ayo) + ' · Manual ' + rp(c.manual) + '</div></div>';
      }).join('') + '</section></div>' +
      (data.daily.length > 1 ? '<section class="card"><h2>Tren revenue harian</h2><div class="chart-box"><canvas id="c-trend"></canvas></div></section>' : '') +
      '<div class="grid2"><section class="card"><h2>Produk terlaris</h2>' + (top.length ? top.map(function (p) {
        return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px"><span>' + esc(p.produk) + ' <span class="hint">×' + p.qty + '</span></span><b>' + rp(p.total) + '</b></div><div class="bar"><i style="width:' + Math.round(p.total / maxProd * 100) + '%"></i></div></div>';
      }).join('') : '<div class="empty">Belum ada penjualan.</div>') + '</section>' +
      '<section class="card"><h2>Riwayat laporan</h2>' + (data.reports.length ? data.reports.slice(0, 10).map(function (x) {
        return '<div class="hist" data-id="' + esc(x.report_id) + '"><div class="info"><b>' + esc(longDate(x.tanggal)) + '</b><span>' + esc(x.shift) + ' · ' + esc(x.admin) + ' · v' + x.version + '</span></div><div class="amt">' + rp(x.grand_total) + '</div></div>';
      }).join('') : '<div class="empty">Belum ada laporan di rentang ini.</div>') + '</section></div>';
    $$('#d-body .hist').forEach(function (el) { el.onclick = function () { openReport(el.dataset.id); }; });
    if (!window.Chart) return; // charts are a bonus; numbers above still show without the CDN
    Chart.defaults.font.family = 'Poppins, system-ui, sans-serif';
    var ayo = $('#c-ayo');
    if (ayo) state.charts.push(new Chart(ayo, {
      type: 'doughnut',
      data: { labels: ['AYO', 'Manual'], datasets: [{ data: [k.revenueAyo, k.revenueManual], backgroundColor: ['#A23B2C', '#5B4A47'], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + rp(c.raw); } } } } }
    }));
    var tr = $('#c-trend');
    if (tr) state.charts.push(new Chart(tr, {
      type: 'bar',
      data: {
        labels: data.daily.map(function (d) { var p = d.tanggal.split('-'); return Number(p[2]) + ' ' + BULAN[Number(p[1]) - 1].slice(0, 3); }),
        datasets: [
          { label: 'Court', data: data.daily.map(function (d) { return d.court; }), backgroundColor: '#7B1E1E', stack: 's' },
          { label: 'Sales', data: data.daily.map(function (d) { return d.sales; }), backgroundColor: '#E8A15A', stack: 's' },
          { label: 'Lainnya', data: data.daily.map(function (d) { return d.other; }), backgroundColor: '#C9B8B4', stack: 's' }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: function (v) { return v >= 1e6 ? (v / 1e6).toString().replace('.', ',') + ' jt' : v >= 1e3 ? v / 1e3 + ' rb' : v; } } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + rp(c.raw); } } } }
      }
    }));
  }

  // ---------------- start ----------------
  logo();
  if (!API.live) $('#demo-banner').hidden = false;
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', function (e) { if (state.submitting) { e.preventDefault(); e.returnValue = ''; } });
  route();
})();
