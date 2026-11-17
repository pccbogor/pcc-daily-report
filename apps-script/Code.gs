/**
 * PCC Daily Report — Google Apps Script backend (Web App API).
 *
 * Install: bound to the PCC Daily Report database spreadsheet
 * (Extensions > Apps Script). Run setup() once, set Script Properties,
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 *
 * Script Properties (Project Settings > Script properties) — never commit these:
 *   ACCESS_PIN          PIN admins type on the website (required)
 *   ARCHIVE_FOLDER_ID   Drive folder for daily archive files (optional; archive is skipped if empty)
 *   ARCHIVE_MONTH_FOLDERS  "true" to file archives into "NOVEMBER 2026"-style subfolders (default: flat, like LAPORAN HARIAN today)
 *   REKAP_FOLDER_ID     Drive folder for monthly recap files ("Laporan Bulanan"); optional
 *   DAILY_TEMPLATE_ID   Google Sheet copy of PCC's own "LAPORAN PEMASUKAN" file (run prepareDailyTemplate once);
 *                       when set, every daily file is a copy of it with the day's numbers filled in
 *   REPORT_ROOT_FOLDER_ID  Drive folder "Report PCC Bogor". When set it overrides the three above:
 *                       daily files go to   <root>/LAPORAN 2026/NOVEMBER 2026/LAPORAN HARIAN
 *                       the monthly recap to <root>/LAPORAN 2026/NOVEMBER 2026/Laporan Bulanan
 *                       (year/month folders are found by name, or created the first time)
 *   WA_TARGET           WhatsApp number that receives the shift recap, e.g. 62821xxxxxxx (used by the website's WA button)
 *   WA_TOKEN            optional Fonnte (fonnte.com) device token: when set, the recap is also sent automatically
 *
 * All calculations come from Logic.gs (PCC.*), shared with the website.
 */

var API_VERSION = '1.0.0';
var SHEET = {
  REPORTS: 'Reports', COURT: 'Court_Bookings', SALES: 'Sales', OTHER: 'Other_Income',
  AUDIT: 'Audit_Log', PRODUCTS: 'Master_Produk', CONFIG: 'Config', SUMMARY: 'Daily_Summary', ARCHIVE: 'Archive_Index'
};
var HEADERS = {
  Reports: ['report_id', 'report_key', 'tanggal', 'shift', 'admin', 'catatan', 'status', 'version', 'created_at', 'updated_at', 'last_submission_id']
    .concat(PCC.TOTAL_FIELDS).concat(['archive_url']),
  Court_Bookings: ['report_id', 'tanggal', 'shift', 'admin', 'court', 'kategori', 'harga', 'jumlah_booking', 'durasi_jam', 'total_jam', 'revenue', 'metode', 'created_at'],
  Sales: ['report_id', 'tanggal', 'shift', 'admin', 'produk', 'harga', 'harga_modal', 'qty', 'total', 'margin', 'metode', 'created_at'],
  Other_Income: ['report_id', 'tanggal', 'shift', 'admin', 'kategori', 'keterangan', 'nominal', 'jam', 'metode', 'created_at'],
  Audit_Log: ['timestamp', 'action', 'report_id', 'report_key', 'admin', 'submission_id', 'version', 'grand_total', 'payload_json'],
  Master_Produk: ['produk', 'harga', 'harga_modal', 'aktif', 'grup', 'label_wa'],
  Config: ['key', 'value', 'keterangan'],
  Archive_Index: ['tanggal', 'file_id', 'url', 'updated_at']
};
var MONTHS_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

// Seed data taken from "LAPORAN PEMASUKAN 15 NOVEMBER 2026.xlsx". Edit later in the Master_Produk / Config sheets.
var SEED_PRODUCTS = [
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
var SEED_CONFIG = [
  ['SHIFTS', 'Shift 1,Shift 2', 'Pilihan shift di form (pisahkan dengan koma)'],
  ['METHODS', 'BRI,BCA,Mandiri,AYO', 'Metode pembayaran'],
  ['ADMINS', 'Lutfhi,Haidar', 'Saran nama admin (boleh diketik bebas di form)'],
  ['COURT_NAMES', 'Court 1 (Semi Indoor),Court 2 (Semi Indoor),Court 3 (Semi Indoor)', 'Nama court 1, 2, 3'],
  ['PRICE_SUGGESTIONS', '100000,120000,132000,140000,144500,175000,180000,190000,200000,220000,295000,340000,345000,395000', 'Saran harga booking per jam'],
  ['MAX_HOURS_PER_COURT', '17', 'Batas peringatan jam per court per laporan'],
  ['SHIFT_HOURS', 'Shift 1=06.00-14.00,Shift 2=14.00-22.00', 'Jam kerja tiap shift (dipakai di pesan WhatsApp)'],
  ['COACHES', 'Abi Ipan,Arif', 'Nama coach (kolom Pemasukan Coaching di Rekap Bulanan)'],
  ['FULL_HOURS_PER_DAY', '48', 'Jam court jika fully booked per hari (3 court x 16 jam)'],
  ['COURT_SHIFT', 'Shift 2', 'Shift yang mencatat booking court (per hari). Kosongkan jika semua shift boleh mencatat.']
];

// =====================================================================
// Setup
// =====================================================================
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) { ensureSheet_(ss, name, HEADERS[name]); });
  // Dates are stored as text "YYYY-MM-DD" so filters and range queries are timezone-safe.
  [SHEET.REPORTS, SHEET.COURT, SHEET.SALES, SHEET.OTHER, SHEET.ARCHIVE].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var col = HEADERS[name].indexOf('tanggal') + 1;
    sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  var prod = ss.getSheetByName(SHEET.PRODUCTS);
  if (prod.getLastRow() < 2) {
    prod.getRange(2, 1, SEED_PRODUCTS.length, 6).setValues(SEED_PRODUCTS.map(function (p) { return [p[0], p[1], p[2], true, p[3], p[4]]; }));
  }
  var cfg = ss.getSheetByName(SHEET.CONFIG);
  if (cfg.getLastRow() < 2) cfg.getRange(2, 1, SEED_CONFIG.length, 3).setValues(SEED_CONFIG);
  buildSummarySheet_(ss);
  buildRecapSheet_(ss);
  return 'Setup selesai';
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (current.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (current.slice(0, headers.length).join('|') !== headers.join('|')) {
    throw new Error('Header sheet "' + name + '" berbeda dari yang diharapkan. Periksa sebelum menjalankan setup lagi.');
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#7B1E1E').setFontColor('#FFFFFF');
  return sh;
}

/**
 * Formulas are written in the spreadsheet's own locale. Locales with a decimal comma (e.g. id_ID, PCC's)
 * separate arguments with ';' instead of ','. Commas inside "text" are left alone.
 */
function f_(formula) {
  if (typeof formula !== 'string' || formula.charAt(0) !== '=') return formula;
  if (f_.semi === undefined) {
    var loc = String(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || 'en_US');
    f_.semi = !/^(en|ja|zh|ko|th|he|iw|hi|ms|fil|ar|ga|cy|sw|mt)(_|$)/i.test(loc);
  }
  if (!f_.semi) return formula;
  var out = '', quoted = false;
  for (var i = 0; i < formula.length; i++) {
    var ch = formula.charAt(i);
    if (ch === '"') quoted = !quoted;
    out += (!quoted && ch === ',') ? ';' : ch;
  }
  return out;
}

function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function col_(sheetName, field) { return colLetter_(HEADERS[sheetName].indexOf(field) + 1); }

/** Daily_Summary is pure formulas over the transaction sheets (no typed numbers). */
function buildSummarySheet_(ss) {
  var sh = ss.getSheetByName(SHEET.SUMMARY) || ss.insertSheet(SHEET.SUMMARY);
  sh.clear();
  var R = SHEET.REPORTS, C = SHEET.COURT, S = SHEET.SALES, O = SHEET.OTHER;
  var rc = function (f) { return R + '!' + col_(R, f) + '2:' + col_(R, f); };
  var cc = function (f) { return C + '!' + col_(C, f) + ':' + col_(C, f); };
  var sumCourt = function (field, extra) {
    return '=BYROW(A2:A,LAMBDA(d,IF(d="",,SUMIFS(' + cc(field) + ',' + cc('tanggal') + ',d' + (extra || '') + '))))';
  };
  var cols = [
    ['Tanggal', '=IFERROR(SORT(UNIQUE(FILTER(' + rc('tanggal') + ',' + rc('status') + '="ACTIVE"))),"")'],
    ['Jumlah Laporan', '=BYROW(A2:A,LAMBDA(d,IF(d="",,COUNTIFS(' + rc('tanggal') + ',d,' + rc('status') + ',"ACTIVE"))))'],
    ['Revenue AYO', sumCourt('revenue', ',' + cc('kategori') + ',"AYO"')],
    ['Revenue Manual', sumCourt('revenue', ',' + cc('kategori') + ',"Manual"')],
    ['Revenue Court', '=BYROW(A2:A,LAMBDA(d,IF(d="",,SUMIFS(' + cc('revenue') + ',' + cc('tanggal') + ',d))))'],
    ['Revenue Sales', '=BYROW(A2:A,LAMBDA(d,IF(d="",,SUMIFS(' + S + '!' + col_(S, 'total') + ':' + col_(S, 'total') + ',' + S + '!' + col_(S, 'tanggal') + ':' + col_(S, 'tanggal') + ',d))))'],
    ['Pemasukan Lain', '=BYROW(A2:A,LAMBDA(d,IF(d="",,SUMIFS(' + O + '!' + col_(O, 'nominal') + ':' + col_(O, 'nominal') + ',' + O + '!' + col_(O, 'tanggal') + ':' + col_(O, 'tanggal') + ',d))))'],
    ['Grand Total', '=ARRAYFORMULA(IF(A2:A="",,E2:E+F2:F+G2:G))'],
    ['Booking Court 1', sumCourt('jumlah_booking', ',' + cc('court') + ',1')],
    ['Booking Court 2', sumCourt('jumlah_booking', ',' + cc('court') + ',2')],
    ['Booking Court 3', sumCourt('jumlah_booking', ',' + cc('court') + ',3')],
    ['Jam Court 1', sumCourt('total_jam', ',' + cc('court') + ',1')],
    ['Jam Court 2', sumCourt('total_jam', ',' + cc('court') + ',2')],
    ['Jam Court 3', sumCourt('total_jam', ',' + cc('court') + ',3')],
    ['Total Jam', '=BYROW(A2:A,LAMBDA(d,IF(d="",,SUMIFS(' + cc('total_jam') + ',' + cc('tanggal') + ',d))))']
  ];
  sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[0]; })]);
  cols.forEach(function (c, i) { sh.getRange(2, i + 1).setFormula(f_(c[1])); });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#7B1E1E').setFontColor('#FFFFFF');
  sh.getRange('C2:H').setNumberFormat('"Rp"#,##0');
}

