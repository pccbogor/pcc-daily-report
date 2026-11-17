// Run: node tests/run-tests.js
process.env.TZ = 'Asia/Jakarta'; // dates in the sheets are Jakarta dates
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PCC = require('../shared/logic.js');
const { load } = require('./gas-mock.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (process.env.STACK ? e.stack : e.message)); process.exitCode = 1; }
}

const sample = (over = {}) => Object.assign({
  tanggal: '2026-11-15', shift: 'Shift 2', admin: 'Lutfhi', catatan: 'Ramai sore',
  courts: [
    { court: 1, kategori: 'AYO', harga: 100000, jumlah: 3, durasi: 1 },
    { court: 1, kategori: 'Manual', harga: 150000, jumlah: 2, durasi: 2, metode: 'BRI' },
    { court: 2, kategori: 'AYO', harga: '100.000', jumlah: 5, durasi: 1 },
    { court: 3, kategori: 'Manual', harga: 0, jumlah: 0, durasi: 1, metode: 'BRI' }, // empty row, dropped
  ],
  sales: [
    { produk: 'Raket', harga: 50000, harga_modal: '', qty: 6, metode: 'BRI' },
    { produk: 'Mineral', harga: 10000, harga_modal: 1710, qty: 3, metode: 'BCA' },
    { produk: 'Bola', harga: 90000, harga_modal: '', qty: 0, metode: 'BRI' }, // qty 0, dropped
  ],
  other: [],
}, over);

