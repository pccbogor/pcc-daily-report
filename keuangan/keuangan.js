/**
 * PCC Keuangan — manager-only site for the Petty Cash ledger and Pengajuan & Reimbursment.
 * Talks to the same Apps Script web app as the daily report (actions "fin_*", MANAGER_PIN).
 */
(function () {
  var CFG = window.PCC_CONFIG || {};
  var API_URL = CFG.API_URL;
  var PIN_KEY = 'pcc_mgr_pin';
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var app = document.getElementById('app');
  var state = { data: null, pettyEdit: null, pjItems: null };

  // ---------------- helpers ----------------
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rp(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-Rp' : 'Rp') + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function num(v) { var s = String(v == null ? '' : v).replace(/[^0-9,.\-]/g, ''); if (!s) return 0; s = s.replace(/\./g, '').replace(',', '.'); return Number(s) || 0; }
  function today() { var d = new Date(Date.now() + 7 * 3600000); return d.toISOString().slice(0, 10); }
  function dayParts(ymd) { if (!ymd) return ['?', '']; var p = ymd.split('-'); return [Number(p[2]), BULAN[Number(p[1]) - 1].slice(0, 3)]; }
  function longDate(ymd) { if (!ymd) return '-'; var p = ymd.split('-'); return Number(p[2]) + ' ' + BULAN[Number(p[1]) - 1] + ' ' + p[0]; }
  function links(text) {
    return String(text || '').split(/\n/).filter(Boolean).map(function (u, i) {
      return /^https?:/.test(u) ? '<a class="tiny-btn" target="_blank" rel="noopener" href="' + esc(u) + '">📎 Bukti ' + (i + 1) + '</a>' : '<span class="tiny-btn">📎 ' + esc(u) + '</span>';
    }).join('');
  }
  function toast(msg, kind) {
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'ok'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
  }
  function datalist(id, items) { return '<datalist id="' + id + '">' + (items || []).map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; }
  function busy(btn, on, label) { btn.disabled = on; btn.innerHTML = on ? '<span class="spinner"></span> ' + label : label; }

  function getPin() { try { return sessionStorage.getItem(PIN_KEY) || localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
  function setPin(p, remember) { try { sessionStorage.setItem(PIN_KEY, p); if (remember) localStorage.setItem(PIN_KEY, p); } catch (e) { /* ignore */ } }
  function clearPin() { try { sessionStorage.removeItem(PIN_KEY); localStorage.removeItem(PIN_KEY); } catch (e) { /* ignore */ } }

  function call(action, payload) {
    if (!API_URL) return Promise.reject(new Error('API_URL belum diisi di assets/config.js'));
    var body = Object.assign({ action: action, pin: getPin() }, payload || {});
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('Server error ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d.ok) { var e = new Error(d.error || 'Gagal memproses.'); if (/PIN/.test(d.error || '')) e.pin = true; throw e; }
        return d;
      }, function (err) {
        if (err.pin) throw err;
        throw new Error(navigator.onLine === false ? 'Tidak ada koneksi internet. Isian masih ada di form, coba lagi.' : (err.message || 'Gagal terhubung ke server.'));
      });
  }

  // ---------------- photos: shrink big images before upload ----------------
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = function () { reject(new Error('Gagal membaca file ' + file.name)); };
      r.readAsDataURL(file);
    });
  }
  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size < 400 * 1024 || !window.createImageBitmap) {
      return readFile(file).then(function (data) { return { name: file.name, mime: file.type || 'application/octet-stream', data: data }; });
    }
    return createImageBitmap(file).then(function (img) {
      var max = 1800, scale = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var data = c.toDataURL('image/jpeg', 0.82).split(',')[1];
      return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: data };
    }).catch(function () { return readFile(file).then(function (data) { return { name: file.name, mime: file.type, data: data }; }); });
  }
  function packFiles(list) { return Promise.all(Array.prototype.slice.call(list || []).map(shrink)); }
  function fileNames(list) { return Array.prototype.slice.call(list || []).map(function (f) { return f.name; }).join(', '); }

  // ---------------- attachment picker: camera (phone or webcam) + file chooser ----------------
  var PICK = {};
  function pickerHtml(key) {
    return '<div class="picker" data-picker="' + key + '">' +
      '<div class="pick-btns"><button type="button" class="chip-btn" data-cam>📷 Kamera</button><button type="button" class="chip-btn" data-pick>📁 Pilih File</button></div>' +
      '<input type="file" hidden data-in accept="image/*,application/pdf" multiple>' +
      '<input type="file" hidden data-camin accept="image/*" capture="environment">' +
      '<div class="thumbs"></div></div>';
  }
  function clearPicks(prefix) { Object.keys(PICK).forEach(function (k) { if (k.indexOf(prefix) === 0) delete PICK[k]; }); }
  function isTouch() { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function bindPickers(root) {
    $$('[data-picker]', root).forEach(function (el) {
      var key = el.dataset.picker;
      PICK[key] = PICK[key] || [];
      var draw = function () {
        $('.thumbs', el).innerHTML = PICK[key].map(function (f, i) {
          var img = /^image\//.test(f.type) && !/heic|heif/i.test(f.type) ? '<img src="' + URL.createObjectURL(f) + '" alt="">' : '<span class="doc">' + (/pdf/i.test(f.type) ? 'PDF' : 'FOTO') + '</span>';
          return '<div class="thumb" title="' + esc(f.name) + '">' + img + '<button type="button" data-x="' + i + '" aria-label="Hapus lampiran">×</button></div>';
        }).join('');
        $$('[data-x]', el).forEach(function (b) { b.onclick = function () { PICK[key].splice(Number(b.dataset.x), 1); draw(); }; });
      };
      var add = function (files) { Array.prototype.forEach.call(files || [], function (f) { PICK[key].push(f); }); draw(); };
      $('[data-in]', el).onchange = function () { add(this.files); this.value = ''; };
      $('[data-camin]', el).onchange = function () { add(this.files); this.value = ''; };
      $('[data-pick]', el).onclick = function () { $('[data-in]', el).click(); };
      $('[data-cam]', el).onclick = function () {
        if (isTouch() || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return $('[data-camin]', el).click();
        openCamera(function (file) { add([file]); }, function () { $('[data-camin]', el).click(); });
      };
      draw();
    });
  }
  /** Webcam / laptop camera in a modal; each shot becomes a JPEG File. */
  function openCamera(onShot, onFail) {
    var facing = 'environment', stream = null, shots = 0;
    var bg = document.createElement('div');
    bg.className = 'cam-bg';
    bg.innerHTML = '<div class="cam"><video playsinline autoplay muted></video><div class="cam-info">Arahkan kamera ke struk / nota</div>' +
      '<div class="cam-btns"><button type="button" class="chip-btn" data-flip>🔄 Ganti kamera</button><button type="button" class="btn" data-shot>📸 Ambil foto</button><button type="button" class="chip-btn" data-done>Selesai</button></div></div>';
    document.body.appendChild(bg);
    var video = $('video', bg);
    var stop = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; };
    var close = function () { stop(); bg.remove(); };
    var start = function () {
      stop();
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 } }, audio: false }).then(function (s) {
        stream = s; video.srcObject = s;
      }, function () { close(); toast('Kamera tidak bisa dibuka. Pilih foto dari file.', 'err'); if (onFail) onFail(); });
    };
    $('[data-flip]', bg).onclick = function () { facing = facing === 'environment' ? 'user' : 'environment'; start(); };
    $('[data-done]', bg).onclick = close;
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('[data-shot]', bg).onclick = function () {
      if (!video.videoWidth) return;
      var c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob(function (blob) {
        var stamp = new Date(Date.now() + 7 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
        onShot(new File([blob], 'Kamera-' + stamp + '.jpg', { type: 'image/jpeg' }));
        shots++; $('.cam-info', bg).textContent = shots + ' foto diambil. Ambil lagi atau tekan Selesai.';
      }, 'image/jpeg', 0.85);
    };
    start();
  }

  // ---------------- PIN ----------------
  function pinScreen(message) {
    app.innerHTML = '<section class="card"><h2><span class="num">🔒</span>Masuk Manajer</h2>' +
      (message ? '<div class="alert err">' + esc(message) + '</div>' : '') +
      '<label class="f" for="pin">PIN manajer <span class="req">*</span></label>' +
      '<input id="pin" class="input" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••">' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px"><input type="checkbox" id="remember"> Ingat di perangkat ini</label>' +
      '<button class="btn" id="pin-go" style="margin-top:14px">Masuk</button></section>';
    var go = function () {
      var p = $('#pin').value.trim(); if (!p) return;
      setPin(p, $('#remember').checked);
      busy($('#pin-go'), true, 'Memeriksa…');
      load(true);
    };
    $('#pin-go').onclick = go;
    $('#pin').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    $('#pin').focus();
  }

  function load(force) {
    if (!getPin()) return pinScreen();
    if (state.data && !force) return Promise.resolve(route());
    app.innerHTML = '<div class="empty"><span class="spinner" style="border-color:#e6cfc8;border-top-color:#7B1E1E;display:inline-block"></span></div>';
    return call('fin_summary').then(function (r) { state.data = r.data; route(); }, function (e) {
      if (e.pin) { clearPin(); return pinScreen(e.message); }
      app.innerHTML = '<div class="alert err">' + esc(e.message) + '</div><button class="btn" id="retry">Coba lagi</button>';
      $('#retry').onclick = function () { load(true); };
    });
  }

  function route() {
    var r = (location.hash.replace(/^#\//, '') || 'ringkasan').split('?')[0];
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === r); });
    if (!state.data) return load();
    if (r === 'petty') return pettyPage();
    if (r === 'pengajuan') return pengajuanPage();
    return summaryPage();
  }

  // ---------------- Ringkasan ----------------
  function summaryPage() {
    var d = state.data;
    var open = d.pengajuan.reduce(function (s, g) { return s + g.total - g.lunas; }, 0);
    var recent = d.petty.slice(0, 8);
    app.innerHTML =
      '<div class="kpis three" style="margin-bottom:16px">' +
      '<div class="kpi hl"><span>Sisa Saldo Petty Cash</span><b>' + rp(d.saldo) + '</b></div>' +
      '<div class="kpi"><span>Total Masuk (Kredit)</span><b class="money-in">' + rp(d.totalKredit) + '</b></div>' +
      '<div class="kpi"><span>Pengajuan belum dibayar</span><b>' + rp(open) + '</b></div></div>' +
      '<div class="btn-row" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' +
      '<a class="btn" style="flex:1;text-align:center;text-decoration:none" href="#/petty">+ Catat Petty Cash</a>' +
      '<a class="btn" style="flex:1;text-align:center;text-decoration:none;background:var(--brick)" href="#/pengajuan">+ Buat Pengajuan</a></div>' +
      '<section class="card"><h2>Transaksi Petty Cash terakhir <a class="right sheet-link" target="_blank" rel="noopener" href="' + esc(d.pettyUrl) + '">Buka spreadsheet ↗</a></h2>' +
      (recent.length ? recent.map(entryHtml).join('') : '<div class="empty">Belum ada transaksi.</div>') + '</section>' +
      '<section class="card"><h2>Pengajuan terakhir</h2>' +
      (d.pengajuan.length ? d.pengajuan.slice(0, 5).map(function (g) {
        var p = dayParts(g.tanggal);
        return '<div class="entry"><div class="when"><b>' + p[0] + '</b><span>' + p[1] + '</span></div><div class="what"><b>' + g.items.length + ' item</b><small>' +
          esc(g.items.map(function (i) { return i.keterangan; }).join(', ')) + '</small></div><div class="amt">' + rp(g.total) +
          '<div>' + (g.lunas >= g.total ? '<span class="pill lunas">Lunas</span>' : '<span class="pill wait">Belum lunas</span>') + '</div></div></div>';
      }).join('') : '<div class="empty">Belum ada pengajuan dari website.</div>') + '</section>';
    bindEntryActions();
  }

  function entryHtml(r) {
    var p = r.tanggal ? dayParts(r.tanggal) : [esc(r.tanggalText).slice(0, 6), ''];
    var amt = r.kredit ? '<span class="money-in">+' + rp(r.kredit) + '</span>' : '';
    if (r.debit) amt += (amt ? '<br>' : '') + '<span class="money-out">-' + rp(r.debit) + '</span>';
    return '<div class="entry"><div class="when"><b>' + p[0] + '</b><span>' + p[1] + '</span></div>' +
      '<div class="what"><b>' + esc(r.transaksi) + '</b><small>' + esc([r.kategori, r.akun].filter(Boolean).join(' · ') || '—') + '</small>' +
      '<div class="acts">' + links(r.nota) + '<button class="tiny-btn" data-edit="' + r.row + '">Edit</button><button class="tiny-btn danger" data-del="' + r.row + '">Hapus</button></div></div>' +
      '<div class="amt">' + amt + '</div></div>';
  }

  function bindEntryActions() {
    $$('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        state.pettyEdit = state.data.petty.filter(function (r) { return r.row === Number(b.dataset.edit); })[0];
        if (location.hash !== '#/petty') location.hash = '#/petty'; else pettyPage();
        window.scrollTo(0, 0);
      };
    });
    $$('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var r = state.data.petty.filter(function (x) { return x.row === Number(b.dataset.del); })[0];
        if (!r || !confirm('Hapus transaksi "' + r.transaksi + '" (' + rp(r.debit || r.kredit) + ') dari Petty Cash?')) return;
        b.disabled = true;
        call('fin_petty_delete', { row: r.row, fp: r.fp }).then(function () { toast('Transaksi dihapus.'); load(true); }, function (e) { b.disabled = false; toast(e.message, 'err'); });
      };
    });
  }

  // ---------------- Petty Cash ----------------
  function pettyPage() {
    var d = state.data, ed = state.pettyEdit;
    var masuk = ed ? (ed.kredit > 0 && !ed.debit) : false;
    var months = {};
    d.petty.forEach(function (r) { if (r.tanggal) months[r.tanggal.slice(0, 7)] = true; });
    app.innerHTML =
      '<section class="card"><h2><span class="num">' + (ed ? '✎' : '+') + '</span>' + (ed ? 'Edit transaksi' : 'Catat transaksi Petty Cash') +
      '<span class="right pill">Saldo ' + rp(d.saldo) + '</span></h2>' +
      (ed ? '<div class="alert warn">Mengedit baris ' + ed.row + ' di spreadsheet. <button class="tiny-btn" id="cancel-edit">Batal</button></div>' : '') +
      '<label class="f">Jenis <span class="req">*</span></label><div class="seg" id="jenis"><button type="button" data-v="out" class="' + (masuk ? '' : 'on') + '">Keluar (Debit)</button><button type="button" data-v="in" class="' + (masuk ? 'on' : '') + '">Masuk (Kredit)</button></div>' +
      '<div class="row2"><div><label class="f" for="p-tgl">Tanggal <span class="req">*</span></label><input class="input" type="date" id="p-tgl" value="' + esc(ed ? ed.tanggal || today() : today()) + '"></div>' +
      '<div><label class="f" for="p-nom">Nominal <span class="req">*</span></label><input class="input" id="p-nom" inputmode="numeric" placeholder="0" value="' + esc(ed ? (ed.debit || ed.kredit) : '') + '"></div></div>' +
      '<label class="f" for="p-trx">Nama transaksi <span class="req">*</span></label><input class="input" id="p-trx" placeholder="mis. Token Listrik 200K" value="' + esc(ed ? ed.transaksi : '') + '">' +
      '<div class="row2"><div><label class="f" for="p-kat">Kategori</label><input class="input" id="p-kat" list="dl-kat" value="' + esc(ed ? ed.kategori : '') + '"></div>' +
      '<div><label class="f" for="p-akun">Ke Account / Toko</label><input class="input" id="p-akun" list="dl-akun" placeholder="mis. Listrik KWh 2, Indomaret" value="' + esc(ed ? ed.akun : '') + '"></div></div>' +
      datalist('dl-kat', d.suggest.kategori) + datalist('dl-akun', d.suggest.akun) +
      '<label class="f">Foto struk / nota ' + (ed ? '(tambahan)' : '') + '</label>' + pickerHtml('petty') +
      (ed && ed.nota ? '<div class="acts" style="margin-top:6px">' + links(ed.nota) + '</div>' : '') +
      '<div id="p-msg"></div><button class="btn" id="p-save" style="margin-top:14px">' + (ed ? 'Simpan perubahan' : 'Simpan ke Petty Cash') + '</button></section>' +
      '<section class="card"><h2>Riwayat Petty Cash<span class="right"><select class="input" id="p-month" style="width:auto;padding:6px 10px"><option value="">Semua (150 terakhir)</option>' +
      Object.keys(months).sort().reverse().map(function (m) { var p = m.split('-'); return '<option value="' + m + '">' + BULAN[Number(p[1]) - 1] + ' ' + p[0] + '</option>'; }).join('') +
      '</select></span></h2><div id="p-list"></div></section>';
    var jenis = masuk ? 'in' : 'out';
    $$('#jenis button').forEach(function (b) { b.onclick = function () { jenis = b.dataset.v; $$('#jenis button').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    bindPickers(app);
    if ($('#cancel-edit')) $('#cancel-edit').onclick = function () { state.pettyEdit = null; pettyPage(); };
    var list = function () {
      var m = $('#p-month').value;
      var rows = d.petty.filter(function (r) { return !m || (r.tanggal || '').slice(0, 7) === m; });
      var tin = 0, tout = 0; rows.forEach(function (r) { tin += r.kredit; tout += r.debit; });
      $('#p-list').innerHTML = (m ? '<div class="alert info">Masuk ' + rp(tin) + ' · Keluar ' + rp(tout) + '</div>' : '') +
        (rows.length ? rows.map(entryHtml).join('') : '<div class="empty">Tidak ada transaksi.</div>');
      bindEntryActions();
    };
    $('#p-month').onchange = list; list();
    $('#p-save').onclick = function () {
      var btn = this, nominal = num($('#p-nom').value);
      var entry = { tanggal: $('#p-tgl').value, transaksi: $('#p-trx').value.trim(), kredit: jenis === 'in' ? nominal : 0, debit: jenis === 'out' ? nominal : 0,
        kategori: $('#p-kat').value.trim(), akun: $('#p-akun').value.trim() };
      if (!entry.tanggal || !entry.transaksi || !nominal) { $('#p-msg').innerHTML = '<div class="alert err">Tanggal, nama transaksi dan nominal wajib diisi.</div>'; return; }
      busy(btn, true, 'Menyimpan…');
      packFiles(PICK.petty).then(function (files) {
        return ed ? call('fin_petty_update', { row: ed.row, fp: ed.fp, entry: entry, files: files }) : call('fin_petty_add', { entry: entry, files: files });
      }).then(function () {
        toast(ed ? 'Perubahan disimpan.' : 'Transaksi tercatat di Petty Cash.');
        state.pettyEdit = null; PICK.petty = []; load(true);
      }, function (e) {
        busy(btn, false, ed ? 'Simpan perubahan' : 'Simpan ke Petty Cash');
        if (e.pin) { clearPin(); return pinScreen(e.message); }
        $('#p-msg').innerHTML = '<div class="alert err">' + esc(e.message) + '</div>';
      });
    };
  }

  // ---------------- Pengajuan ----------------
  function blankItem() { return { keterangan: '', qty: 1, kategori: '', satuan: 'Unit', nominal: '', dp: '', tanggal_dp: '', atas_nama: '', no_rekening: '', bank: '', source: '' }; }

  function pengajuanPage() {
    var d = state.data;
    if (!state.pjItems) { clearPicks('pj'); state.pjItems = [blankItem()]; state.pjDate = today(); state.pjEditing = false; }
    var s = d.suggest;
    app.innerHTML =
      '<section class="card"><h2><span class="num">' + (state.pjEditing ? '✎' : '+') + '</span>' + (state.pjEditing ? 'Edit pengajuan ' + longDate(state.pjDate) : 'Form Pengajuan & Reimbursment') + '</h2>' +
      (state.pjEditing ? '<div class="alert warn">Mengedit item yang dipilih. <button class="tiny-btn" id="pj-cancel">Batal</button></div>' : '') +
      '<label class="f" for="pj-date">Tanggal pengajuan <span class="req">*</span></label><input class="input" type="date" id="pj-date" value="' + esc(state.pjDate) + '"' + (state.pjEditing ? ' disabled' : '') + '>' +
      '<div class="hint" style="margin:4px 0 0">Semua item di tanggal yang sama masuk ke satu file "Pengajuan dan Reimbursment ' + esc(longDate(state.pjDate)) + '".</div>' +
      '<div id="pj-items" style="margin-top:12px"></div>' +
      (state.pjEditing ? '' : '<button class="chip-btn" id="pj-add">+ Tambah item</button>') +
      datalist('dl-pjkat', s.pjKategori) + datalist('dl-sat', s.satuan) + datalist('dl-src', s.source) + datalist('dl-an', Object.keys(s.accounts)) +
      '<div id="pj-msg"></div><button class="btn" id="pj-save" style="margin-top:14px">Simpan pengajuan</button></section>' +
      '<section class="card"><h2>Daftar Pengajuan</h2><div id="pj-list"></div></section>';
    renderItems();
    $('#pj-date').onchange = function () { state.pjDate = this.value; };
    if ($('#pj-add')) $('#pj-add').onclick = function () { syncItems(); state.pjItems.push(blankItem()); renderItems(); };
    if ($('#pj-cancel')) $('#pj-cancel').onclick = function () { state.pjItems = null; pengajuanPage(); };
    $('#pj-save').onclick = savePengajuan;
    renderGroups();
  }

  function renderItems() {
    $('#pj-items').innerHTML = state.pjItems.map(function (it, i) {
      var f = function (k, label, attrs) { return '<div><label class="f">' + label + '</label><input class="input" data-k="' + k + '" value="' + esc(it[k]) + '" ' + (attrs || '') + '></div>'; };
      return '<div class="item-card" data-i="' + i + '"><div class="head">Item ' + (i + 1) + (state.pjItems.length > 1 && !it.item_id ? '<button class="tiny-btn danger" data-rm="' + i + '">Hapus</button>' : '') + '</div>' +
        '<label class="f">Keterangan <span class="req">*</span></label><input class="input" data-k="keterangan" value="' + esc(it.keterangan) + '" placeholder="mis. Token Listrik 500k">' +
        '<div class="row3">' + f('qty', 'Qty', 'inputmode="decimal"') + f('satuan', 'Satuan', 'list="dl-sat"') + f('kategori', 'Kategori', 'list="dl-pjkat"') + '</div>' +
        '<div class="row3">' + f('nominal', 'Nominal / harga satuan <span class="req">*</span>', 'inputmode="numeric" placeholder="0"') + f('dp', 'DP / Disc', 'inputmode="numeric" placeholder="0"') + f('tanggal_dp', 'Tanggal DP', 'type="date"') + '</div>' +
        '<div class="row3">' + f('atas_nama', 'Atas nama (A/N)', 'list="dl-an"') + f('no_rekening', 'No. rekening', 'inputmode="numeric"') + f('bank', 'Bank') + '</div>' +
        f('source', 'Source', 'list="dl-src" placeholder="mis. Transfer Owner"') +
        '<label class="f">Lampiran (foto nota / invoice)' + (it.item_id ? ' — tambahan' : '') + '</label>' + pickerHtml('pj' + i) + (it.nota ? '<div class="acts">' + links(it.nota) + '</div>' : '') + '</div>';
    }).join('');
    $$('#pj-items [data-rm]').forEach(function (b) { b.onclick = function () { syncItems(); var idx = Number(b.dataset.rm); state.pjItems.splice(idx, 1);
      for (var k = idx; k < state.pjItems.length; k++) PICK['pj' + k] = PICK['pj' + (k + 1)] || [];
      delete PICK['pj' + state.pjItems.length]; renderItems(); }; });
    bindPickers($('#pj-items'));
    $$('#pj-items [data-k="atas_nama"]').forEach(function (inp) {
      inp.onchange = function () {
        var acc = state.data.suggest.accounts[inp.value.trim()]; if (!acc) return;
        var card = inp.closest('.item-card');
        if (!$('[data-k="no_rekening"]', card).value) $('[data-k="no_rekening"]', card).value = acc.no_rekening || '';
        if (!$('[data-k="bank"]', card).value) $('[data-k="bank"]', card).value = acc.bank || '';
      };
    });
  }

  function syncItems() {
    $$('#pj-items .item-card').forEach(function (card) {
      var it = state.pjItems[Number(card.dataset.i)];
      $$('[data-k]', card).forEach(function (inp) { it[inp.dataset.k] = inp.value.trim(); });
    });
  }

  function savePengajuan() {
    syncItems();
    var btn = $('#pj-save');
    var bad = state.pjItems.filter(function (it) { return !it.keterangan || !num(it.nominal); });
    if (!state.pjDate || bad.length) { $('#pj-msg').innerHTML = '<div class="alert err">Isi tanggal, serta keterangan dan nominal setiap item.</div>'; return; }
    var items = state.pjItems.map(function (it) { return Object.assign({}, it, { nominal: num(it.nominal), dp: num(it.dp), qty: num(it.qty) || 1 }); });
    busy(btn, true, 'Menyimpan…');
    var keys = state.pjItems.map(function (x, i) { return i; }).filter(function (i) { return (PICK['pj' + i] || []).length; });
    Promise.all(keys.map(function (k) { return packFiles(PICK['pj' + k]); })).then(function (packed) {
      var files = {}; keys.forEach(function (k, i) { files[k] = packed[i]; });
      return call('fin_pengajuan_save', { tanggal: state.pjDate, items: items, files: files });
    }).then(function (r) {
      toast('Pengajuan tersimpan: ' + r.file.title);
      state.pjItems = null; clearPicks('pj'); load(true);
    }, function (e) {
      busy(btn, false, 'Simpan pengajuan');
      if (e.pin) { clearPin(); return pinScreen(e.message); }
      $('#pj-msg').innerHTML = '<div class="alert err">' + esc(e.message) + '</div>';
    });
  }

  function renderGroups() {
    var groups = state.data.pengajuan;
    $('#pj-list').innerHTML = groups.length ? groups.map(function (g, gi) {
      return '<div class="group"><div class="group-head"><div><b>' + esc(longDate(g.tanggal)) + '</b><div style="font-size:12px;color:var(--muted)">Total ' + rp(g.total) + ' · Lunas ' + rp(g.lunas) + '</div></div>' +
        (g.url ? '<a class="tiny-btn" target="_blank" rel="noopener" href="' + esc(g.url) + '">Buka file ↗</a>' : '') + '</div>' +
        g.items.map(function (it) {
          var lunas = it.status === 'Lunas';
          return '<div class="pj-row">' + (lunas ? '<span style="width:18px"></span>' : '<input type="checkbox" data-pay="' + gi + '" value="' + esc(it.item_id) + '">') +
            '<div class="what"><b>' + esc(it.keterangan) + '</b><small>' + esc([Number(it.qty) + ' ' + (it.satuan || ''), it.kategori, it.atas_nama && ('A/N ' + it.atas_nama), it.bank && (it.bank + ' ' + it.no_rekening)].filter(Boolean).join(' · ')) + '</small>' +
            '<div class="acts">' + links(it.nota) + (lunas ? links(it.bukti_bayar) : '') + '<button class="tiny-btn" data-pjedit="' + esc(it.item_id) + '">Edit</button><button class="tiny-btn danger" data-pjdel="' + esc(it.item_id) + '">Hapus</button></div></div>' +
            '<div class="amt" style="text-align:right">' + rp((Number(it.nominal) || 0) * (Number(it.qty) || 1)) + '<div>' + (lunas ? '<span class="pill lunas">Lunas ' + esc(dayParts(it.tanggal_bayar).join(' ')) + '</span>' : '<span class="pill wait">Diajukan</span>') + '</div></div></div>';
        }).join('') +
        '<div class="pj-row" data-paybox="' + gi + '" hidden><div class="what"><div class="row2"><div><label class="f" style="margin-top:0">Tanggal bayar</label><input class="input" type="date" data-paydate value="' + today() + '"></div>' +
        '<div><label class="f" style="margin-top:0">Bukti transfer</label>' + pickerHtml('pay' + gi) + '</div></div>' +
        '<button class="btn" data-paygo="' + gi + '" style="margin-top:10px">Tandai lunas</button></div></div></div>';
    }).join('') : '<div class="empty">Belum ada pengajuan dari website.</div>';
    bindPickers($('#pj-list'));
    $$('[data-pay]').forEach(function (cb) {
      cb.onchange = function () {
        var gi = cb.dataset.pay;
        $('[data-paybox="' + gi + '"]').hidden = !$$('[data-pay="' + gi + '"]').some(function (x) { return x.checked; });
      };
    });
    $$('[data-paygo]').forEach(function (b) {
      b.onclick = function () {
        var gi = b.dataset.paygo, box = $('[data-paybox="' + gi + '"]');
        var ids = $$('[data-pay="' + gi + '"]').filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        busy(b, true, 'Menyimpan…');
        packFiles(PICK['pay' + gi]).then(function (files) {
          return call('fin_pengajuan_pay', { itemIds: ids, tanggalBayar: $('[data-paydate]', box).value, files: files });
        }).then(function () { toast(ids.length + ' item ditandai lunas.'); clearPicks('pay'); load(true); }, function (e) { busy(b, false, 'Tandai lunas'); toast(e.message, 'err'); });
      };
    });
    $$('[data-pjdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Hapus item pengajuan ini?')) return;
        b.disabled = true;
        call('fin_pengajuan_delete', { itemId: b.dataset.pjdel }).then(function () { toast('Item dihapus.'); load(true); }, function (e) { b.disabled = false; toast(e.message, 'err'); });
      };
    });
    $$('[data-pjedit]').forEach(function (b) {
      b.onclick = function () {
        var it = null;
        state.data.pengajuan.forEach(function (g) { g.items.forEach(function (x) { if (x.item_id === b.dataset.pjedit) it = x; }); });
        if (!it) return;
        clearPicks('pj'); state.pjItems = [Object.assign(blankItem(), it)]; state.pjDate = it.tanggal_pengajuan; state.pjEditing = true;
        pengajuanPage(); window.scrollTo(0, 0);
      };
    });
  }

  window.addEventListener('hashchange', route);
  load();
})();