// =====================================================================
// HTTP entry points
// =====================================================================
function doGet() {
  return json_({ ok: true, service: 'PCC Daily Report API', version: API_VERSION });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Permintaan tidak valid.' });
  }
  try {
    checkPin_(req.pin);
    switch (req.action) {
      case 'ping': return json_({ ok: true, version: API_VERSION });
      case 'config': return json_({ ok: true, data: getConfig_() });
      case 'submit': return json_(submitReport_(req.report, req.submissionId));
      case 'history': return json_({ ok: true, data: listReports_(req.from, req.to) });
      case 'report': return json_({ ok: true, data: getReport_(req.reportId) });
      case 'dashboard': return json_({ ok: true, data: dashboard_(req.from, req.to) });
      default: return json_({ ok: false, error: 'Aksi tidak dikenal.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** PIN check with a simple global lockout after repeated failures. */
function checkPin_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_PIN');
  if (!expected) throw new Error('Server belum dikonfigurasi (ACCESS_PIN kosong).');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 20) throw new Error('Terlalu banyak percobaan PIN salah. Coba lagi dalam 10 menit.');
  if (String(pin || '') !== String(expected)) {
    cache.put('pin_fails', String(fails + 1), 600);
    throw new Error('PIN salah.');
  }
}

// =====================================================================
// Config
// =====================================================================
function getConfig_() {
  var cfg = {};
  readTable_(SHEET.CONFIG).rows.forEach(function (r) { if (r.key) cfg[r.key] = String(r.value); });
  var list = function (k, def) { return cfg[k] ? cfg[k].split(',').map(function (s) { return s.trim(); }).filter(String) : def; };
  var products = readTable_(SHEET.PRODUCTS).rows
    .filter(function (r) { return r.produk && r.aktif !== false && String(r.aktif).toUpperCase() !== 'FALSE'; })
    .map(function (r) {
      return { produk: String(r.produk), harga: Number(r.harga) || 0, harga_modal: r.harga_modal === '' ? '' : Number(r.harga_modal),
        grup: String(r.grup || 'Lainnya'), label: String(r.label_wa || r.produk) };
    });
  var shiftHours = {};
  list('SHIFT_HOURS', []).forEach(function (pair) { var kv = pair.split('='); if (kv.length === 2) shiftHours[kv[0].trim()] = kv[1].trim(); });
  var props = PropertiesService.getScriptProperties();
  return {
    shifts: list('SHIFTS', PCC.DEFAULT_OPTIONS.shifts),
    methods: list('METHODS', PCC.DEFAULT_OPTIONS.methods),
    admins: list('ADMINS', []),
    courtNames: list('COURT_NAMES', ['Court 1', 'Court 2', 'Court 3']),
    priceSuggestions: list('PRICE_SUGGESTIONS', []).map(Number).filter(function (n) { return n > 0; }),
    maxHoursPerCourt: Number(cfg.MAX_HOURS_PER_COURT) || PCC.DEFAULT_OPTIONS.maxHoursPerCourt,
    coaches: list('COACHES', []),
    shiftHours: shiftHours,
    waTarget: props.getProperty('WA_TARGET') || '',
    waAuto: !!props.getProperty('WA_TOKEN'),
    otherCategories: PCC.OTHER_CATEGORIES,
    courtShift: cfg.hasOwnProperty('COURT_SHIFT') ? cfg.COURT_SHIFT.trim() : PCC.DEFAULT_OPTIONS.courtShift,
    products: products,
    today: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd')
  };
}

// =====================================================================
// Submit (create or overwrite by tanggal + shift + admin)
// =====================================================================
function submitReport_(raw, submissionId) {
  submissionId = String(submissionId || '').slice(0, 64);
  if (!submissionId) throw new Error('ID pengiriman tidak ada. Muat ulang halaman lalu coba lagi.');
  var cfg = getConfig_();
  var report = PCC.normalize(raw);
  var check = PCC.validate(report, { shifts: cfg.shifts, methods: cfg.methods, maxHoursPerCourt: cfg.maxHoursPerCourt, courtShift: cfg.courtShift });
  if (check.errors.length) return { ok: false, error: 'Laporan belum valid.', errors: check.errors };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Server sedang sibuk menyimpan laporan lain. Coba lagi sebentar.');
  try {
    // 1) Duplicate click / network retry: same submissionId already stored -> return the earlier result.
    var audit = readTable_(SHEET.AUDIT);
    for (var i = audit.rows.length - 1; i >= 0; i--) {
      if (String(audit.rows[i].submission_id) === submissionId) {
        return { ok: true, duplicate: true, reportId: audit.rows[i].report_id, version: Number(audit.rows[i].version), message: 'Laporan ini sudah tersimpan sebelumnya.' };
      }
    }

    var totals = PCC.compute(report);
    var flat = PCC.flatten(totals);
    var key = PCC.reportKey(report.tanggal, report.shift, report.admin);
    var now = new Date();
    var reports = readTable_(SHEET.REPORTS);
    var existing = null;
    reports.rows.forEach(function (r) { if (r.report_key === key && r.status === 'ACTIVE') existing = r; });

    var reportId, version, createdAt, action;
    if (existing) {
      reportId = existing.report_id; version = (Number(existing.version) || 1) + 1; createdAt = existing.created_at; action = 'UPDATE';
      deleteRowsWhere_(SHEET.COURT, 'report_id', reportId);
      deleteRowsWhere_(SHEET.SALES, 'report_id', reportId);
      deleteRowsWhere_(SHEET.OTHER, 'report_id', reportId);
    } else {
      reportId = 'PCC-' + report.tanggal.replace(/-/g, '') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
      version = 1; createdAt = now; action = 'CREATE';
    }

    var base = { report_id: reportId, tanggal: report.tanggal, shift: report.shift, admin: report.admin, created_at: now };
    appendObjects_(SHEET.COURT, report.courts.map(function (r) {
      var v = PCC.courtRowValues(r);
      return extend_(base, { court: r.court, kategori: r.kategori, harga: r.harga, jumlah_booking: r.jumlah, durasi_jam: r.durasi, total_jam: v.total_jam, revenue: v.revenue, metode: r.metode });
    }));
    appendObjects_(SHEET.SALES, report.sales.map(function (r) {
      var v = PCC.salesRowValues(r);
      return extend_(base, { produk: r.produk, harga: r.harga, harga_modal: r.harga_modal, qty: r.qty, total: v.total, margin: v.margin, metode: r.metode });
    }));
    appendObjects_(SHEET.OTHER, report.other.map(function (r) {
      return extend_(base, { kategori: r.kategori, keterangan: r.keterangan, nominal: r.nominal, jam: r.jam || '', metode: r.metode });
    }));

    var rec = extend_(flat, {
      report_id: reportId, report_key: key, tanggal: report.tanggal, shift: report.shift, admin: report.admin, catatan: report.catatan,
      status: 'ACTIVE', version: version, created_at: createdAt, updated_at: now, last_submission_id: submissionId,
      archive_url: existing ? existing.archive_url : ''
    });
    if (existing) writeObjectAt_(SHEET.REPORTS, existing._row, rec);
    else appendObjects_(SHEET.REPORTS, [rec]);

    appendObjects_(SHEET.AUDIT, [{
      timestamp: now, action: action, report_id: reportId, report_key: key, admin: report.admin, submission_id: submissionId,
      version: version, grand_total: totals.grandTotal, payload_json: JSON.stringify(report).slice(0, 49000)
    }]);
    SpreadsheetApp.flush();

    var archive = { status: 'skipped' };
    try { archive = rebuildArchive_(report.tanggal); } catch (err) { archive = { status: 'error', error: String(err.message || err) }; }
    // Keep this month's REKAP BULAN file current after every report.
    var recap = { status: 'skipped' };
    if (recapEnabled_()) {
      try { recap = exportRecap_(report.tanggal.slice(0, 7)); } catch (err) { recap = { status: 'error', error: String(err.message || err) }; }
    }
    var waText = PCC.waMessage(report, { products: cfg.products, shiftHours: cfg.shiftHours, coaches: cfg.coaches, courtShift: cfg.courtShift, version: version });
    var wa = sendWhatsApp_(waText);

    return {
      ok: true, duplicate: false, action: action, reportId: reportId, version: version, totals: totals,
      warnings: check.warnings, archive: archive, recap: recap, wa: wa, waText: waText,
      message: action === 'CREATE' ? 'Laporan tersimpan.' : 'Laporan diperbarui (versi ' + version + ').'
    };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Read APIs
// =====================================================================
function activeReports_() {
  return readTable_(SHEET.REPORTS).rows.filter(function (r) { return r.status === 'ACTIVE'; }).map(cleanRecord_);
}

function listReports_(from, to) {
  if (!PCC.isValidDate(String(from)) || !PCC.isValidDate(String(to))) throw new Error('Rentang tanggal tidak valid.');
  return PCC.aggregate(activeReports_(), [], from, to).reports;
}

function getReport_(reportId) {
  var rep = null;
  readTable_(SHEET.REPORTS).rows.forEach(function (r) { if (r.report_id === reportId) rep = cleanRecord_(r); });
  if (!rep) throw new Error('Laporan tidak ditemukan.');
  var pick = function (name) { return readTable_(name).rows.filter(function (r) { return r.report_id === reportId; }).map(cleanRecord_); };
  rep.courts = pick(SHEET.COURT).map(function (r) { return { court: Number(r.court), kategori: r.kategori, harga: r.harga, jumlah: r.jumlah_booking, durasi: r.durasi_jam, metode: r.metode, total_jam: r.total_jam, revenue: r.revenue }; });
  rep.sales = pick(SHEET.SALES).map(function (r) { return { produk: r.produk, harga: r.harga, harga_modal: r.harga_modal, qty: r.qty, metode: r.metode, total: r.total }; });
  rep.other = pick(SHEET.OTHER).map(function (r) { return { kategori: r.kategori, keterangan: r.keterangan, nominal: r.nominal, jam: r.jam, metode: r.metode }; });
  return rep;
}

function dashboard_(from, to) {
  if (!PCC.isValidDate(String(from)) || !PCC.isValidDate(String(to))) throw new Error('Rentang tanggal tidak valid.');
  var sales = readTable_(SHEET.SALES).rows.map(cleanRecord_);
  return PCC.aggregate(activeReports_(), sales, from, to);
}

// =====================================================================
// Drive archive: one Google Sheet per date, rebuilt from the database on every submit
// =====================================================================
function rebuildArchive_(tanggal) {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ARCHIVE_FOLDER_ID') && !props.getProperty('REPORT_ROOT_FOLDER_ID')) return { status: 'skipped', reason: 'ARCHIVE_FOLDER_ID belum diisi' };
  var folder = archiveFolderFor_(tanggal);
  var p = tanggal.split('-');
  var monthName = MONTHS_ID[Number(p[1]) - 1];
  var title = 'LAPORAN PEMASUKAN ' + p[2] + ' ' + monthName + ' ' + p[0] + ' (WEB)';

  var index = readTable_(SHEET.ARCHIVE);
  var entry = null;
  index.rows.forEach(function (r) { if (String(r.tanggal) === tanggal) entry = r; });
  var reps = activeReports_().filter(function (r) { return r.tanggal === tanggal; });
  var ids = reps.map(function (r) { return r.report_id; });
  var rowsOf = function (name) { return readTable_(name).rows.filter(function (r) { return ids.indexOf(r.report_id) >= 0; }).map(cleanRecord_); };
  var courts = rowsOf(SHEET.COURT), sales = rowsOf(SHEET.SALES), other = rowsOf(SHEET.OTHER);

  if (props.getProperty('DAILY_TEMPLATE_ID')) {
    var made = rebuildDailyFromTemplate_(tanggal, title, folder, entry, reps, courts, sales, other);
    return finishArchive_(tanggal, entry, made.id, made.url, title, made.notes);
  }

  var ss = null;
  if (entry && entry.file_id) { try { ss = SpreadsheetApp.openById(entry.file_id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(title);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  } else {
    moveIfElsewhere_(ss.getId(), folder);
  }
  var agg = PCC.aggregate(reps, sales, tanggal, tanggal);
  var k = agg.kpi;

  var summary = [
    ['LAPORAN PEMASUKAN PCC BOGOR', ''], ['Tanggal', tanggal], ['Diperbarui', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm')], ['', ''],
    ['Total Revenue AYO', k.revenueAyo], ['Total Revenue Manual', k.revenueManual], ['Total Revenue Court', k.revenueCourt],
    ['Total Penjualan & Sewa Add-on', k.revenueSales], ['Pemasukan Lainnya', k.revenueOther], ['GRAND TOTAL', k.grandTotal], ['', ''],
    ['Total Booking', k.totalBookings], ['Total Jam Court', k.totalHours]
  ];
  agg.courts.forEach(function (c) { summary.push(['Court ' + c.court + ': booking / jam / revenue', c.bookings + ' booking / ' + c.hours + ' jam / ' + PCC.formatRupiah(c.revenue)]); });
  summary.push(['', '']);
  summary.push(['Laporan per shift', '']);
  reps.forEach(function (r) { summary.push([r.shift + ' · ' + r.admin + ' (v' + r.version + ', ' + r.report_id + ')', Number(r.grand_total) || 0]); });

  writeArchiveTab_(ss, 'Summary', ['Keterangan', 'Nilai'], summary.slice(1), summary[0][0]);
  writeArchiveTab_(ss, 'Booking Lapang', ['Shift', 'Admin', 'Court', 'Kategori', 'Harga/Jam', 'Jumlah Booking', 'Durasi (jam)', 'Total Jam', 'Revenue', 'Metode'],
    courts.map(function (r) { return [r.shift, r.admin, 'Court ' + r.court, r.kategori, r.harga, r.jumlah_booking, r.durasi_jam, r.total_jam, r.revenue, r.metode]; }));
  writeArchiveTab_(ss, 'Penjualan & Penyewaan', ['Shift', 'Admin', 'Produk', 'Harga', 'Harga Modal', 'Qty', 'Total', 'Metode'],
    sales.map(function (r) { return [r.shift, r.admin, r.produk, r.harga, r.harga_modal, r.qty, r.total, r.metode]; }));
  writeArchiveTab_(ss, 'Pemasukan Lain', ['Shift', 'Admin', 'Kategori', 'Keterangan', 'Nominal', 'Jam', 'Metode'],
    other.map(function (r) { return [r.shift, r.admin, r.kategori, r.keterangan, r.nominal, r.jam, r.metode]; }));
  var first = ss.getSheets()[0];
  if (first.getName() !== 'Summary' && ss.getSheets().length > 4) ss.deleteSheet(first); // drop the default "Sheet1"

  return finishArchive_(tanggal, entry, ss.getId(), ss.getUrl(), title, []);
}

/** Records the day's file in Archive_Index and points every report of that day at it. */
function finishArchive_(tanggal, entry, fileId, url, title, notes) {
  if (entry) writeObjectAt_(SHEET.ARCHIVE, entry._row, { tanggal: tanggal, file_id: fileId, url: url, updated_at: new Date() });
  else appendObjects_(SHEET.ARCHIVE, [{ tanggal: tanggal, file_id: fileId, url: url, updated_at: new Date() }]);
  var rt = readTable_(SHEET.REPORTS);
  var col = HEADERS.Reports.indexOf('archive_url') + 1;
  rt.rows.forEach(function (r) { if (String(r.tanggal) === tanggal) rt.sheet.getRange(r._row, col).setValue(url); });
  return { status: 'ok', url: url, title: title, notes: notes };
}

function writeArchiveTab_(ss, name, headers, rows, title) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var start = 1;
  if (title) { sh.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(14); start = 3; }
  sh.getRange(start, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7B1E1E').setFontColor('#FFFFFF');
  if (rows.length) sh.getRange(start + 1, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(start);
}

// =====================================================================
// Sheet helpers
// =====================================================================
function readTable_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ada. Jalankan setup() dulu.');
  var values = sh.getDataRange().getValues();
  var headers = values.length ? values[0] : HEADERS[name];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    var o = { _row: i + 1 };
    headers.forEach(function (h, j) { o[h] = values[i][j]; });
    rows.push(o);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

function appendObjects_(name, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var h = HEADERS[name];
  var values = objs.map(function (o) { return h.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }); });
  var start = sh.getLastRow() + 1;
  // Keep spare rows: Sheets refuses writes past the grid, and refuses deleting every non-frozen row.
  var need = start + values.length + 50 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 500);
  sh.getRange(start, 1, values.length, h.length).setValues(values);
}

function writeObjectAt_(name, row, obj) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var h = HEADERS[name];
  sh.getRange(row, 1, 1, h.length).setValues([h.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : obj[k]; })]);
}

/** Deletes matching rows bottom-up, in contiguous blocks. */
function deleteRowsWhere_(name, field, value) {
  var t = readTable_(name);
  var rows = t.rows.filter(function (r) { return String(r[field]) === String(value); }).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start = rows[i]; }
    t.sheet.deleteRows(start, end - start + 1);
    i++;
  }
}