console.log('Shared logic');
test('copies of logic.js are identical to the source', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'logic.js'), 'utf8');
  for (const f of ['apps-script/Logic.gs', 'assets/logic.js']) {
    const body = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n').slice(1).join('\n');
    assert.strictEqual(body, src, f + ' is out of date: run node tools/sync-logic.js');
  }
});
test('brief example: AYO 3×1 jam @100rb and Manual 2×2 jam @150rb', () => {
  const t = PCC.compute(PCC.normalize(sample()));
  assert.strictEqual(t.courts[1].ayo.revenue, 300000);
  assert.strictEqual(t.courts[1].ayo.hours, 3);
  assert.strictEqual(t.courts[1].manual.revenue, 600000);
  assert.strictEqual(t.courts[1].manual.hours, 4);
  assert.strictEqual(t.courts[1].revenue, 900000);
  assert.strictEqual(t.courts[1].bookings, 5);
});
test('totals add up without double counting', () => {
  const t = PCC.compute(PCC.normalize(sample()));
  assert.strictEqual(t.revenueAyo, 800000);       // 300k C1 + 500k C2
  assert.strictEqual(t.revenueManual, 600000);
  assert.strictEqual(t.revenueCourt, 1400000);
  assert.strictEqual(t.revenueSales, 330000);     // 6×50k + 3×10k
  assert.strictEqual(t.grandTotal, 1730000);
  assert.strictEqual(t.totalHours, 12);
  assert.strictEqual(t.totalBookings, 10);
  assert.strictEqual(t.salesQty, 9);
});
test('Indonesian number input "100.000" and "1,5" parse correctly', () => {
  assert.strictEqual(PCC.toNum('100.000'), 100000);
  assert.strictEqual(PCC.toNum('Rp 144.500'), 144500);
  assert.strictEqual(PCC.toNum('1,5'), 1.5);
  assert.strictEqual(PCC.toNum('1.5'), 1.5);
});
test('validation catches missing shift, bad booking count and missing payment method', () => {
  const r = PCC.normalize(sample({ shift: '', courts: [{ court: 1, kategori: 'Manual', harga: 100000, jumlah: 1.5, durasi: 1, metode: '' }] }));
  const v = PCC.validate(r);
  assert.ok(v.errors.some((e) => e.includes('Shift')));
  assert.ok(v.errors.some((e) => e.includes('bilangan bulat')));
  assert.ok(v.errors.some((e) => e.includes('metode')));
});
test('weekly range is Monday–Sunday, monthly covers the whole month', () => {
  assert.deepStrictEqual(PCC.rangeFor('weekly', '2026-11-15'), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepStrictEqual(PCC.rangeFor('monthly', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
});

console.log('Apps Script backend (in-memory Sheets)');
const env = load({ ACCESS_PIN: '2468', ARCHIVE_FOLDER_ID: 'FOLDER123' });
env.ctx.setup();
const rows = (name) => env.sheets[name].data.slice(1).filter((r) => r.some((v) => v !== ''));
const col = (name, field) => env.ctx.HEADERS[name].indexOf(field);

test('setup creates every sheet, seeds 29 products and the formula summary', () => {
  for (const n of ['Reports', 'Court_Bookings', 'Sales', 'Other_Income', 'Audit_Log', 'Master_Produk', 'Config', 'Daily_Summary', 'Archive_Index', 'Rekap Bulanan']) assert.ok(env.sheets[n], n);
  assert.strictEqual(rows('Master_Produk').length, 29);
  assert.ok(env.sheets.Daily_Summary.formulas['2,1'].includes('UNIQUE(FILTER('));
  assert.ok(env.sheets.Daily_Summary.formulas['2,3'].includes('"AYO"'));
});
test('wrong PIN is rejected', () => {
  const r = env.call({ action: 'ping', pin: '0000' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /PIN salah/);
});
test('config returns products, shifts and methods', () => {
  const r = env.call({ action: 'config', pin: '2468' });
  assert.ok(r.ok);
  assert.strictEqual(r.data.products[0].produk, 'Raket');
  assert.deepStrictEqual(r.data.shifts, ['Shift 1', 'Shift 2']);
});

let first;
test('first submit creates the report, detail rows, audit row and archive', () => {
  first = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-1', report: sample() });
  assert.ok(first.ok, JSON.stringify(first));
  assert.strictEqual(first.action, 'CREATE');
  assert.strictEqual(first.version, 1);
  assert.strictEqual(rows('Reports').length, 1);
  assert.strictEqual(rows('Court_Bookings').length, 3);
  assert.strictEqual(rows('Sales').length, 2);
  assert.strictEqual(rows('Audit_Log').length, 1);
  assert.strictEqual(rows('Reports')[0][col('Reports', 'grand_total')], 1730000);
  assert.strictEqual(first.archive.status, 'ok');
  assert.match(first.archive.title, /LAPORAN PEMASUKAN 15 NOVEMBER 2026/);
  assert.strictEqual(env.archives[0].folder, 'FOLDER123');
});
test('same submissionId sent twice (double click) is stored once', () => {
  const again = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-1', report: sample() });
  assert.ok(again.ok && again.duplicate);
  assert.strictEqual(again.reportId, first.reportId);
  assert.strictEqual(rows('Reports').length, 1);
  assert.strictEqual(rows('Court_Bookings').length, 3);
});
test('resubmit with same tanggal + shift + nama overwrites (last one wins) and logs version 2', () => {
  const upd = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-2', report: sample({ admin: '  lutfhi ', sales: [{ produk: 'Raket', harga: 50000, qty: 2, metode: 'BRI' }] }) });
  assert.ok(upd.ok, JSON.stringify(upd));
  assert.strictEqual(upd.action, 'UPDATE');
  assert.strictEqual(upd.reportId, first.reportId);
  assert.strictEqual(upd.version, 2);
  assert.strictEqual(rows('Reports').length, 1);
  assert.strictEqual(rows('Sales').length, 1);
  assert.strictEqual(rows('Court_Bookings').length, 3);
  assert.strictEqual(rows('Reports')[0][col('Reports', 'revenue_sales')], 100000);
  assert.strictEqual(rows('Audit_Log').length, 2);
  assert.strictEqual(env.archives.length, 1, 'archive file is reused, not duplicated');
});
test('Shift 1 (sales only) is a separate report and both shifts feed the day totals', () => {
  const s1 = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-3', report: sample({ shift: 'Shift 1', admin: 'Haidar', courts: [], sales: [{ produk: 'Mineral Jumbo', harga: 15000, qty: 4, metode: 'BRI' }] }) });
  assert.ok(s1.ok, JSON.stringify(s1));
  assert.strictEqual(s1.action, 'CREATE');
  assert.strictEqual(rows('Reports').length, 2);
  const d = env.call({ action: 'dashboard', pin: '2468', from: '2026-11-15', to: '2026-11-15' });
  assert.ok(d.ok);
  assert.strictEqual(d.data.kpi.revenueCourt, 1400000);
  assert.strictEqual(d.data.kpi.revenueSales, 160000);
  assert.strictEqual(d.data.kpi.grandTotal, 1560000);
  assert.strictEqual(d.data.kpi.totalHours, 12);
  assert.strictEqual(d.data.courts[0].bookings, 5);
  assert.strictEqual(d.data.reports.length, 2);
  assert.strictEqual(d.data.topProducts[0].produk, 'Raket');
});
test('court bookings from a shift other than COURT_SHIFT are refused (no double counting)', () => {
  const before = rows('Court_Bookings').length;
  const bad = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-court-s1', report: sample({ shift: 'Shift 1', admin: 'Rina' }) });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('Shift 2 saja')), JSON.stringify(bad.errors));
  assert.strictEqual(rows('Court_Bookings').length, before);
  assert.strictEqual(PCC.recordsCourts('Shift 1'), false);
  assert.strictEqual(PCC.recordsCourts('Shift 1', { courtShift: '' }), true);
});
test('invalid report is refused and nothing is written', () => {
  const before = rows('Reports').length;
  const bad = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-4', report: sample({ tanggal: '2026-13-40' }) });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.length);
  assert.strictEqual(rows('Reports').length, before);
});
test('history and report detail return stored data for correction', () => {
  const h = env.call({ action: 'history', pin: '2468', from: '2026-11-01', to: '2026-11-30' });
  assert.strictEqual(h.data.length, 2);
  const rep = env.call({ action: 'report', pin: '2468', reportId: first.reportId });
  assert.ok(rep.ok);
  assert.strictEqual(rep.data.admin, 'lutfhi');
  assert.strictEqual(rep.data.courts.length, 3);
  assert.strictEqual(rep.data.sales[0].qty, 2);
});
test('archive file has Summary, Booking Lapang and Penjualan tabs, default Sheet1 removed', () => {
  const tabs = Object.keys(env.archives[0].tabs);
  assert.deepStrictEqual(tabs.sort(), ['Booking Lapang', 'Pemasukan Lain', 'Penjualan & Penyewaan', 'Summary'].sort());
  const booking = env.archives[0].tabs['Booking Lapang'].data;
  assert.strictEqual(booking.length - 1, 3); // header + 3 booking rows, all from Shift 2
  assert.strictEqual(env.archives[0].tabs['Penjualan & Penyewaan'].data.length - 1, 2); // header + Raket (Shift 2) + Mineral Jumbo (Shift 1)
});
test('other income keeps its category and hours (Photoshoot, Event, Coaching per coach)', () => {
  const r = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-other', report: sample({ tanggal: '2026-11-20', courts: [], sales: [], other: [
    { kategori: 'Photoshoot', keterangan: 'Prewedding', nominal: 450000, jam: 1, metode: 'BCA' },
    { kategori: 'Coaching', keterangan: 'Abi Ipan', nominal: 300000, jam: 5, metode: 'BRI' }, // jam ignored for coaching
    { kategori: 'Event - Uang Kebersihan', keterangan: 'Turnamen', nominal: 100000, metode: 'BRI' },
  ] }) });
  assert.ok(r.ok, JSON.stringify(r));
  const other = rows('Other_Income').filter((x) => x[col('Other_Income', 'tanggal')] === '2026-11-20');
  assert.deepStrictEqual(other.map((x) => [x[col('Other_Income', 'kategori')], x[col('Other_Income', 'jam')]]), [['Photoshoot', 1], ['Coaching', ''], ['Event - Uang Kebersihan', '']]);
  const bad = PCC.validate(PCC.normalize(sample({ other: [{ kategori: 'Kantin', keterangan: 'x', nominal: 1, metode: 'BRI' }] })));
  assert.ok(bad.errors.some((e) => e.includes('kategori')));
});
test('Rekap Bulanan has the October recap columns, one formula row per day, totals and median', () => {
  const sh = env.sheets['Rekap Bulanan'];
  const head = sh.data[3], sub = sh.data[4];
  ['Tanggal', 'Jumlah Jam Jika Fully Booked', 'Jumlah Jam Di Lapangan', 'Total Pemasukan Online', 'Total Pemasukan Offline (Admin)', 'Total Pemasukan Photoshoot', 'Total Pemasukan Event', 'Biaya Tambahan Lain', 'Pemasukan Coaching', 'Penjualan Adds On (jumlah terjual)']
    .forEach((h) => assert.ok(head.includes(h), h));
  ['Reguler', 'Photoshoot', 'Event', 'Lapangan', 'Uang Kebersihan', 'Uang Keamanan', 'Pemasangan Alat', 'Abi Ipan', 'Arif', 'Raket', 'Sewa Bola', 'Americano']
    .forEach((h) => assert.ok(sub.includes(h), h));
  const f = sh.formulas;
  assert.match(f['6,1'], /EOMONTH/);                         // day key
  assert.match(f['36,1'], /ROW\(\)-5/);                     // 31st row present
  const ci = (label) => sub.indexOf(label) + 1;
  assert.match(f['6,' + ci('AYO')], /Court_Bookings!\$K:\$K.*"AYO"/);   // revenue column K, kategori AYO
  assert.match(f['6,' + ci('Raket')], /Sales!\$H:\$H.*"Raket"/);         // qty column H
  assert.match(f['6,' + ci('Abi Ipan')], /"Coaching".*"Abi Ipan"/);
  assert.strictEqual(sh.data[36][1], 'Total');                 // labels are values, not formulas
  assert.strictEqual(sh.data[38][1], 'TOTAL KESELURUHAN');
  assert.strictEqual(sh.data[39][1], 'MEDIAN');
  assert.match(f['40,3'], /MEDIAN/);
  assert.match(f['38,' + ci('Raket')], /\$B\$2&"\*"/);       // product value = Sales total for the month
});
test('exportRecap_ saves "REKAP BULAN NOVEMBER 2026 (WEB)" into REKAP_FOLDER_ID and indexes it', () => {
  const e4 = load({ ACCESS_PIN: '1', REKAP_FOLDER_ID: 'BULANAN' });
  e4.ctx.setup();
  const res = e4.ctx.exportRecap_('2026-11');
  assert.strictEqual(res.title, 'REKAP BULAN NOVEMBER 2026 (WEB)');
  assert.strictEqual(e4.archives[0].folder, 'BULANAN');
  const again = e4.ctx.exportRecap_('2026-11');
  assert.strictEqual(e4.archives.length, 1, 'same month reuses the same file');
  assert.strictEqual(again.url, res.url);
  assert.throws(() => e4.ctx.exportRecap_('Nov'), /YYYY-MM/);
});
test('WhatsApp: manual mode when no token; automatic send through Fonnte when WA_TOKEN is set', () => {
  const manual = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-wa-1', report: sample({ tanggal: '2026-11-21' }) });
  assert.strictEqual(manual.wa.status, 'manual');
  assert.deepStrictEqual(manual.waText.split('\n').slice(0, 3), ['Lutfhi', '', 'Shift 2 *14.00-22.00 WIB*']);
  assert.strictEqual(env.fetches.length, 0);
  const e5 = load({ ACCESS_PIN: '1', WA_TARGET: '081200000000', WA_TOKEN: 'tok' });
  e5.ctx.setup();
  const auto = e5.call({ action: 'submit', pin: '1', submissionId: 'w', report: sample() });
  assert.strictEqual(auto.wa.status, 'sent');
  assert.strictEqual(e5.fetches.length, 1);
  assert.strictEqual(e5.fetches[0].url, 'https://api.fonnte.com/send');
  assert.strictEqual(e5.fetches[0].opt.payload.target, '081200000000');
  assert.strictEqual(e5.fetches[0].opt.headers.Authorization, 'tok');
  const dup = e5.call({ action: 'submit', pin: '1', submissionId: 'w', report: sample() });
  assert.ok(dup.duplicate);
  assert.strictEqual(e5.fetches.length, 1, 'a double click does not send WhatsApp twice');
  const cfg = e5.call({ action: 'config', pin: '1' }).data;
  assert.strictEqual(cfg.waTarget, '081200000000');
  assert.strictEqual(cfg.waAuto, true);
  assert.strictEqual(cfg.shiftHours['Shift 1'], '06.00-14.00');
  assert.strictEqual(cfg.products.find((p) => p.produk === 'Fitbar Coklat').label, 'Fitbar Choco delight');
  assert.strictEqual(PCC.waLink('081200000000', 'a b'), 'https://wa.me/6281200000000?text=a%20b');
});
test('formulas use ";" separators in an Indonesian-locale spreadsheet (commas inside text untouched)', () => {
  const e7 = load({ ACCESS_PIN: '1', __LOCALE: 'id_ID' });
  e7.ctx.setup();
  const outsideQuotes = (f) => f.replace(/"[^"]*"/g, '');
  const all = Object.values(e7.sheets.Daily_Summary.formulas).concat(Object.values(e7.sheets['Rekap Bulanan'].formulas)).filter((f) => String(f).startsWith('='));
  assert.ok(all.length > 100);
  all.forEach((f) => assert.ok(!outsideQuotes(f).includes(','), 'comma left in: ' + f.slice(0, 80)));
  assert.ok(e7.sheets.Daily_Summary.formulas['2,1'].includes(';'));
  const en = Object.values(env.sheets.Daily_Summary.formulas)[0];
  assert.ok(!en.includes(';'), 'en_US keeps commas');
});
test('deleteReport_ removes detail rows, keeps the report as DELETED, logs it, and trashes an emptied archive', () => {
  const e8 = load({ ACCESS_PIN: '1', ARCHIVE_FOLDER_ID: 'F' });
  e8.ctx.setup();
  const r = e8.call({ action: 'submit', pin: '1', submissionId: 'd1', report: sample() });
  assert.ok(r.ok);
  const rows8 = (n) => e8.sheets[n].data.slice(1).filter((x) => x.some((v) => v !== ''));
  const res = e8.ctx.deleteReport_(r.reportId, 'tes');
  assert.strictEqual(res.archive.status, 'removed');
  assert.strictEqual(rows8('Court_Bookings').length, 0);
  assert.strictEqual(rows8('Sales').length, 0);
  assert.strictEqual(rows8('Reports')[0][e8.ctx.HEADERS.Reports.indexOf('status')], 'DELETED');
  assert.strictEqual(rows8('Audit_Log').pop()[1], 'DELETE');
  assert.strictEqual(e8.archives[0].trashed, true);
  assert.strictEqual(rows8('Archive_Index').length, 0);
  const d = e8.call({ action: 'dashboard', pin: '1', from: '2026-11-15', to: '2026-11-15' });
  assert.strictEqual(d.data.kpi.grandTotal, 0);
  assert.throws(() => e8.ctx.deleteReport_(r.reportId), /tidak ditemukan/);
  const again = e8.call({ action: 'submit', pin: '1', submissionId: 'd2', report: sample() });
  assert.strictEqual(again.action, 'CREATE', 'same tanggal+shift+nama can be reported again after deletion');
});
test('month folders: archives go to "NOVEMBER 2026"/"DESEMBER 2026" (created once), old flat files can be moved', () => {
  const props = { ACCESS_PIN: '1', ARCHIVE_FOLDER_ID: 'HARIAN' };
  const e9 = load(props);
  e9.ctx.setup();
  e9.call({ action: 'submit', pin: '1', submissionId: 'm1', report: sample({ tanggal: '2026-11-15' }) });
  assert.strictEqual(e9.archives[0].folder, 'HARIAN', 'flat while ARCHIVE_MONTH_FOLDERS is off');
  props.ARCHIVE_MONTH_FOLDERS = 'true';
  assert.strictEqual(e9.ctx.moveArchivesToMonthFolders(), 1);
  assert.strictEqual(e9.archives[0].folder, 'HARIAN/NOVEMBER 2026');
  assert.strictEqual(e9.ctx.moveArchivesToMonthFolders(), 0, 'second run moves nothing');
  const nov2 = e9.call({ action: 'submit', pin: '1', submissionId: 'm2', report: sample({ tanggal: '2026-11-16' }) });
  assert.strictEqual(nov2.archive.status, 'ok');
  assert.strictEqual(e9.archives[1].folder, 'HARIAN/NOVEMBER 2026');
  const dec = e9.call({ action: 'submit', pin: '1', submissionId: 'm3', report: sample({ tanggal: '2026-12-01' }) });
  assert.strictEqual(dec.archive.status, 'ok');
  assert.strictEqual(e9.archives[2].folder, 'HARIAN/DESEMBER 2026');
  assert.deepStrictEqual(Object.keys(e9.folders.HARIAN.children).sort(), ['DESEMBER 2026', 'NOVEMBER 2026']);
  const again = e9.call({ action: 'submit', pin: '1', submissionId: 'm4', report: sample({ tanggal: '2026-11-15', sales: [] }) });
  assert.strictEqual(again.archive.status, 'ok');
  assert.strictEqual(e9.archives[0].moves, 2, 'existing archive is reused, not moved again');
});
test('every submit refreshes the REKAP BULAN file of that month; trigger installs once', () => {
  const e10 = load({ ACCESS_PIN: '1', REKAP_FOLDER_ID: 'BULANAN' });
  e10.ctx.setup();
  const a = e10.call({ action: 'submit', pin: '1', submissionId: 'r1', report: sample({ tanggal: '2026-11-15' }) });
  assert.strictEqual(a.recap.status, 'ok');
  assert.strictEqual(a.recap.title, 'REKAP BULAN NOVEMBER 2026 (WEB)');
  const b = e10.call({ action: 'submit', pin: '1', submissionId: 'r2', report: sample({ tanggal: '2026-11-20' }) });
  assert.strictEqual(b.recap.url, a.recap.url, 'same file all month');
  const c = e10.call({ action: 'submit', pin: '1', submissionId: 'r3', report: sample({ tanggal: '2026-12-02' }) });
  assert.strictEqual(c.recap.title, 'REKAP BULAN DESEMBER 2026 (WEB)');
  assert.notStrictEqual(c.recap.url, a.recap.url, 'new month, new file');
  assert.ok(e10.archives.every((x) => x.folder === 'BULANAN'));
  e10.ctx.installMonthlyTrigger();
  e10.ctx.installMonthlyTrigger();
  assert.strictEqual(e10.triggers.length, 1);
  assert.strictEqual(e10.triggers[0].fn, 'autoExportPreviousMonth');
  assert.strictEqual(e10.triggers[0].day, 1);
});
test('REPORT_ROOT_FOLDER_ID: files go to LAPORAN YYYY/BULAN YYYY/(LAPORAN HARIAN|Laporan Bulanan), old files can be moved', () => {
  const props = { ACCESS_PIN: '1', ARCHIVE_FOLDER_ID: 'HARIAN', ARCHIVE_MONTH_FOLDERS: 'true', REKAP_FOLDER_ID: 'BULANAN' };
  const e11 = load(props);
  e11.ctx.setup();
  e11.call({ action: 'submit', pin: '1', submissionId: 'x1', report: sample({ tanggal: '2026-11-15' }) });
  assert.strictEqual(e11.archives[0].folder, 'HARIAN/NOVEMBER 2026');
  assert.strictEqual(e11.archives[1].folder, 'BULANAN');
  props.REPORT_ROOT_FOLDER_ID = 'ROOT';
  // "LAPORAN 2026" and "NOVEMBER 2026/LAPORAN HARIAN" already exist in Drive: reuse them, do not duplicate.
  const y = e11.ctx.DriveApp.getFolderById('ROOT').createFolder('LAPORAN 2026');
  y.createFolder('NOVEMBER 2026').createFolder('LAPORAN HARIAN');
  assert.strictEqual(e11.ctx.moveAllToReportFolder(), 3, 'daily file, recap and database');
  assert.strictEqual(e11.archives[0].folder, 'ROOT/LAPORAN 2026/NOVEMBER 2026/LAPORAN HARIAN');
  assert.strictEqual(e11.archives[1].folder, 'ROOT/LAPORAN 2026/NOVEMBER 2026/Laporan Bulanan');
  assert.strictEqual(e11.archives.db.folder, 'ROOT/LAPORAN 2026');
  assert.strictEqual(e11.ctx.moveAllToReportFolder(), 0, 'second run moves nothing');
  const dec = e11.call({ action: 'submit', pin: '1', submissionId: 'x2', report: sample({ tanggal: '2026-12-01' }) });
  assert.strictEqual(dec.archive.status, 'ok');
  assert.strictEqual(dec.recap.status, 'ok');
  assert.strictEqual(e11.archives[2].folder, 'ROOT/LAPORAN 2026/DESEMBER 2026/LAPORAN HARIAN');
  assert.strictEqual(e11.archives[3].folder, 'ROOT/LAPORAN 2026/DESEMBER 2026/Laporan Bulanan');
  const jan = e11.call({ action: 'submit', pin: '1', submissionId: 'x3', report: sample({ tanggal: '2027-01-02' }) });
  assert.strictEqual(jan.archive.status, 'ok');
  assert.strictEqual(e11.archives[4].folder, 'ROOT/LAPORAN 2027/JANUARI 2027/LAPORAN HARIAN');
  assert.deepStrictEqual(Object.keys(e11.folders.ROOT.children).sort(), ['LAPORAN 2026', 'LAPORAN 2027']);
});
// Tiny evaluator for the template's formulas (=SUM(..), +, *, cell and cross-tab references).
function evaluator(tabs) {
  const colNo = (l) => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const cell = (tab, a1) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1);
    const sh = tabs[tab]; const r = Number(m[2]), c = colNo(m[1]);
    const f = sh.formulas[`${r},${c}`];
    if (f) return ev(tab, f.slice(1));
    const v = (sh.data[r - 1] || [])[c - 1];
    return typeof v === 'number' ? v : Number(v) || 0;
  };
  const rng = (tab, a, b) => {
    const p = (x) => { const m = /^([A-Z]+)(\d+)$/.exec(x); return [Number(m[2]), colNo(m[1])]; };
    const [r1, c1] = p(a), [r2, c2] = p(b), out = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cell(tab, String.fromCharCode(64 + c) + r));
    return out;
  };
  function ev(tab, expr) {
    const js = expr.replace(/SUM\(/g, 'S(')
      .replace(/(?:'([^']+)'!)?\b([A-Z]{1,2}\d+)(?::([A-Z]{1,2}\d+))?\b/g, (_, t, a, b) => (b
        ? `R(${JSON.stringify(t || tab)},"${a}","${b}")` : `C(${JSON.stringify(t || tab)},"${a}")`));
    const S = (...xs) => xs.flat().reduce((x, y) => x + (Number(y) || 0), 0);
    return Function('R', 'C', 'S', 'return ' + js)(rng, cell, S);
  }
  return (tab, a1) => cell(tab, a1);
}
test('daily file uses PCC\'s own LAPORAN PEMASUKAN format: copy of the template, inputs filled, Summary formulas add up', () => {
  const format = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'laporan-pemasukan-format.json'), 'utf8'));
  const e12 = load({ ACCESS_PIN: '1', ARCHIVE_FOLDER_ID: 'HARIAN', DAILY_TEMPLATE_ID: 'TPL', __TEMPLATE: format });
  e12.ctx.setup();
  const T = e12.archives.template.tabs;
  e12.ctx.prepareDailyTemplate();
  const tv = (tab, r, c) => (T[tab].data[r - 1] || [])[c - 1];
  assert.strictEqual(tv('Booking Lapang', 12, 4), '', 'sample hours cleared');
  assert.strictEqual(tv('Booking Lapang', 10, 4), 'Jumlah Jam Booking', 'headers untouched');
  assert.strictEqual(tv('Booking Lapang', 12, 3), 100000, 'price tiers kept');
  assert.strictEqual(tv('Penjualan & Penyewaan', 40, 5), 0, 'sales qty reset to 0');
  assert.strictEqual(tv('Penjualan & Penyewaan', 1, 2), 'Shift 1');
  assert.strictEqual(T['Penjualan & Penyewaan'].formulas['33,9'], '=SUM(I5:I32)', 'TOTAL now includes Americano');
  assert.strictEqual(T['Penjualan & Penyewaan'].formulas['102,5'], '=E32+E67');
  assert.strictEqual(T['Booking Lapang'].formulas['12,7'], '=SUM(D12*C12)', 'formulas untouched');
  assert.strictEqual(tv('Bookingan Internal-Komunitas', 4, 5), '');

  // A day with nothing sold still produces the full file, all zeros.
  const empty = e12.call({ action: 'submit', pin: '1', submissionId: 'e1', report: sample({ tanggal: '2026-11-20', shift: 'Shift 1', admin: 'Dewi', courts: [], sales: [], catatan: '' }) });
  assert.strictEqual(empty.archive && empty.archive.status, 'ok', JSON.stringify(empty).slice(0, 300));
  const f0 = e12.archives[e12.archives.length - 1];
  assert.strictEqual(f0.title, 'LAPORAN PEMASUKAN 20 NOVEMBER 2026 (WEB)');
  assert.deepStrictEqual(Object.keys(f0.tabs), Object.keys(format), 'same tabs as PCC\'s file');
  assert.strictEqual(evaluator(f0.tabs)('Summary', 'C13'), 0);
  assert.strictEqual(f0.tabs['Penjualan & Penyewaan'].data[0][1], 'Shift 1 Dewi');

  const rep = sample({
    tanggal: '2026-11-20', shift: 'Shift 2', admin: 'Lutfhi', catatan: '',
    courts: [
      { court: 1, kategori: 'AYO', harga: 100000, jumlah: 3, durasi: 1 },
      { court: 2, kategori: 'AYO', harga: 160000, jumlah: 2, durasi: 1 },            // price not in the table
      { court: 3, kategori: 'Manual', harga: 295000, jumlah: 1, durasi: 2, metode: 'BCA' },
    ],
    sales: [
      { produk: 'Raket', harga: 50000, qty: 4, metode: 'BRI' }, { produk: 'Raket', harga: 50000, qty: 1, metode: 'AYO' },
      { produk: 'Cinnamon Red Ginger 220 ml', harga: 20000, qty: 2, metode: 'BCA' }, { produk: 'Americano', harga: 15000, qty: 1, metode: 'BRI' },
      { produk: 'Kara Coco', harga: 18000, qty: 1, metode: 'BRI' },
    ],
    other: [
      { kategori: 'Photoshoot', keterangan: 'Prewed Court 2', nominal: 900000, jam: 2, metode: 'BRI' },
      { kategori: 'Event - Lapangan', keterangan: 'Turnamen Court 1', nominal: 450000, jam: 1, metode: 'Mandiri' },
      { kategori: 'Event - Uang Kebersihan', keterangan: 'Turnamen', nominal: 100000, metode: 'BRI' },
      { kategori: 'Coaching', keterangan: 'Abi Ipan', nominal: 300000, metode: 'BRI' },
    ],
  });
  const res = e12.call({ action: 'submit', pin: '1', submissionId: 'e2', report: rep });
  assert.ok(res.archive, JSON.stringify(res).slice(0, 400));
  assert.strictEqual(res.archive.status, 'ok');
  assert.ok(f0.trashed, 'previous file of the day goes to the trash');
  const f1 = e12.archives[e12.archives.length - 1];
  const val = evaluator(f1.tabs);
  const t = PCC.compute(PCC.normalize(rep));
  assert.strictEqual(val('Summary', 'C5'), t.revenueAyo);
  assert.strictEqual(val('Summary', 'C6'), t.revenueManual);
  assert.strictEqual(val('Summary', 'C7'), t.revenueSales);
  assert.strictEqual(val('Summary', 'C11'), 900000);
  assert.strictEqual(val('Summary', 'C12'), 550000);
  assert.strictEqual(val('Summary', 'C10'), 300000);
  assert.strictEqual(val('Summary', 'C13'), t.grandTotal, 'Summary total = system total');
  const bl = f1.tabs['Booking Lapang'].data;
  assert.strictEqual(bl[3][2], '3 Jam'); assert.strictEqual(bl[4][2], '2 Jam'); assert.strictEqual(bl[5][2], '2 Jam');
  assert.strictEqual(bl[3][4], '7 jam');
  assert.strictEqual(bl[11][3], 3, 'Court 1 AYO @100rb row');
  const pj = f1.tabs['Penjualan & Penyewaan'].data;
  assert.strictEqual(pj[35][1], 'Shift 2 Lutfhi');
  assert.strictEqual(pj[39][4], 4); assert.strictEqual(pj[39][7], 1, 'Raket: 4 BRI + 1 via AYO');
  assert.strictEqual(pj[62][4], 2); assert.strictEqual(pj[62][6], 2, 'BCA qty noted');
  assert.strictEqual(pj[0][1], 'Shift 1 Dewi');
});
test('INVENTORY STOKIES: Qty Keluar = Shift 1 + Shift 2 per day, new month file from the template with opening stock', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'inventory-format.json'), 'utf8'));
  const e13 = load({ ACCESS_PIN: '1', REPORT_ROOT_FOLDER_ID: 'ROOT', INVENTORY_TEMPLATE_ID: 'INVTPL', __TEMPLATES: { INVTPL: inv } });
  e13.ctx.setup();
  const s1 = e13.call({ action: 'submit', pin: '1', submissionId: 'i1', report: sample({ tanggal: '2026-11-17', shift: 'Shift 1', admin: 'A', courts: [],
    sales: [{ produk: 'Mineral', harga: 10000, qty: 3, metode: 'BRI' }, { produk: 'Pocari Sweet', harga: 15000, qty: 1, metode: 'BCA' }, { produk: 'Raket', harga: 50000, qty: 2, metode: 'BRI' }] }) });
  assert.strictEqual(s1.inventory.status, 'ok', JSON.stringify(s1.inventory));
  const nov = e13.archives.find((a) => a.title === 'INVENTORY STOKIES NOVEMBER 2026 (WEB)');
  assert.ok(nov, 'month file created');
  assert.strictEqual(nov.folder, 'ROOT/LAPORAN 2026/NOVEMBER 2026');
  assert.deepStrictEqual(Object.keys(nov.tabs), Object.keys(inv), 'same tabs as PCC\'s file');
  const cell = (f, tab, r, c) => (f.tabs[tab].data[r - 1] || [])[c - 1];
  const dayRow = (d) => 7 + d;
  assert.strictEqual(cell(nov, 'Mineral', 7, 1), 'Oktober');
  assert.strictEqual(cell(nov, 'Mineral', dayRow(30), 1).getDate(), 30);
  assert.strictEqual(cell(nov, 'Mineral', dayRow(31), 1), '', 'November has 30 days');
  assert.strictEqual(cell(nov, 'Mineral', dayRow(17), 4), 3);
  assert.strictEqual(cell(nov, 'Pocari Sweet 500Ml', dayRow(17), 4), 1, 'tab "Pocari Sweet 500Ml" = product "Pocari Sweet"');
  assert.strictEqual(cell(nov, 'GRIP', dayRow(17), 4), 0, 'nothing sold is written as 0');
  assert.strictEqual(nov.tabs.Mineral.formulas['25,5'], '=IF(OR(C25<>"",D25<>""),E24+C25-D25,"")', 'formulas kept');

  // Shift 2 adds to the same day; a resubmit replaces, never doubles.
  e13.call({ action: 'submit', pin: '1', submissionId: 'i2', report: sample({ tanggal: '2026-11-17', shift: 'Shift 2', admin: 'B', courts: [{ court: 1, kategori: 'AYO', harga: 100000, jumlah: 1, durasi: 1 }],
    sales: [{ produk: 'Mineral', harga: 10000, qty: 5, metode: 'AYO' }] }) });
  assert.strictEqual(cell(nov, 'Mineral', dayRow(17), 4), 8);
  e13.call({ action: 'submit', pin: '1', submissionId: 'i3', report: sample({ tanggal: '2026-11-17', shift: 'Shift 2', admin: 'B', courts: [{ court: 1, kategori: 'AYO', harga: 100000, jumlah: 1, durasi: 1 }],
    sales: [{ produk: 'Mineral', harga: 10000, qty: 4, metode: 'BRI' }] }) });
  assert.strictEqual(cell(nov, 'Mineral', dayRow(17), 4), 7);

  // Admin's complimentary row on the same date is left alone.
  const m = nov.tabs.Mineral.data;
  m[dayRow(18) - 1][9] = 'Yes'; m[dayRow(18) - 1][3] = 2; m[dayRow(18) - 1][0] = new Date(2026, 10, 17);
  e13.call({ action: 'submit', pin: '1', submissionId: 'i4', report: sample({ tanggal: '2026-11-17', shift: 'Shift 1', admin: 'A', courts: [], sales: [{ produk: 'Mineral', harga: 10000, qty: 1, metode: 'BRI' }] }) });
  assert.strictEqual(cell(nov, 'Mineral', dayRow(17), 4), 5);
  assert.strictEqual(cell(nov, 'Mineral', dayRow(18), 4), 2);

  // December: new file, same template, opening stock = November's Sisa Stok (C3).
  nov.tabs.Mineral.data[2][2] = 240;
  const dec = e13.call({ action: 'submit', pin: '1', submissionId: 'i5', report: sample({ tanggal: '2026-12-01', shift: 'Shift 1', admin: 'A', courts: [], sales: [{ produk: 'Mineral', harga: 10000, qty: 2, metode: 'BRI' }] }) });
  assert.strictEqual(dec.inventory.title, 'INVENTORY STOKIES DESEMBER 2026 (WEB)');
  const df = e13.archives.find((a) => a.title === 'INVENTORY STOKIES DESEMBER 2026 (WEB)');
  assert.strictEqual(df.folder, 'ROOT/LAPORAN 2026/DESEMBER 2026');
  assert.strictEqual(cell(df, 'Mineral', 7, 1), 'November');
  assert.strictEqual(cell(df, 'Mineral', 7, 3), 240);
  assert.strictEqual(cell(df, 'Mineral', dayRow(31), 1).getDate(), 31);
  assert.strictEqual(cell(df, 'Mineral', dayRow(1), 4), 2);
  assert.strictEqual(e13.archives.filter((a) => a.title.startsWith('INVENTORY STOKIES NOVEMBER')).length, 1, 'one file per month');
});
test('addInventoryProducts: a tab per drink/snack, 220 ml and 250 ml kept apart, safe to run twice', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'inventory-format.json'), 'utf8'));
  const e14 = load({ ACCESS_PIN: '1', REPORT_ROOT_FOLDER_ID: 'ROOT', INVENTORY_TEMPLATE_ID: 'INVTPL', __TEMPLATES: { INVTPL: inv } });
  e14.ctx.setup();
  const month = e14.ctx.Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM');
  const day1 = month + '-01';
  e14.call({ action: 'submit', pin: '1', submissionId: 'p1', report: sample({ tanggal: day1, shift: 'Shift 1', admin: 'A', courts: [], sales: [
    { produk: 'Cinnamon Red Ginger 220 ml', harga: 20000, qty: 2, metode: 'BRI' }, { produk: 'Cinnamon Red Ginger 250 ml', harga: 15000, qty: 5, metode: 'BRI' },
    { produk: 'Pocari Sweet', harga: 15000, qty: 3, metode: 'BRI' }, { produk: 'Fitbar Coklat', harga: 10000, qty: 1, metode: 'AYO' }] }) });
  const added = e14.ctx.addInventoryProducts();
  const T = e14.archives.templates.INVTPL;
  const names = T.getSheets().map((x) => x.getName());
  ['Lestea 250 ml', 'Cinnamon Red Ginger 220 ml', 'Cinnamon Red Ginger 250 ml', 'Kopi', 'Americano', 'Fitbar Coklat', 'Fitbar Fruits', 'Fitbar Tiramisu']
    .forEach((n) => assert.ok(names.includes(n), 'template has tab ' + n));
  ['Raket', 'Sewa Bola', 'Sewa Handuk', 'Upgrade Raket'].forEach((n) => assert.ok(!names.includes(n), 'no stock tab for rental ' + n));
  assert.strictEqual(names.filter((n) => /pocari/i.test(n)).length, 1, 'Pocari Sweet keeps its existing tab');
  assert.strictEqual(added.length, 32, '16 new tabs in the template and 16 in this month\'s file');
  const lestea = T.getSheetByName('Lestea 250 ml');
  assert.ok(lestea.formulas['8,7'].includes('"Lestea 250 ml"'), 'price look-up points at the new product');
  assert.strictEqual(lestea.data[0][0], 'INVENTORY - LESTEA 250 ML');
  assert.ok(T.getSheetByName('Master Produk').data.some((r) => r[1] === 'Lestea 250 ml' && r[3] === 15000));
  const file = e14.archives.find((a) => a.title.startsWith('INVENTORY STOKIES'));
  const d = (tab) => file.getSheetByName(tab).data[7][3];
  assert.strictEqual(d('Cinnamon Red Ginger 220 ml'), 2);
  assert.strictEqual(d('Cinnamon Red Ginger 250 ml'), 5);
  assert.strictEqual(d('Pocari Sweet 500Ml'), 3);
  assert.strictEqual(d('Fitbar Coklat'), 1);
  assert.strictEqual(d('Kara coco'.toLowerCase()), 0);
  assert.strictEqual(e14.ctx.addInventoryProducts().length, 0, 'second run adds nothing');
});
test('a full sheet grows its grid before appending (no "outside grid" error)', () => {
  const cb = env.sheets.Court_Bookings;
  cb.maxRows = cb.getLastRow(); // simulate a sheet whose grid is exactly full
  const r = env.call({ action: 'submit', pin: '2468', submissionId: 'sub-grow', report: sample({ tanggal: '2026-11-16' }) });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(cb.inserted > 0);
  assert.ok(cb.maxRows > cb.getLastRow() + 50);
});
test('archive is skipped cleanly when no folder is configured', () => {
  const e2 = load({ ACCESS_PIN: '1' });
  e2.ctx.setup();
  const r = e2.call({ action: 'submit', pin: '1', submissionId: 'x', report: sample() });
  assert.ok(r.ok);
  assert.strictEqual(r.archive.status, 'skipped');
});

