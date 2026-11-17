/**
 * PCC Daily Report — shared business logic (no Google APIs, no DOM).
 *
 * This one file is the single source of truth for validation and every
 * calculation. It is copied to:
 *   - apps-script/Logic.gs        (backend, Google Apps Script)
 *   - web/assets/logic.js         (website, demo mode + live preview)
 * Run `node tools/sync-logic.js` after editing it.
 */
var PCC = (function () {
  var COURTS = [1, 2, 3];
  var CATEGORIES = ['AYO', 'Manual'];
  // Kinds of "pemasukan lainnya"; they map 1:1 to columns of the monthly recap (REKAP BULAN …).
  var OTHER_CATEGORIES = ['Photoshoot', 'Event - Lapangan', 'Event - Uang Kebersihan', 'Event - Uang Keamanan', 'Event - Pemasangan Alat',
    'Biaya Tambahan Lain', 'Coaching', 'Lainnya'];
  var OTHER_WITH_HOURS = ['Photoshoot', 'Event - Lapangan'];
  var DEFAULT_OPTIONS = {
    shifts: ['Shift 1', 'Shift 2'],
    methods: ['BRI', 'BCA', 'Mandiri', 'AYO'],
    maxHoursPerCourt: 17,
    // Court bookings are recorded once per day, by this shift only. '' = any shift may record them.
    courtShift: 'Shift 2'
  };

  // Flat totals stored per report (Reports sheet columns, dashboard input).
  var TOTAL_FIELDS = [
    'ayo_c1', 'ayo_c2', 'ayo_c3', 'manual_c1', 'manual_c2', 'manual_c3',
    'revenue_ayo', 'revenue_manual', 'revenue_court', 'revenue_sales', 'revenue_lain', 'grand_total',
    'booking_c1', 'booking_c2', 'booking_c3', 'total_booking',
    'jam_c1', 'jam_c2', 'jam_c3', 'total_jam', 'sales_qty'
  ];

  function toNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).replace(/[^0-9,.\-]/g, '');
    // Indonesian input: "100.000" or "100.000,5"; plain "1.5" stays a decimal.
    if (/\.\d{3}(\D|$)/.test(s) || s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  function text(s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim(); }

  function reportKey(tanggal, shift, admin) {
    return [text(tanggal), text(shift).toLowerCase(), text(admin).toLowerCase()].join('|');
  }

  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  /** Clean a raw report from the form: trims text, converts numbers, drops empty rows. */
  function normalize(raw) {
    raw = raw || {};
    var out = {
      tanggal: text(raw.tanggal),
      shift: text(raw.shift),
      admin: text(raw.admin),
      catatan: String(raw.catatan || '').trim().slice(0, 2000),
      courts: [],
      sales: [],
      other: []
    };
    (raw.courts || []).forEach(function (r) {
      var row = {
        court: Number(r.court),
        kategori: text(r.kategori),
        harga: toNum(r.harga),
        jumlah: toNum(r.jumlah),
        durasi: toNum(r.durasi),
        metode: text(r.kategori) === 'AYO' ? 'AYO' : text(r.metode)
      };
      if (!row.jumlah && !row.harga) return; // untouched row
      out.courts.push(row);
    });
    (raw.sales || []).forEach(function (r) {
      var row = {
        produk: text(r.produk),
        harga: toNum(r.harga),
        harga_modal: r.harga_modal === '' || r.harga_modal === null || r.harga_modal === undefined ? '' : toNum(r.harga_modal),
        qty: toNum(r.qty),
        metode: text(r.metode)
      };
      if (!row.qty) return;
      out.sales.push(row);
    });
    (raw.other || []).forEach(function (r) {
      var row = { kategori: text(r.kategori) || 'Lainnya', keterangan: text(r.keterangan), nominal: toNum(r.nominal), jam: toNum(r.jam), metode: text(r.metode) };
      if (OTHER_WITH_HOURS.indexOf(row.kategori) < 0) row.jam = 0;
      if (!row.nominal && !row.keterangan) return;
      out.other.push(row);
    });
    return out;
  }

  /** Returns {errors: [], warnings: []}. Errors block submission. */
  function validate(report, options) {
    var o = merge(DEFAULT_OPTIONS, options);
    var errors = [], warnings = [];
    if (!isValidDate(report.tanggal)) errors.push('Tanggal laporan wajib diisi dengan format yang benar.');
    if (o.shifts.indexOf(report.shift) < 0) errors.push('Shift wajib dipilih (' + o.shifts.join(' / ') + ').');
    if (!report.admin) errors.push('Nama admin wajib diisi.');
    if (report.admin && report.admin.length > 60) errors.push('Nama admin terlalu panjang.');
    if (o.courtShift && report.shift && report.shift !== o.courtShift && report.courts.length) {
      errors.push('Booking court dicatat per hari oleh ' + o.courtShift + ' saja. Hapus isian booking court dari laporan ' + report.shift + ' supaya tidak terhitung dua kali.');
    }

    report.courts.forEach(function (r, i) {
      var label = 'Court ' + r.court + ' ' + r.kategori + ' baris ' + (i + 1) + ': ';
      if (COURTS.indexOf(r.court) < 0) errors.push(label + 'court tidak dikenal.');
      if (CATEGORIES.indexOf(r.kategori) < 0) errors.push(label + 'kategori harus AYO atau Manual.');
      if (!(r.harga >= 0)) errors.push(label + 'harga tidak valid.');
      if (!(r.jumlah >= 1) || Math.floor(r.jumlah) !== r.jumlah) errors.push(label + 'jumlah booking harus bilangan bulat ≥ 1.');
      if (!(r.durasi > 0 && r.durasi <= 24)) errors.push(label + 'durasi per booking harus antara 0,5 dan 24 jam.');
      if (r.kategori === 'Manual' && o.methods.indexOf(r.metode) < 0) errors.push(label + 'metode pembayaran wajib dipilih.');
      if (r.harga === 0) warnings.push(label + 'harga Rp0, pastikan memang gratis.');
    });
    report.sales.forEach(function (r, i) {
      var label = 'Penjualan "' + (r.produk || 'baris ' + (i + 1)) + '": ';
      if (!r.produk) errors.push(label + 'nama produk wajib diisi.');
      if (!(r.harga >= 0)) errors.push(label + 'harga tidak valid.');
      if (!(r.qty >= 1) || Math.floor(r.qty) !== r.qty) errors.push(label + 'jumlah terjual harus bilangan bulat ≥ 1.');
      if (o.methods.indexOf(r.metode) < 0) errors.push(label + 'metode pembayaran wajib dipilih.');
    });
    report.other.forEach(function (r, i) {
      var label = 'Pemasukan lain baris ' + (i + 1) + ': ';
      if (OTHER_CATEGORIES.indexOf(r.kategori) < 0) errors.push(label + 'kategori tidak dikenal.');
      if (!r.keterangan) errors.push(label + (r.kategori === 'Coaching' ? 'nama coach wajib diisi.' : 'keterangan wajib diisi.'));
      if (!(r.jam >= 0 && r.jam <= 24)) errors.push(label + 'jam tidak valid.');
      if (!(r.nominal > 0)) errors.push(label + 'nominal harus lebih dari 0.');
      if (o.methods.indexOf(r.metode) < 0) errors.push(label + 'metode pembayaran wajib dipilih.');
    });

    var t = compute(report);
    COURTS.forEach(function (c) {
      if (t.courts[c].hours > o.maxHoursPerCourt) warnings.push('Court ' + c + ' tercatat ' + t.courts[c].hours + ' jam, melebihi jam operasional. Periksa lagi.');
    });
    if (!report.courts.length && !report.sales.length && !report.other.length) warnings.push('Laporan masih kosong (tidak ada booking, penjualan, atau pemasukan lain).');
    return { errors: errors, warnings: warnings };
  }

  /** All totals for one normalized report. Revenue = harga × total jam; total jam = jumlah booking × durasi. */
  function compute(report) {
    var t = {
      courts: {},
      revenueAyo: 0, revenueManual: 0, revenueCourt: 0, revenueSales: 0, revenueOther: 0, grandTotal: 0,
      totalBookings: 0, totalHours: 0, salesQty: 0, salesMargin: 0, salesMarginKnown: true,
      byMethod: {}
    };
    COURTS.forEach(function (c) {
      t.courts[c] = { ayo: { revenue: 0, bookings: 0, hours: 0 }, manual: { revenue: 0, bookings: 0, hours: 0 }, revenue: 0, bookings: 0, hours: 0 };
    });
    function addMethod(m, v) { if (!m) return; t.byMethod[m] = r2((t.byMethod[m] || 0) + v); }

    report.courts.forEach(function (r) {
      var c = t.courts[r.court];
      if (!c) return;
      var hours = r2(r.jumlah * r.durasi);
      var revenue = r2(r.harga * hours);
      var bucket = r.kategori === 'AYO' ? c.ayo : c.manual;
      bucket.revenue = r2(bucket.revenue + revenue);
      bucket.bookings += r.jumlah;
      bucket.hours = r2(bucket.hours + hours);
      addMethod(r.metode, revenue);
    });
    COURTS.forEach(function (n) {
      var c = t.courts[n];
      c.revenue = r2(c.ayo.revenue + c.manual.revenue);
      c.bookings = c.ayo.bookings + c.manual.bookings;
      c.hours = r2(c.ayo.hours + c.manual.hours);
      t.revenueAyo = r2(t.revenueAyo + c.ayo.revenue);
      t.revenueManual = r2(t.revenueManual + c.manual.revenue);
      t.totalBookings += c.bookings;
      t.totalHours = r2(t.totalHours + c.hours);
    });
    t.revenueCourt = r2(t.revenueAyo + t.revenueManual);

    report.sales.forEach(function (r) {
      var total = r2(r.harga * r.qty);
      t.revenueSales = r2(t.revenueSales + total);
      t.salesQty += r.qty;
      if (r.harga_modal === '' || r.harga_modal === null || r.harga_modal === undefined) t.salesMarginKnown = false;
      else t.salesMargin = r2(t.salesMargin + (r.harga - r.harga_modal) * r.qty);
      addMethod(r.metode, total);
    });
    report.other.forEach(function (r) {
      t.revenueOther = r2(t.revenueOther + r.nominal);
      addMethod(r.metode, r.nominal);
    });
    t.grandTotal = r2(t.revenueCourt + t.revenueSales + t.revenueOther);
    return t;
  }

  function flatten(t) {
    var f = {};
    COURTS.forEach(function (c) {
      f['ayo_c' + c] = t.courts[c].ayo.revenue;
      f['manual_c' + c] = t.courts[c].manual.revenue;
      f['booking_c' + c] = t.courts[c].bookings;
      f['jam_c' + c] = t.courts[c].hours;
    });
    f.revenue_ayo = t.revenueAyo; f.revenue_manual = t.revenueManual; f.revenue_court = t.revenueCourt;
    f.revenue_sales = t.revenueSales; f.revenue_lain = t.revenueOther; f.grand_total = t.grandTotal;
    f.total_booking = t.totalBookings; f.total_jam = t.totalHours; f.sales_qty = t.salesQty;
    return f;
  }

  /** Row-level values written to the detail sheets. */
  function courtRowValues(r) { var h = r2(r.jumlah * r.durasi); return { total_jam: h, revenue: r2(r.harga * h) }; }
  function salesRowValues(r) {
    return {
      total: r2(r.harga * r.qty),
      margin: (r.harga_modal === '' || r.harga_modal === null || r.harga_modal === undefined) ? '' : r2((r.harga - r.harga_modal) * r.qty)
    };
  }

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseYmd(s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  /** mode: 'daily' | 'weekly' (Mon–Sun) | 'monthly' | 'custom'. ref = 'YYYY-MM-DD'. */
  function rangeFor(mode, ref, from, to) {
    if (mode === 'custom') return { from: from, to: to };
    var d = parseYmd(ref);
    if (mode === 'weekly') {
      var dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      var start = new Date(d.getTime() - dow * 86400000);
      return { from: ymd(start), to: ymd(new Date(start.getTime() + 6 * 86400000)) };
    }
    if (mode === 'monthly') {
      var first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return { from: ymd(first), to: ymd(last) };
    }
    return { from: ref, to: ref };
  }

  /**
   * Dashboard aggregation.
   * reports: active Reports rows (objects with tanggal, shift, admin, report_id, updated_at + TOTAL_FIELDS).
   * sales: Sales rows ({tanggal, produk, qty, total}).
   */
  function aggregate(reports, sales, from, to) {
    var inRange = function (d) { return d >= from && d <= to; };
    var rs = reports.filter(function (r) { return inRange(String(r.tanggal)); });
    var kpi = { grandTotal: 0, revenueCourt: 0, revenueSales: 0, revenueOther: 0, revenueAyo: 0, revenueManual: 0, totalBookings: 0, totalHours: 0, reportCount: rs.length, days: 0 };
    var courts = COURTS.map(function (c) { return { court: c, ayo: 0, manual: 0, revenue: 0, bookings: 0, hours: 0 }; });
    var daily = {};
    rs.forEach(function (r) {
      var n = function (k) { return Number(r[k]) || 0; };
      kpi.grandTotal += n('grand_total'); kpi.revenueCourt += n('revenue_court'); kpi.revenueSales += n('revenue_sales');
      kpi.revenueOther += n('revenue_lain'); kpi.revenueAyo += n('revenue_ayo'); kpi.revenueManual += n('revenue_manual');
      kpi.totalBookings += n('total_booking'); kpi.totalHours += n('total_jam');
      courts.forEach(function (c) {
        c.ayo += n('ayo_c' + c.court); c.manual += n('manual_c' + c.court);
        c.revenue += n('ayo_c' + c.court) + n('manual_c' + c.court);
        c.bookings += n('booking_c' + c.court); c.hours += n('jam_c' + c.court);
      });
      var d = daily[r.tanggal] || (daily[r.tanggal] = { tanggal: String(r.tanggal), grandTotal: 0, court: 0, sales: 0, other: 0, hours: 0, bookings: 0, reports: 0 });
      d.grandTotal += n('grand_total'); d.court += n('revenue_court'); d.sales += n('revenue_sales');
      d.other += n('revenue_lain'); d.hours += n('total_jam'); d.bookings += n('total_booking'); d.reports += 1;
    });
    var dailyList = Object.keys(daily).sort().map(function (k) { return daily[k]; });
    kpi.days = dailyList.length;
    Object.keys(kpi).forEach(function (k) { kpi[k] = r2(kpi[k]); });
    courts.forEach(function (c) { Object.keys(c).forEach(function (k) { c[k] = r2(c[k]); }); });

    var prod = {};
    (sales || []).forEach(function (s) {
      if (!inRange(String(s.tanggal))) return;
      var p = prod[s.produk] || (prod[s.produk] = { produk: s.produk, qty: 0, total: 0 });
      p.qty += Number(s.qty) || 0; p.total = r2(p.total + (Number(s.total) || 0));
    });
    var topProducts = Object.keys(prod).map(function (k) { return prod[k]; }).sort(function (a, b) { return b.total - a.total || b.qty - a.qty; });

    var history = rs.slice().sort(function (a, b) {
      return String(b.tanggal).localeCompare(String(a.tanggal)) || String(a.shift).localeCompare(String(b.shift));
    }).map(function (r) {
      return { report_id: r.report_id, tanggal: String(r.tanggal), shift: r.shift, admin: r.admin, grand_total: Number(r.grand_total) || 0, total_jam: Number(r.total_jam) || 0, version: Number(r.version) || 1, updated_at: r.updated_at };
    });
    return { from: from, to: to, kpi: kpi, courts: courts, daily: dailyList, topProducts: topProducts, reports: history };
  }

  function formatRupiah(n) {
    n = Number(n) || 0;
    var neg = n < 0; n = Math.abs(Math.round(n));
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-Rp' : 'Rp') + s;
  }

  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; if (b) for (k in b) if (b[k] !== undefined && b[k] !== null) o[k] = b[k]; return o; }
  /** True when this shift's report should contain the day's court bookings. */
  function recordsCourts(shift, options) {
    var cs = merge(DEFAULT_OPTIONS, options).courtShift;
    return !cs || shift === cs;
  }

  // ---------- WhatsApp shift recap (PCC's own message format) ----------
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var WA_GROUPS = ['Minuman', 'Snack', 'Lainnya'];
  function rpWa(n) { return 'Rp. ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function jamWa(h) { return String(Math.round((Number(h) || 0) * 100) / 100).replace('.', ','); }
  function dateWa(ymd) { var p = String(ymd).split('-'); return Number(p[2]) + ' ' + BULAN[Number(p[1]) - 1] + ' ' + p[0]; }

  /**
   * Builds the shift message sent to WhatsApp.
   * opts.products: [{produk, grup ('Minuman'|'Snack'|'Lainnya'), label}] in display order (Master_Produk)
   * opts.shiftHours: {'Shift 1': '06.00-14.00', ...}; opts.coaches: ['Abi Ipan', ...]
   * opts.courtShift: shift that also reports the day's courts; opts.version: report version (>1 marks a revision)
   */
  function waMessage(report, opts) {
    opts = opts || {};
    var t = compute(report);
    var qty = {}, amt = {};
    report.sales.forEach(function (s) { qty[s.produk] = (qty[s.produk] || 0) + s.qty; amt[s.produk] = r2((amt[s.produk] || 0) + s.harga * s.qty); });
    var list = (opts.products || []).slice();
    report.sales.forEach(function (s) {
      if (!list.some(function (p) { return p.produk === s.produk; })) list.push({ produk: s.produk, grup: 'Lainnya', label: s.produk });
    });
    var hours = (opts.shiftHours || {})[report.shift] || '';
    var L = [];
    L.push(report.admin, '');
    L.push(report.shift + (hours ? ' *' + hours + ' WIB*' : ''));
    if (Number(opts.version) > 1) L.push('_Revisi laporan (versi ' + opts.version + ')_');
    L.push('Rekap transaksi', 'Tanggal: ' + dateWa(report.tanggal), '', '---', '*Penjualan F&B & Lainnya (Majoo)*', '');
    WA_GROUPS.forEach(function (g) {
      var items = list.filter(function (p) { return (WA_GROUPS.indexOf(p.grup) >= 0 ? p.grup : 'Lainnya') === g; });
      if (!items.length) return;
      L.push(g + ':');
      if (g === 'Minuman') L.push('');
      items.forEach(function (p) {
        var q = qty[p.produk] || 0;
        L.push((g === 'Lainnya' ? '' : '* ') + (p.label || p.produk) + ' : ' + rpWa(amt[p.produk] || 0) + (q ? ' (' + q + ')' : ''));
      });
      L.push('');
    });
    L.push('*💰Total Penjualan Majoo ' + report.shift + (hours ? ' (' + hours + ')' : '') + '* :', '*' + rpWa(t.revenueSales) + '*', '');

    var others = report.other.filter(function (o) { return o.kategori !== 'Coaching'; });
    if (recordsCourts(report.shift, { courtShift: opts.courtShift })) {
      L.push('----', '', '*TOTAL JAM TERPAKAI SELAMA SATU HARI ' + jamWa(t.totalHours) + ' JAM*', '');
      COURTS.forEach(function (c) {
        L.push('Court ' + c + ':', 'Jam Terpakai: ' + jamWa(t.courts[c].hours) + ' jam', 'Total: ' + rpWa(t.courts[c].revenue), '');
      });
      L.push('*Pendapatan Aplikasi Ayo Satu Hari :*', '*' + rpWa(t.revenueAyo) + '*', '', '*Manual court*', '*' + rpWa(t.revenueManual) + '*', '');
      var ayoSale = function (name) { return report.sales.filter(function (s) { return s.metode === 'AYO' && s.produk === name; }).reduce(function (a, s) { return a + s.harga * s.qty; }, 0); };
      var coaching = report.other.filter(function (o) { return o.kategori === 'Coaching'; });
      var ayoCoach = coaching.filter(function (o) { return o.metode === 'AYO'; }).reduce(function (a, o) { return a + o.nominal; }, 0);
      L.push('*Add-on ayo*', 'Raket : ' + rpWa(ayoSale('Raket')), 'Bola : ' + rpWa(ayoSale('Bola')));
      report.sales.forEach(function (s) {
        if (s.metode === 'AYO' && s.produk !== 'Raket' && s.produk !== 'Bola') L.push(s.produk + ' : ' + rpWa(s.harga * s.qty));
      });
      L.push('Coaching : ' + rpWa(ayoCoach), '', '*Manual Coaching*');
      var manualCoach = coaching.filter(function (o) { return o.metode !== 'AYO'; });
      var coaches = (opts.coaches || []).slice();
      manualCoach.forEach(function (o) { if (coaches.indexOf(o.keterangan) < 0) coaches.push(o.keterangan); });
      if (!coaches.length) coaches = ['-'];
      coaches.forEach(function (n) {
        var v = manualCoach.filter(function (o) { return o.keterangan === n; }).reduce(function (a, o) { return a + o.nominal; }, 0);
        L.push('Coaching ' + n + ' : ' + rpWa(v));
      });
      L.push('', '💰*TOTAL PENDAPATAN AYO + MANUAL*', '', '*' + rpWa(t.revenueCourt) + '*', '');
    }
    if (others.length) {
      L.push('*Pemasukan Lainnya*');
      others.forEach(function (o) { L.push(o.kategori + ' - ' + o.keterangan + ' : ' + rpWa(o.nominal) + (o.jam ? ' (' + jamWa(o.jam) + ' jam)' : '')); });
      L.push('');
    }
    L.push('----', '*NOTE*');
    if (report.catatan) L.push(report.catatan);
    return L.join('\n');
  }

  /** wa.me link that opens WhatsApp with the message ready to send. Number like 0821… or 62821…. */
  function waLink(number, text) {
    var n = String(number || '').replace(/\D/g, '').replace(/^0/, '62');
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text); // no number: WhatsApp asks which chat
  }

  return {
    COURTS: COURTS, CATEGORIES: CATEGORIES, OTHER_CATEGORIES: OTHER_CATEGORIES, OTHER_WITH_HOURS: OTHER_WITH_HOURS, DEFAULT_OPTIONS: DEFAULT_OPTIONS, TOTAL_FIELDS: TOTAL_FIELDS,
    toNum: toNum, reportKey: reportKey, isValidDate: isValidDate, normalize: normalize, validate: validate,
    compute: compute, flatten: flatten, courtRowValues: courtRowValues, salesRowValues: salesRowValues,
    rangeFor: rangeFor, aggregate: aggregate, formatRupiah: formatRupiah, recordsCourts: recordsCourts,
    waMessage: waMessage, waLink: waLink
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PCC;