function cleanRecord_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) {
    if (k === '_row') return;
    var v = r[k];
    o[k] = Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss") : v;
  });
  if (o.tanggal !== undefined) o.tanggal = String(o.tanggal);
  return o;
}

function extend_(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

// =====================================================================
// Rekap Bulanan — same layout as "REKAP BULAN OKTOBER.xlsx", all formulas.
// Change the month in cell B2 (YYYY-MM). Menu PCC > "Simpan rekap ke Drive" saves a copy to "Laporan Bulanan".
// =====================================================================
var RECAP = { SHEET: 'Rekap Bulanan', HEAD: 4, FIRST: 6, DAYS: 31 };
var EVENT_PARTS = ['Event - Lapangan', 'Event - Uang Kebersihan', 'Event - Uang Keamanan', 'Event - Pemasangan Alat'];

function recapColumns_() {
  var cfg = getConfig_();
  var c = [
    { g: 'Kunci', k: 'key' }, { g: 'Tanggal', k: 'date' }, { g: 'Jumlah Jam Jika Fully Booked', k: 'full' },
    { g: 'Jumlah Jam Di Lapangan', l: 'Reguler', k: 'hoursCourt' }, { l: 'Photoshoot', k: 'hoursOther', v: 'Photoshoot' }, { l: 'Event', k: 'hoursOther', v: 'Event - Lapangan' },
    { g: 'Total Pemasukan Online', l: 'AYO', k: 'court', v: 'AYO', money: true },
    { g: 'Total Pemasukan Offline (Admin)', l: 'Manual', k: 'court', v: 'Manual', money: true },
    { g: 'Total Pemasukan Photoshoot', k: 'other', v: 'Photoshoot', money: true }
  ];
  EVENT_PARTS.forEach(function (e, i) { c.push({ g: i ? '' : 'Total Pemasukan Event', l: e.replace('Event - ', ''), k: 'other', v: e, money: true }); });
  c.push({ g: 'Biaya Tambahan Lain', k: 'other', v: 'Biaya Tambahan Lain', money: true });
  cfg.coaches.forEach(function (n, i) { c.push({ g: i ? '' : 'Pemasukan Coaching', l: n, k: 'coach', v: n, money: true }); });
  c.push({ g: cfg.coaches.length ? '' : 'Pemasukan Coaching', l: 'Coach lain', k: 'coachOther', money: true });
  c.push({ g: 'Pemasukan Lainnya', k: 'other', v: 'Lainnya', money: true });
  cfg.products.forEach(function (p, i) { c.push({ g: i ? '' : 'Penjualan Adds On (jumlah terjual)', l: p.produk, k: 'qty', v: p.produk }); });
  return c;
}

function q_(s) { return String(s).replace(/"/g, '""'); }

function buildRecapSheet_(ss, month) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(RECAP.SHEET) || ss.insertSheet(RECAP.SHEET);
  var keep = month || String(sh.getRange(2, 2).getValue() || '') || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM');
  sh.clear();
  var cols = recapColumns_();
  var n = cols.length;
  var L = function (i) { return colLetter_(i + 1); };
  var R = SHEET.REPORTS, C = SHEET.COURT, S = SHEET.SALES, O = SHEET.OTHER;
  var rc = function (sheet, f) { return sheet + '!$' + col_(sheet, f) + ':$' + col_(sheet, f); };
  var first = RECAP.FIRST, last = RECAP.FIRST + RECAP.DAYS - 1, tot = last + 1;

  sh.getRange(1, 1).setValue('REKAP BULANAN PCC BOGOR');
  sh.getRange(2, 1).setValue('Bulan (YYYY-MM)');
  sh.getRange(2, 2).setNumberFormat('@').setValue(keep);
  sh.getRange(2, 3).setValue('Jam penuh/hari');
  sh.getRange(2, 4).setFormula(f_('=IFERROR(VLOOKUP("FULL_HOURS_PER_DAY",Config!$A:$B,2,FALSE)*1,48)'));

  sh.getRange(RECAP.HEAD, 1, 2, n).setValues([cols.map(function (c) { return c.g || ''; }), cols.map(function (c) { return c.l || ''; })]);

  var rows = [];
  for (var r = first; r <= last; r++) {
    var key = '$A' + r;
    var has = 'COUNTIFS(' + rc(R, 'tanggal') + ',' + key + ',' + rc(R, 'status') + ',"ACTIVE")';
    var wrap = function (x) { return '=IF(OR(' + key + '="",' + has + '=0),"",' + x + ')'; };
    var named = cols.map(function (x, j) { return x.k === 'coach' ? L(j) + r : ''; }).filter(String);
    rows.push(cols.map(function (c) {
      switch (c.k) {
        case 'key': return '=IF(ROW()-' + (first - 1) + '>DAY(EOMONTH(DATE(LEFT($B$2,4),RIGHT($B$2,2),1),0)),"",$B$2&"-"&TEXT(ROW()-' + (first - 1) + ',"00"))';
        case 'date': return '=IF(' + key + '="","",RIGHT(' + key + ',2)&"."&MID(' + key + ',6,2)&"."&LEFT(' + key + ',4))';
        case 'full': return '=IF(' + key + '="","",$D$2)';
        case 'hoursCourt': return wrap('SUMIFS(' + rc(C, 'total_jam') + ',' + rc(C, 'tanggal') + ',' + key + ')');
        case 'hoursOther': return wrap('SUMIFS(' + rc(O, 'jam') + ',' + rc(O, 'tanggal') + ',' + key + ',' + rc(O, 'kategori') + ',"' + q_(c.v) + '")');
        case 'court': return wrap('SUMIFS(' + rc(C, 'revenue') + ',' + rc(C, 'tanggal') + ',' + key + ',' + rc(C, 'kategori') + ',"' + q_(c.v) + '")');
        case 'other': return wrap('SUMIFS(' + rc(O, 'nominal') + ',' + rc(O, 'tanggal') + ',' + key + ',' + rc(O, 'kategori') + ',"' + q_(c.v) + '")');
        case 'coach': return wrap('SUMIFS(' + rc(O, 'nominal') + ',' + rc(O, 'tanggal') + ',' + key + ',' + rc(O, 'kategori') + ',"Coaching",' + rc(O, 'keterangan') + ',"' + q_(c.v) + '")');
        case 'coachOther': return wrap('SUMIFS(' + rc(O, 'nominal') + ',' + rc(O, 'tanggal') + ',' + key + ',' + rc(O, 'kategori') + ',"Coaching")' + (named.length ? '-SUM(' + named.join(',') + ')' : ''));
        case 'qty': return wrap('SUMIFS(' + rc(S, 'qty') + ',' + rc(S, 'tanggal') + ',' + key + ',' + rc(S, 'produk') + ',"' + q_(c.v) + '")');
      }
      return '';
    }));
  }
  sh.getRange(first, 1, rows.length, n).setFormulas(rows.map(function (r) { return r.map(f_); }));

  var fullCol = L(2);
  var totalRow = cols.map(function (c, i) {
    if (c.k === 'date') return 'Total';
    if (c.k === 'key') return '';
    return '=SUM(' + L(i) + first + ':' + L(i) + last + ')';
  });
  var valueRow = cols.map(function (c, i) {
    if (c.k === 'date') return 'Utilisasi / Nilai (Rp)';
    if (c.k === 'hoursCourt' || c.k === 'hoursOther') return '=IF(' + fullCol + tot + '=0,0,' + L(i) + tot + '/' + fullCol + tot + ')';
    if (c.k === 'qty') return '=SUMIFS(' + rc(S, 'total') + ',' + rc(S, 'produk') + ',"' + q_(c.v) + '",' + rc(S, 'tanggal') + ',$B$2&"*")';
    return '';
  });
  var moneyTot = cols.map(function (c, i) { return c.money ? L(i) + tot : ''; }).filter(String);
  var qtyVals = cols.map(function (c, i) { return c.k === 'qty' ? L(i) + (tot + 1) : ''; }).filter(String);
  var grandRow = cols.map(function (c) { return c.k === 'date' ? 'TOTAL KESELURUHAN' : (c.k === 'full' ? '=SUM(' + moneyTot.concat(qtyVals).join(',') + ')' : ''); });
  var medianRow = cols.map(function (c, i) {
    if (c.k === 'date') return 'MEDIAN';
    if (c.k === 'full' || c.k === 'hoursCourt') return '=IFERROR(MEDIAN(' + L(i) + first + ':' + L(i) + last + '),"")';
    return '';
  });
  sh.getRange(tot, 1, 4, n).setFormulas([totalRow, valueRow, grandRow, medianRow].map(function (r) { return r.map(f_); }));
  // Row labels are plain text: setFormulas would read them as formulas (#NAME?).
  sh.getRange(tot, 2, 4, 1).setValues([['Total'], ['Utilisasi / Nilai (Rp)'], ['TOTAL KESELURUHAN'], ['MEDIAN']]);

  var maroon = '#7B1E1E';
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14).setFontColor(maroon);
  sh.getRange(2, 1).setFontWeight('bold');
  sh.getRange(2, 2).setBackground('#FFF4D6').setFontWeight('bold');
  sh.getRange(RECAP.HEAD, 1, 2, n).setFontWeight('bold').setBackground(maroon).setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle');
  sh.getRange(tot, 1, 4, n).setFontWeight('bold').setBackground('#F6F1EF');
  cols.forEach(function (c, i) {
    if (c.money) sh.getRange(first, i + 1, RECAP.DAYS + 1, 1).setNumberFormat('"Rp"#,##0');
    if (c.k === 'qty') sh.getRange(tot + 1, i + 1).setNumberFormat('"Rp"#,##0');
    if (c.k === 'hoursCourt' || c.k === 'hoursOther') sh.getRange(tot + 1, i + 1).setNumberFormat('0.00%');
  });
  sh.getRange(tot + 2, 3).setNumberFormat('"Rp"#,##0');
  sh.setFrozenRows(RECAP.HEAD + 1);
  sh.setFrozenColumns(2);
  sh.setColumnWidth(1, 70);
  sh.getRange(first, 1, RECAP.DAYS, 1).setFontColor('#9E9E9E');
  return sh;
}

/** Saves a static copy of the recap for `month` (YYYY-MM) as "REKAP BULAN NOVEMBER 2026 (WEB)" in REKAP_FOLDER_ID. */
function exportRecap_(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Bulan harus berformat YYYY-MM.');
  if (!recapEnabled_()) throw new Error('REKAP_FOLDER_ID belum diisi di Script properties.');
  var recapFolder = recapFolderFor_(month);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(RECAP.SHEET) || buildRecapSheet_(ss);
  var before = String(sh.getRange(2, 2).getValue());
  sh.getRange(2, 2).setValue(month);
  SpreadsheetApp.flush();
  var lastRow = RECAP.FIRST + RECAP.DAYS + 3;
  var values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getDisplayValues()
    .map(function (row) { return row.slice(1); }) // drop the helper "Kunci" column
    .filter(function (row, i) { return i < RECAP.FIRST - 1 || i >= RECAP.FIRST - 1 + RECAP.DAYS || row[0] !== ''; });
  sh.getRange(2, 2).setValue(before || month);

  var p = month.split('-');
  var title = 'REKAP BULAN ' + MONTHS_ID[Number(p[1]) - 1] + ' ' + p[0] + ' (WEB)';
  var key = 'REKAP-' + month;
  var index = readTable_(SHEET.ARCHIVE), entry = null;
  index.rows.forEach(function (r) { if (String(r.tanggal) === key) entry = r; });
  var out = null;
  if (entry && entry.file_id) { try { out = SpreadsheetApp.openById(entry.file_id); } catch (e) { out = null; } }
  if (!out) { out = SpreadsheetApp.create(title); DriveApp.getFileById(out.getId()).moveTo(recapFolder); }
  else moveIfElsewhere_(out.getId(), recapFolder);
  var tab = out.getSheets()[0];
  tab.setName('Rekap');
  tab.clear();
  values[0][0] = title.replace(' (WEB)', '') + ' - diperbarui ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
  tab.getRange(1, 1, values.length, values[0].length).setValues(values);
  tab.getRange(RECAP.HEAD, 1, 2, values[0].length).setFontWeight('bold').setBackground('#7B1E1E').setFontColor('#FFFFFF').setWrap(true);
  tab.setFrozenRows(RECAP.HEAD + 1);
  var rec = { tanggal: key, file_id: out.getId(), url: out.getUrl(), updated_at: new Date() };
  if (entry) writeObjectAt_(SHEET.ARCHIVE, entry._row, rec); else appendObjects_(SHEET.ARCHIVE, [rec]);
  return { status: 'ok', url: out.getUrl(), title: title, rows: values.length };
}

/** Time trigger target: on the 1st of each month, save last month's recap. */
function autoExportPreviousMonth() {
  var ym = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM').split('-').map(Number);
  var y = ym[1] === 1 ? ym[0] - 1 : ym[0], m = ym[1] === 1 ? 12 : ym[1] - 1;
  exportRecap_(y + '-' + (m < 10 ? '0' : '') + m);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PCC')
    .addItem('Simpan Rekap Bulanan (bulan di B2) ke Drive', 'menuExportRecap')
    .addItem('Perbarui kolom Rekap Bulanan (setelah ubah produk/coach)', 'menuRebuildRecap')
    .addItem('Aktifkan simpan rekap otomatis tiap tanggal 1', 'menuInstallTrigger')
    .addSeparator()
    .addItem('Hapus laporan…', 'menuDeleteReport')
    .addToUi();
}
function menuExportRecap() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RECAP.SHEET);
  var res = exportRecap_(String(sh.getRange(2, 2).getValue()));
  SpreadsheetApp.getUi().alert('Tersimpan: ' + res.title + '\n' + res.url);
}
function menuRebuildRecap() { buildRecapSheet_(); SpreadsheetApp.getUi().alert('Kolom Rekap Bulanan diperbarui.'); }
function menuInstallTrigger() {
  installMonthlyTrigger();
  SpreadsheetApp.getUi().alert('Aktif: setiap tanggal 1 jam 06.00, rekap bulan sebelumnya disimpan ke folder Laporan Bulanan.');
}