const IMPORT_FILE = path.join(__dirname, '..', '..', 'import-data', 'history-nov-2026.json');
if (fs.existsSync(IMPORT_FILE)) {
  console.log('Import of the old xlsx reports (local data, not in the repo)');
  test('all imported reports are accepted by the backend and reproduce the files\' totals', () => {
    const { reports, reconciliation } = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'));
    const e3 = load({ ACCESS_PIN: '9' });
    e3.ctx.setup();
    reports.forEach((r) => {
      const res = e3.call({ action: 'submit', pin: '9', submissionId: `import-${r.tanggal}-${r.shift}-${r.admin}`, report: r });
      assert.ok(res.ok, r.tanggal + ' ' + r.shift + ': ' + JSON.stringify(res.errors || res.error));
    });
    const days = reconciliation.filter((x) => x.file_summary.total > 0);
    const expected = days.reduce((s, x) => s + x.file_summary.total, 0);
    const d = e3.call({ action: 'dashboard', pin: '9', from: '2026-11-01', to: '2026-11-30' });
    assert.strictEqual(d.data.kpi.grandTotal, expected);
    days.forEach((x) => {
      const day = d.data.daily.find((y) => y.tanggal === x.tanggal);
      assert.strictEqual(day.grandTotal, x.file_summary.total, x.tanggal);
    });
  });
}

