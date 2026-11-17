/**
 * Sends imported reports (output of tools/import_xlsx.py) to the live Apps Script API.
 *
 *   node tools/push-import.js <history.json> <WEB_APP_URL>           # dry run: shows what would be sent
 *   node tools/push-import.js <history.json> <WEB_APP_URL> --send    # sends
 *
 * The PIN is asked for on screen (or taken from the PCC_PIN environment variable); it is never written to disk.
 * Reports whose tanggal + shift + nama already exist in the database are SKIPPED, so an admin's
 * live report is never overwritten by old data. Each report uses a fixed submission ID, so
 * running the script twice does not create duplicates.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const PCC = require(path.join(__dirname, '..', 'shared', 'logic.js'));

const [file, url, flag] = process.argv.slice(2);
if (!file || !url) { console.error('Pakai: node tools/push-import.js <history.json> <WEB_APP_URL> [--send]'); process.exit(1); }
if (!/^https:\/\/script\.google\.com\//.test(url)) { console.error('URL harus Web App Apps Script (https://script.google.com/...)'); process.exit(1); }
const send = flag === '--send';
const { reports } = JSON.parse(fs.readFileSync(file, 'utf8'));

function askPin() {
  if (process.env.PCC_PIN) return Promise.resolve(process.env.PCC_PIN);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('PIN admin: ', (a) => { rl.close(); res(a.trim()); }));
}
async function call(pin, action, payload) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action, pin, ...payload }), redirect: 'follow' });
  const data = await r.json();
  if (!data.ok) { const e = new Error(data.error); e.errors = data.errors; throw e; }
  return data;
}

(async () => {
  const pin = await askPin();
  const dates = reports.map((r) => r.tanggal).sort();
  const existing = new Set((await call(pin, 'history', { from: dates[0], to: dates[dates.length - 1] })).data
    .map((x) => PCC.reportKey(x.tanggal, x.shift, x.admin)));
  let sent = 0, skipped = 0, failed = 0;
  for (const r of reports) {
    const key = PCC.reportKey(r.tanggal, r.shift, r.admin);
    const total = PCC.formatRupiah(PCC.compute(PCC.normalize(r)).grandTotal);
    if (existing.has(key)) { skipped++; console.log(`lewati  ${r.tanggal} ${r.shift} ${r.admin} (sudah ada di database)`); continue; }
    if (!send) { console.log(`akan kirim ${r.tanggal} ${r.shift} ${r.admin} ${total}`); continue; }
    try {
      const res = await call(pin, 'submit', { report: r, submissionId: `import-${r.tanggal}-${r.shift}-${r.admin}`.toLowerCase().replace(/\s+/g, '') });
      sent++; console.log(`OK     ${r.tanggal} ${r.shift} ${r.admin} ${total} -> ${res.reportId}${res.duplicate ? ' (sudah pernah dikirim)' : ''}`);
    } catch (e) {
      failed++; console.log(`GAGAL  ${r.tanggal} ${r.shift} ${r.admin}: ${e.message} ${(e.errors || []).join('; ')}`);
    }
  }
  console.log(send ? `\nTerkirim ${sent}, dilewati ${skipped}, gagal ${failed}.` : `\nUji coba saja. Tambahkan --send untuk mengirim. Dilewati ${skipped}.`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