// =====================================================================
// WhatsApp (optional automatic sending through the Fonnte gateway)
// =====================================================================
function sendWhatsApp_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('WA_TOKEN'), target = props.getProperty('WA_TARGET');
  if (!token || !target) return { status: 'manual', reason: 'Pengiriman otomatis belum diaktifkan; pakai tombol WhatsApp di website.' };
  try {
    var res = UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method: 'post', headers: { Authorization: token }, muteHttpExceptions: true,
      payload: { target: String(target).replace(/\D/g, ''), message: text, countryCode: '62' }
    });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) { body = {}; }
    if (res.getResponseCode() === 200 && body.status === true) return { status: 'sent' };
    return { status: 'error', error: String(body.reason || body.detail || ('HTTP ' + res.getResponseCode())) };
  } catch (err) {
    return { status: 'error', error: String(err.message || err) };
  }
}

// =====================================================================
// Delete a report (owner action, from the spreadsheet menu PCC > Hapus laporan…)
// The Reports row stays with status DELETED and the deletion is logged in Audit_Log.
// =====================================================================
function deleteReport_(reportId, reason) {
  reportId = String(reportId || '').trim();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Server sedang sibuk. Coba lagi sebentar.');
  try {
    var t = readTable_(SHEET.REPORTS), rep = null;
    t.rows.forEach(function (r) { if (r.report_id === reportId && r.status === 'ACTIVE') rep = r; });
    if (!rep) throw new Error('Laporan aktif dengan ID "' + reportId + '" tidak ditemukan.');
    deleteRowsWhere_(SHEET.COURT, 'report_id', reportId);
    deleteRowsWhere_(SHEET.SALES, 'report_id', reportId);
    deleteRowsWhere_(SHEET.OTHER, 'report_id', reportId);
    var now = new Date();
    writeObjectAt_(SHEET.REPORTS, rep._row, extend_(rep, { status: 'DELETED', updated_at: now }));
    appendObjects_(SHEET.AUDIT, [{
      timestamp: now, action: 'DELETE', report_id: reportId, report_key: rep.report_key, admin: rep.admin,
      submission_id: '', version: rep.version, grand_total: 0, payload_json: String(reason || '').slice(0, 500)
    }]);
    SpreadsheetApp.flush();
    var tanggal = String(rep.tanggal);
    var stillActive = activeReports_().some(function (r) { return r.tanggal === tanggal; });
    var archive = { status: 'skipped' };
    try { archive = stillActive ? rebuildArchive_(tanggal) : removeArchive_(tanggal); } catch (e) { archive = { status: 'error', error: String(e.message || e) }; }
    return { ok: true, reportId: reportId, tanggal: tanggal, archive: archive };
  } finally {
    lock.releaseLock();
  }
}