if (fs.existsSync(IMPORT_FILE)) {
  test("WhatsApp message for 15 Nov reproduces PCC's own recap (Shift 1 Lutfhi, Shift 2 Haidar)", () => {
    const { reports } = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'));
    const e6 = load({ ACCESS_PIN: '1' });
    e6.ctx.setup();
    const cfg = e6.call({ action: 'config', pin: '1' }).data;
    const opts = { products: cfg.products, shiftHours: cfg.shiftHours, coaches: cfg.coaches, courtShift: cfg.courtShift };
    const s1 = PCC.waMessage(PCC.normalize(reports.find((r) => r.tanggal === '2026-11-15' && r.shift === 'Shift 1')), opts).split('\n');
    const s2 = PCC.waMessage(PCC.normalize(reports.find((r) => r.tanggal === '2026-11-15' && r.shift === 'Shift 2')), opts).split('\n');
    for (const line of ['Lutfhi', 'Shift 1 *06.00-14.00 WIB*', 'Tanggal: 15 November 2026', '* Mineral : Rp. 30.000 (3)', '* Mineral Jumbo : Rp. 15.000 (1)',
      '* Ion Water : Rp. 45.000 (3)', '* UC 1000 Lemon : Rp. 30.000 (2)', '* Lemon Fresco 250 ml : Rp. 30.000 (2)', '* Fitbar Choco delight : Rp. 0',
      'Penyewaan Raket : Rp. 300.000 (6)', 'Pembelian Bola : Rp. 0', 'Handuk : Rp. 0', '*💰Total Penjualan Majoo Shift 1 (06.00-14.00)* :', '*Rp. 450.000*'])
      assert.ok(s1.includes(line), 'Shift 1 missing: ' + line);
    assert.ok(!s1.some((l) => l.includes('TOTAL JAM TERPAKAI')), 'Shift 1 has no court block');
    for (const line of ['Haidar', 'Shift 2 *14.00-22.00 WIB*', '* Mineral Jumbo : Rp. 60.000 (4)', 'Pembelian Bola : Rp. 180.000 (2)', 'Grip : Rp. 30.000 (1)',
      '*Rp. 705.000*', '*TOTAL JAM TERPAKAI SELAMA SATU HARI 23 JAM*', 'Court 2:', 'Jam Terpakai: 9 jam', 'Total: Rp. 900.000',
      '*Pendapatan Aplikasi Ayo Satu Hari :*', '*Rp. 1.700.000*', '*Manual court*', '*Rp. 600.000*', 'Raket : Rp. 0', 'Coaching Abi Ipan : Rp. 0', '*Rp. 2.300.000*'])
      assert.ok(s2.includes(line), 'Shift 2 missing: ' + line);
  });
}

console.log(`\n${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