/** No active report left for that date: move its archive file to the Drive trash and drop the index row. */
function removeArchive_(tanggal) {
  var index = readTable_(SHEET.ARCHIVE), entry = null;
  index.rows.forEach(function (r) { if (String(r.tanggal) === tanggal) entry = r; });
  if (!entry) return { status: 'skipped' };
  try { DriveApp.getFileById(entry.file_id).setTrashed(true); } catch (e) { /* already gone */ }
  index.sheet.deleteRows(entry._row, 1);
  return { status: 'removed' };
}

function menuDeleteReport() {
  var ui = SpreadsheetApp.getUi();
  var ask = ui.prompt('Hapus laporan', 'Masukkan ID laporan (contoh: PCC-20261117-0DA536):', ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  var id = ask.getResponseText().trim();
  if (ui.alert('Hapus laporan ' + id + '?', 'Baris booking, penjualan, dan pemasukan lainnya untuk laporan ini dihapus. Riwayatnya tetap tercatat di Audit_Log.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var res = deleteReport_(id, 'Dihapus lewat menu PCC di spreadsheet');
  ui.alert('Laporan ' + res.reportId + ' (' + res.tanggal + ') dihapus. Arsip: ' + res.archive.status);
}

// =====================================================================
// Monthly folders and one-off maintenance (run from the Apps Script editor)
// =====================================================================
/** Subfolder `name` of `folder`, created the first time it is needed. */
function childFolder_(folder, name) {
  var it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : folder.createFolder(name);
}

/** <REPORT_ROOT_FOLDER_ID>/LAPORAN YYYY/<BULAN YYYY> for a YYYY-MM or YYYY-MM-DD date, or null when the root is not set. */
function monthFolder_(date) {
  var rootId = PropertiesService.getScriptProperties().getProperty('REPORT_ROOT_FOLDER_ID');
  if (!rootId) return null;
  var p = String(date).split('-');
  var year = childFolder_(DriveApp.getFolderById(rootId), 'LAPORAN ' + p[0]);
  return childFolder_(year, MONTHS_ID[Number(p[1]) - 1] + ' ' + p[0]);
}

function recapEnabled_() {
  var props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('REPORT_ROOT_FOLDER_ID') || props.getProperty('REKAP_FOLDER_ID'));
}

/** Folder for the REKAP BULAN file of `month` (YYYY-MM). */
function recapFolderFor_(month) {
  var m = monthFolder_(month);
  if (m) return childFolder_(m, 'Laporan Bulanan');
  return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('REKAP_FOLDER_ID'));
}

/** Folder for a date's archive: <root>/LAPORAN YYYY/<BULAN YYYY>/LAPORAN HARIAN when REPORT_ROOT_FOLDER_ID is set;
 *  otherwise ARCHIVE_FOLDER_ID, or its "NOVEMBER 2026" subfolder when ARCHIVE_MONTH_FOLDERS is true. */
function archiveFolderFor_(tanggal) {
  var m = monthFolder_(tanggal);
  if (m) return childFolder_(m, 'LAPORAN HARIAN');
  var props = PropertiesService.getScriptProperties();
  var folder = DriveApp.getFolderById(props.getProperty('ARCHIVE_FOLDER_ID'));
  if (String(props.getProperty('ARCHIVE_MONTH_FOLDERS')).toLowerCase() !== 'true') return folder;
  var p = String(tanggal).split('-');
  var name = MONTHS_ID[Number(p[1]) - 1] + ' ' + p[0];
  var it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : folder.createFolder(name);
}

function moveIfElsewhere_(fileId, folder) {
  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) return false; }
  file.moveTo(folder);
  return true;
}

/** Moves every daily archive file listed in Archive_Index into its month folder. Returns how many were moved. */
function moveArchivesToMonthFolders() {
  var moved = 0;
  readTable_(SHEET.ARCHIVE).rows.forEach(function (r) {
    var t = String(r.tanggal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !r.file_id) return;
    try { if (moveIfElsewhere_(r.file_id, archiveFolderFor_(t))) moved++; } catch (e) { /* file deleted by hand */ }
  });
  Logger.log('Arsip dipindahkan: ' + moved);
  return moved;
}

/** One-off: moves every daily archive and REKAP BULAN file listed in Archive_Index to where the current settings
 *  put it, and the database spreadsheet itself into <root>/LAPORAN <this year>. Safe to run more than once. */
function moveAllToReportFolder() {
  var moved = 0;
  readTable_(SHEET.ARCHIVE).rows.forEach(function (r) {
    var t = String(r.tanggal);
    if (!r.file_id) return;
    var target = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) target = archiveFolderFor_(t);
    else if (/^REKAP-\d{4}-\d{2}$/.test(t) && recapEnabled_()) target = recapFolderFor_(t.slice(6));
    if (!target) return;
    try { if (moveIfElsewhere_(r.file_id, target)) moved++; } catch (e) { /* file deleted by hand */ }
  });
  var rootId = PropertiesService.getScriptProperties().getProperty('REPORT_ROOT_FOLDER_ID');
  if (rootId) {
    var year = childFolder_(DriveApp.getFolderById(rootId), 'LAPORAN ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy'));
    if (moveIfElsewhere_(SpreadsheetApp.getActiveSpreadsheet().getId(), year)) moved++;
  }
  Logger.log('File dipindahkan: ' + moved);
  return moved;
}

/** Saves last month's recap on the 1st of every month at 06.00 (Asia/Jakarta). Safe to run more than once. */
function installMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'autoExportPreviousMonth') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoExportPreviousMonth').timeBased().onMonthDay(1).atHour(6).inTimezone('Asia/Jakarta').create();
  Logger.log('Pemicu rekap bulanan aktif');
  return 'ok';
}

/** Creates/refreshes this month's REKAP BULAN file now. */
function exportCurrentRecap() {
  var res = exportRecap_(Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'));
  Logger.log(res.title + ' ' + res.url);
  return res;
}

// =====================================================================
// Daily file in PCC's own "LAPORAN PEMASUKAN" format (DAILY_TEMPLATE_ID)
// The template is PCC's .xlsx saved as a Google Sheet. Every rebuild copies it and
// fills only the input cells, so its tabs, layout and formulas stay exactly as PCC made them.
// =====================================================================
var DAILY = { SUMMARY: 'Summary', BL: 'Booking Lapang', PJ: 'Penjualan & Penyewaan', CO: 'Coaching Abi Ipan', IK: 'Bookingan Internal-Komunitas' };
var DAILY_EXTRA = ['Event - Uang Kebersihan', 'Event - Uang Keamanan', 'Event - Pemasangan Alat', 'Biaya Tambahan Lain', 'Lainnya'];

/** Builds the daily file from the template; the previous file of that date goes to the trash. */
function rebuildDailyFromTemplate_(tanggal, title, folder, entry, reps, courts, sales, other) {
  var file = DriveApp.getFileById(PropertiesService.getScriptProperties().getProperty('DAILY_TEMPLATE_ID')).makeCopy(title, folder);
  var notes;
  try {
    notes = fillDailyReport_(SpreadsheetApp.openById(file.getId()), reps, courts, sales, other);
  } catch (err) {
    file.setTrashed(true);
    throw err;
  }
  if (entry && entry.file_id && entry.file_id !== file.getId()) {
    try { DriveApp.getFileById(entry.file_id).setTrashed(true); } catch (e) { /* already gone */ }
  }
  return { id: file.getId(), url: 'https://docs.google.com/spreadsheets/d/' + file.getId() + '/edit', notes: notes };
}

function dailyText_(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }
function dailyCourt_(label) { var m = /court\s*(\d)/i.exec(dailyText_(label)); return m ? Number(m[1]) : null; }
function dailyNum_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function dailyName_(s) {
  var n = dailyText_(s).toLowerCase().replace(/[()]/g, ' ').replace(/\bfuits\b/, 'fruits').replace(/\s+/g, ' ').trim();
  return n === 'kara' ? 'kara coco' : n;
}

/** Reads one tab: values, formulas, and helpers to find blocks by the label in column B. */
function dailyGrid_(sh) {
  var rg = sh.getDataRange();
  var g = { sh: sh, v: rg.getValues(), f: rg.getFormulas(), writes: [] };
  g.b = function (r) { return dailyText_((g.v[r - 1] || [])[1]); };
  g.hasFormula = function (r, c) { return !!((g.f[r - 1] || [])[c - 1]); };
  g.val = function (r, c) { return (g.v[r - 1] || [])[c - 1]; };
  g.set = function (r, c, value) { if (!g.hasFormula(r, c)) g.writes.push([r, c, value]); };
  g.find = function (re, from) { for (var r = from || 1; r <= g.v.length; r++) if (re.test(g.b(r))) return r; return 0; };
  /** Rows after the block title (skipping header rows) up to its TOTAL row. */
  g.block = function (re, skip) {
    var start = g.find(re);
    if (!start) return [];
    var rows = [];
    for (var r = start + skip; r <= g.v.length && g.b(r).toUpperCase() !== 'TOTAL'; r++) rows.push(r);
    return rows;
  };
  g.flush = function () { g.writes.forEach(function (w) { sh.getRange(w[0], w[1]).setValue(w[2]); }); };
  return g;
}

/** Court rows of a block: [{row, court}] — a blank label continues the court above it. */
function dailyCourtRows_(g, rows) {
  var court = null;
  return rows.map(function (r) { court = dailyCourt_(g.b(r)) || court; return { row: r, court: court }; })
    .filter(function (x) { return x.court; });
}

/** Fills the copied template. Returns notes about anything that did not fit the format. */
function fillDailyReport_(ss, reps, courts, sales, other) {
  var notes = [];
  var bl = dailyGrid_(ss.getSheetByName(DAILY.BL));
  var pj = dailyGrid_(ss.getSheetByName(DAILY.PJ));
  var co = ss.getSheetByName(DAILY.CO) ? dailyGrid_(ss.getSheetByName(DAILY.CO)) : null;

  // ---- hours per court (top table) ----
  var hours = {}, total = 0;
  courts.forEach(function (c) { var h = dailyNum_(c.total_jam); hours[c.court] = dailyNum_((hours[c.court] || 0) + h); total = dailyNum_(total + h); });
  var top = bl.find(/^court$/i);
  var ayoStart = bl.find(/^booking by ayo/i);
  var firstCourtRow = 0;
  for (var r = top + 1; top && r < ayoStart; r++) {
    var n = dailyCourt_(bl.b(r));
    if (!n) continue;
    if (!firstCourtRow) firstCourtRow = r;
    bl.set(r, 3, hours[n] ? hours[n] + ' Jam' : '');
  }
  if (firstCourtRow) bl.set(firstCourtRow, 5, total ? total + ' jam' : '');

  // ---- AYO and manual bookings: one row per court + price ----
  [['AYO', /^booking by ayo/i], ['Manual', /^booking by manual/i]].forEach(function (k) {
    var slots = dailyCourtRows_(bl, bl.block(k[1], 1)).filter(function (x) { return bl.hasFormula(x.row, 7); });
    var groups = {};
    courts.filter(function (c) { return c.kategori === k[0]; }).forEach(function (c) {
      var key = c.court + '|' + Number(c.harga);
      var gr = groups[key] || (groups[key] = { court: Number(c.court), harga: Number(c.harga), jam: 0, metode: {} });
      gr.jam = dailyNum_(gr.jam + Number(c.total_jam));
      if (c.metode && c.metode !== 'BRI' && c.metode !== 'AYO') gr.metode[c.metode] = true;
    });
    var used = {};
    var place = function (gr, slot) {
      used[slot.row] = true;
      if (Number(bl.val(slot.row, 3)) !== gr.harga) bl.set(slot.row, 3, gr.harga);
      bl.set(slot.row, 4, gr.jam);
      var m = Object.keys(gr.metode);
      if (m.length) bl.set(slot.row, 8, 'Metode: ' + m.join(', '));
    };
    var left = [];
    Object.keys(groups).forEach(function (key) {
      var gr = groups[key];
      var hit = slots.filter(function (s) { return !used[s.row] && s.court === gr.court && Number(bl.val(s.row, 3)) === gr.harga; })[0];
      if (hit) place(gr, hit); else left.push(gr);
    });
    left.forEach(function (gr) {
      var free = slots.filter(function (s) { return !used[s.row] && s.court === gr.court; });
      if (free.length) place(gr, free[free.length - 1]);
      else notes.push('Booking ' + k[0] + ' Court ' + gr.court + ' ' + gr.jam + ' jam @' + gr.harga + ' tidak muat di tabel (baris harga penuh).');
    });
  });

  // ---- photoshoot / event per court: C = rate, D = hours, E/G/I = hours paid BRI/BCA/Mandiri ----
  var extraTotal = 0, extraText = [];
  [['Photoshoot', /^bookingan photoshoot/i, 14], ['Event - Lapangan', /^bookingan event/i, 15]].forEach(function (k) {
    var rows = dailyCourtRows_(bl, bl.block(k[1], 3));
    if (!rows.length) return;
    var per = {};
    other.filter(function (o) { return o.kategori === k[0]; }).forEach(function (o) {
      var c = dailyCourt_(o.keterangan) || rows[0].court;
      var p = per[c] || (per[c] = { jam: 0, nominal: 0, BRI: 0, BCA: 0, Mandiri: 0, ket: [] });
      var jam = Number(o.jam) || 1;
      p.jam = dailyNum_(p.jam + jam);
      p.nominal = dailyNum_(p.nominal + Number(o.nominal));
      p[o.metode === 'BCA' || o.metode === 'Mandiri' ? o.metode : 'BRI'] += jam;
      if (o.keterangan) p.ket.push(o.keterangan + (o.metode && o.metode !== 'BRI' ? ' (' + o.metode + ')' : ''));
    });
    Object.keys(per).forEach(function (c) {
      var p = per[c], row = rows.filter(function (x) { return x.court === Number(c); })[0] || rows[0];
      bl.set(row.row, 3, Math.round(p.nominal / p.jam * 100) / 100);
      bl.set(row.row, 4, p.jam);
      if (p.BRI) bl.set(row.row, 5, p.BRI);
      if (p.BCA) bl.set(row.row, 7, p.BCA);
      if (p.Mandiri) bl.set(row.row, 9, p.Mandiri);
      if (p.ket.length) bl.set(row.row, k[2], p.ket.join('; '));
    });
    if (k[0] === 'Event - Lapangan') {
      // Extra event charges go to "Biaya Tambahan Event" of the first court row (its TOTAL row adds that cell).
      other.filter(function (o) { return DAILY_EXTRA.indexOf(o.kategori) >= 0; }).forEach(function (o) {
        extraTotal = dailyNum_(extraTotal + Number(o.nominal));
        extraText.push(o.kategori.replace('Event - ', '') + (o.keterangan ? ' ' + o.keterangan : '') + ' ' + PCC.formatRupiah(o.nominal) + (o.metode && o.metode !== 'BRI' ? ' (' + o.metode + ')' : ''));
      });
      if (extraTotal) {
        bl.set(rows[0].row, 14, extraTotal);
        var ket = dailyText_(bl.val(rows[0].row, 15));
        bl.set(rows[0].row, 15, (ket ? ket + '; ' : '') + extraText.join('; '));
      }
    }
  });

  // ---- coaching: manual block, F = amount (L copies F), G = coach / method ----
  var coaching = other.filter(function (o) { return o.kategori === 'Coaching'; });
  if (coaching.length) {
    var crow = co ? co.block(/^booking manual coaching/i, 3) : [];
    if (!crow.length) notes.push('Coaching ' + coaching.length + ' baris tidak bisa ditulis: tabel coaching tidak ditemukan.');
    var buckets = crow.map(function () { return { n: 0, t: [] }; });
    coaching.forEach(function (o, i) {
      var b = buckets[Math.min(i, buckets.length - 1)];
      if (!b) return;
      b.n = dailyNum_(b.n + Number(o.nominal));
      b.t.push((o.keterangan || 'Coaching') + (o.metode ? ' (' + o.metode + ')' : ''));
    });
    buckets.forEach(function (b, i) { if (b.t.length) { co.set(crow[i], 6, b.n); co.set(crow[i], 7, b.t.join('; ')); } });
  }

  // ---- product sales per shift: E = qty (BRI/cash), G = qty paid BCA, H = qty via AYO ----
  var blocks = { 'Shift 1': pj.find(/^shift\s*1\b/i), 'Shift 2': pj.find(/^shift\s*2\b/i) };
  var totalStart = pj.find(/^total shift/i);
  var productRows = function (start) {
    var map = {};
    if (!start) return map;
    for (var r = start + 4; r <= pj.v.length && pj.b(r).toUpperCase() !== 'TOTAL'; r++) if (pj.b(r)) map[dailyName_(pj.b(r))] = r;
    return map;
  };
  var totalRows = productRows(totalStart);
  Object.keys(blocks).forEach(function (shift) {
    var start = blocks[shift];
    if (!start) return;
    var admins = reps.filter(function (r) { return r.shift === shift; }).map(function (r) { return r.admin; });
    pj.set(start, 2, shift + (admins.length ? ' ' + admins.join(' & ') : ''));
    var rowsByName = productRows(start);
    var agg = {};
    sales.filter(function (s) { return s.shift === shift; }).forEach(function (s) {
      var key = dailyName_(s.produk);
      var a = agg[key] || (agg[key] = { produk: s.produk, harga: Number(s.harga), qty: 0, bca: 0, ayo: 0 });
      if (s.metode === 'AYO') a.ayo += Number(s.qty); else a.qty += Number(s.qty);
      if (s.metode === 'BCA') a.bca += Number(s.qty);
    });
    Object.keys(agg).forEach(function (key) {
      var a = agg[key], r = rowsByName[key];
      if (!r) { notes.push(shift + ': produk "' + a.produk + '" (' + (a.qty + a.ayo) + ' x ' + PCC.formatRupiah(a.harga) + ') tidak ada di format, tidak ditulis.'); return; }
      if (Number(pj.val(r, 3)) !== a.harga) {
        pj.set(r, 3, a.harga);
        if (totalRows[key]) pj.set(totalRows[key], 3, a.harga);
        notes.push(shift + ': harga ' + a.produk + ' ' + PCC.formatRupiah(a.harga) + ' (berbeda dari format).');
      }
      pj.set(r, 5, a.qty);
      if (a.bca) pj.set(r, 7, a.bca);
      pj.set(r, 8, a.ayo);
    });
  });

  // ---- notes: admin notes + anything that did not fit, under the Summary table ----
  reps.forEach(function (r) { if (r.catatan) notes.push(r.shift + ' ' + r.admin + ': ' + r.catatan); });
  var sm = ss.getSheetByName(DAILY.SUMMARY);
  bl.flush(); pj.flush(); if (co) co.flush();
  if (sm && notes.length) {
    var at = dailyGrid_(sm).v.length + 2;
    sm.getRange(at, 2).setValue('Catatan');
    sm.getRange(at, 3).setValue(notes.join('\n'));
  }
  return notes;
}

/** One-off, from the editor: turns the Google Sheet in DAILY_TEMPLATE_ID into an empty template.
 *  Clears the sample day's inputs (cells with formulas are never touched) and lets the product
 *  TOTAL rows include the last product (Americano). */
function prepareDailyTemplate() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('DAILY_TEMPLATE_ID'));
  var bl = dailyGrid_(ss.getSheetByName(DAILY.BL));
  var top = bl.find(/^court$/i), ayoStart = bl.find(/^booking by ayo/i);
  for (var r = top + 1; top && r < ayoStart; r++) if (dailyCourt_(bl.b(r))) [3, 4, 5].forEach(function (c) { bl.set(r, c, ''); });
  dailyCourtRows_(bl, bl.block(/^booking by ayo/i, 1)).forEach(function (x) { [4, 5, 8].forEach(function (c) { bl.set(x.row, c, ''); }); });
  dailyCourtRows_(bl, bl.block(/^booking by manual/i, 1)).forEach(function (x) { [4, 5, 6, 8].forEach(function (c) { bl.set(x.row, c, ''); }); });
  [/^bookingan photoshoot/i, /^bookingan event/i, /^bookingan reclub/i].forEach(function (re, i) {
    bl.block(re, 3).forEach(function (r) { [4, 5, 6, 7, 8, 9, 10, 14, 15].concat(i === 2 ? [3] : []).forEach(function (c) { bl.set(r, c, ''); }); });
  });
  bl.flush();

  var pj = dailyGrid_(ss.getSheetByName(DAILY.PJ));
  var fixes = [];
  [/^shift\s*1\b/i, /^shift\s*2\b/i, /^total shift/i].forEach(function (re, i) {
    var start = pj.find(re);
    if (!start) return;
    if (i < 2) pj.set(start, 2, 'Shift ' + (i + 1));
    var first = start + 4, last = first, r = first;
    for (; r <= pj.v.length && pj.b(r).toUpperCase() !== 'TOTAL'; r++) {
      if (!pj.b(r)) continue;
      last = r;
      if (i < 2) { pj.set(r, 5, 0); pj.set(r, 6, ''); pj.set(r, 7, ''); pj.set(r, 8, 0); }
    }
    if (r <= pj.v.length) fixes.push([r, 9, '=SUM(I' + first + ':I' + last + ')'], [r, 10, '=SUM(J' + first + ':J' + last + ')']);
  });
  pj.flush();
  var s1 = pj.find(/^shift\s*1\b/i), s2 = pj.find(/^shift\s*2\b/i), st = pj.find(/^total shift/i);
  if (s1 && s2 && st) {
    // Shift-total rows add the same product row of both shifts (the template's last row pointed at TOTAL).
    var n1 = s1 + 4, n2 = s2 + 4;
    for (var t = st + 4; t <= pj.v.length && pj.b(t).toUpperCase() !== 'TOTAL'; t++, n1++, n2++) {
      if (pj.f[t - 1][4]) fixes.push([t, 5, '=E' + n1 + '+E' + n2]);
      if (pj.f[t - 1][7]) fixes.push([t, 8, '=H' + n1 + '+H' + n2]);
    }
  }
  fixes.forEach(function (x) { pj.sh.getRange(x[0], x[1]).setFormula(x[2]); });

  var ik = ss.getSheetByName(DAILY.IK);
  if (ik) {
    var g = dailyGrid_(ik);
    for (var i = 1; i <= g.v.length; i++) if (dailyCourt_(g.b(i))) [3, 4, 5].forEach(function (c) { g.set(i, c, ''); });
    g.flush();
  }
  var co = ss.getSheetByName(DAILY.CO);
  if (co) {
    var c2 = dailyGrid_(co);
    var gridEnd = c2.find(/^total$/i);
    for (var y = 4; y <= gridEnd; y++) for (var x = 3; x <= 14; x++) c2.set(y, x, '');
    c2.block(/^booking online/i, 3).forEach(function (row) { [4, 5].forEach(function (cc) { c2.set(row, cc, ''); }); });
    c2.block(/^booking manual coaching/i, 3).forEach(function (row) { [5, 6, 7, 8, 9, 10, 11].forEach(function (cc) { c2.set(row, cc, ''); }); });
    c2.flush();
  }
  ss.rename('TEMPLATE LAPORAN PEMASUKAN (WEB) - JANGAN DIHAPUS');
  var rootId = PropertiesService.getScriptProperties().getProperty('REPORT_ROOT_FOLDER_ID');
  if (rootId) moveIfElsewhere_(ss.getId(), childFolder_(DriveApp.getFolderById(rootId), 'LAPORAN ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy')));
  Logger.log('Template siap: ' + ss.getName());
  return 'ok';
}

/** Rebuilds every daily file listed in Archive_Index (e.g. after switching to the template format). */
function rebuildAllArchives() {
  var dates = readTable_(SHEET.ARCHIVE).rows.map(function (r) { return String(r.tanggal); })
    .filter(function (t) { return /^\d{4}-\d{2}-\d{2}$/.test(t); });
  var ok = 0;
  dates.forEach(function (t) { var res = rebuildArchive_(t); if (res.status === 'ok') ok++; else Logger.log(t + ': ' + JSON.stringify(res)); });
  Logger.log('Arsip dibuat ulang: ' + ok + ' dari ' + dates.length);
  return ok;
}
