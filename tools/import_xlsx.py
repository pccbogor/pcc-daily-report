"""
Reads the old daily reports ("LAPORAN PEMASUKAN DD BULAN YYYY.xlsx") and turns each
file into the new system's reports:

  * Shift 1 report  = Shift 1 product sales
  * Shift 2 report  = Shift 2 product sales + the whole day's court bookings
                      (AYO + manual) + photoshoot / event / RECLUB / coaching income

Every file is checked against its own Summary sheet; differences are listed, never hidden.

Usage:
  python tools/import_xlsx.py <folder with xlsx files> <output.json>
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

MONTHS = {m: i + 1 for i, m in enumerate(
    ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'])}

# Old spellings -> names used in Master_Produk (Code.gs SEED_PRODUCTS).
PRODUCT_NAMES = {
    'kara coco': 'Kara Coco', 'kara': 'Kara Coco', 'fitbar coklat': 'Fitbar Coklat', 'fitbar tiramisu': 'Fitbar Tiramisu',
    'fitbar fuits': 'Fitbar Fruits', 'fitbar fruits': 'Fitbar Fruits', 'kopi': 'Kopi',
    'cinnamon red ginger (220 ml)': 'Cinnamon Red Ginger 220 ml', 'lemongrass red ginger (220 ml)': 'Lemongrass Red Ginger 220 ml',
    'lemon sereh tea (220 ml)': 'Lemon Sereh Tea 220 ml',
}


def num(v):
    if v is None or v == '':
        return 0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r'[^0-9,.\-]', '', str(v))
    if not s or s in '-.,':
        return 0
    s = s.replace('.', '').replace(',', '.') if (',' in s or re.search(r'\.\d{3}(\D|$)', s)) else s
    try:
        return float(s)
    except ValueError:
        return 0


def clean(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip()


def court_no(label):
    m = re.search(r'court\s*(\d)', clean(label), re.I)
    return int(m.group(1)) if m else None


def date_from_name(name):
    m = re.search(r'(\d{1,2})\s+([A-Z]+)\s+(\d{4})', name.upper())
    if not m:
        return None
    return '%s-%02d-%02d' % (m.group(3), MONTHS[m.group(2)], int(m.group(1)))


def find_rows(ws, text, col=2):
    t = text.lower()
    return [r for r in range(1, ws.max_row + 1) if clean(ws.cell(r, col).value).lower().startswith(t)]


def block(ws, title):
    """Rows between a block title in column B and its TOTAL row."""
    start = find_rows(ws, title)
    if not start:
        return []
    rows = []
    for r in range(start[0] + 1, ws.max_row + 1):
        if clean(ws.cell(r, 2).value).upper() == 'TOTAL':
            break
        rows.append(r)
    return rows


def parse(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    tanggal = date_from_name(path.name)
    notes = []
    s2 = {'courts': [], 'sales': [], 'other': []}
    s1 = {'courts': [], 'sales': [], 'other': []}

    # ---- court bookings: hours are recorded, not booking counts -> jumlah = hours, durasi = 1
    bl = wb['Booking Lapang']
    for title, kategori in (('Booking By AYO', 'AYO'), ('Booking By Manual', 'Manual')):
        court = None
        for r in block(bl, title):
            court = court_no(bl.cell(r, 2).value) or court
            harga, jam = num(bl.cell(r, 3).value), num(bl.cell(r, 4).value)
            if jam > 0:
                if harga <= 0:
                    notes.append('%s court %s baris %d: %s jam tanpa harga, tidak diimpor' % (kategori, court, r, jam))
                    continue
                whole = float(jam).is_integer()  # old files record hours, not booking counts
                s2['courts'].append({'court': court, 'kategori': kategori, 'harga': harga,
                                     'jumlah': int(jam) if whole else 1, 'durasi': 1 if whole else jam,
                                     'metode': 'AYO' if kategori == 'AYO' else 'BRI'})

    # ---- hours typed in the per-court table vs hours that carry revenue
    typed = 0
    for r in range(4, 7):
        m = re.search(r'(\d+(?:[.,]\d+)?)', clean(bl.cell(r, 3).value))
        typed += float(m.group(1).replace(',', '.')) if m else 0
    paid = sum(c['jumlah'] * c['durasi'] for c in s2['courts'])
    if abs(typed - paid) > 0.01:
        notes.append('Tabel jam per court mencatat %g jam, baris booking berbayar %g jam. Selisih %g jam tidak punya harga/revenue (kemungkinan reschedule/gratis), tidak diimpor.' % (typed, paid, typed - paid))

    # ---- photoshoot / event / RECLUB: K/L/M are BRI/BCA/Mandiri amounts per court
    kinds = {'Photoshoot': 'Photoshoot', 'Event': 'Event - Lapangan', 'RECLUB': 'Lainnya'}
    for title, label in (('Bookingan Photoshoot', 'Photoshoot'), ('Bookingan Event', 'Event'), ('Bookingan RECLUB', 'RECLUB')):
        for r in block(bl, title):
            c = court_no(bl.cell(r, 2).value)
            if not c:
                continue
            for col, metode in ((11, 'BRI'), (12, 'BCA'), (13, 'Mandiri')):
                v = num(bl.cell(r, col).value)
                if v > 0:
                    jam = num(bl.cell(r, 4).value) if kinds[label] != 'Lainnya' else 0
                    s2['other'].append({'kategori': kinds[label], 'keterangan': '%s Court %d' % (label, c), 'nominal': v, 'jam': jam, 'metode': metode})
            extra = num(bl.cell(r, 14).value)
            if extra > 0 and label != 'Photoshoot':
                s2['other'].append({'kategori': 'Biaya Tambahan Lain', 'keterangan': '%s Court %d' % (label, c), 'nominal': extra, 'metode': 'BRI'})
                notes.append('Biaya tambahan %s Court %d diimpor dengan metode BRI (metode tidak tercatat)' % (label, c))

    # ---- product sales per shift: E = qty paid BRI, H = qty via AYO
    pj = wb['Penjualan & Penyewaan']
    shift_rows = {}
    for r in range(1, pj.max_row + 1):
        m = re.match(r'shift\s*([12])\s*(.*)$', clean(pj.cell(r, 2).value), re.I)
        if m:
            shift_rows[m.group(1)] = (r, clean(m.group(2)).title() or 'Tidak tercatat')
    admins = {}
    for sh, (r0, admin) in shift_rows.items():
        admins[sh] = admin
        target = s1 if sh == '1' else s2
        r = r0 + 4
        while r <= pj.max_row and clean(pj.cell(r, 2).value).upper() != 'TOTAL':
            name = clean(pj.cell(r, 2).value)
            if name:
                produk = PRODUCT_NAMES.get(name.lower(), name)
                harga = num(pj.cell(r, 3).value)
                modal = pj.cell(r, 4).value
                modal = num(modal) if modal not in (None, '') else ''
                for col, metode in ((5, 'BRI'), (8, 'AYO')):
                    q = num(pj.cell(r, col).value)
                    if q > 0:
                        target['sales'].append({'produk': produk, 'harga': harga, 'harga_modal': modal, 'qty': int(q), 'metode': metode})
                bca = num(pj.cell(r, 7).value)
                if bca > 0:
                    notes.append('Shift %s %s: kolom "Jumlah Transaksi BCA" = %s, tidak dipakai (tidak ada di total file lama)' % (sh, name, bca))
            r += 1

    # ---- coaching: totals only (no per-session detail in the old file)
    if 'Coaching Abi Ipan' in wb.sheetnames:
        co = wb['Coaching Abi Ipan']
        total = num(co['D34'].value) + num(co['K50'].value)
        if total > 0:
            s2['other'].append({'kategori': 'Coaching', 'keterangan': 'Abi Ipan', 'nominal': total, 'metode': 'BRI'})
            notes.append('Coaching Rp%s diimpor sebagai satu baris, metode BRI (detail per sesi tidak tersedia)' % format(int(total), ','))

    # ---- the file's own summary, for reconciliation
    sm = wb['Summary']
    summary = {}
    for r in range(1, sm.max_row + 1):
        k = clean(sm.cell(r, 2).value).lower()
        if k:
            summary[k] = sm.cell(r, 3).value

    def summ(prefix):
        for k, v in summary.items():
            if k.startswith(prefix):
                return num(v)
        return 0

    reports = []
    for sh in ('1', '2'):
        data = s1 if sh == '1' else s2
        if not data['sales'] and not data['other'] and not data['courts']:
            continue  # nothing recorded for this shift (e.g. today's file still being filled)
        reports.append({'tanggal': tanggal, 'shift': 'Shift ' + sh, 'admin': admins.get(sh, 'Tidak tercatat'),
                        'catatan': 'Impor dari ' + path.name, **data})
    file_totals = {
        'ayo': summ('total pemasukan online'), 'manual': summ('total pemasukan offline'),
        'sales': summ('total sewa dan jual'), 'total': num(summary.get('total')),
    }
    return tanggal, reports, file_totals, notes


def main():
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(folder.glob('LAPORAN PEMASUKAN *.xlsx'), key=lambda p: date_from_name(p.name) or '')
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    allreports, recon = [], []
    for f in files:
        tanggal, reports, ft, notes = parse(f)
        ayo = sum(c['harga'] * c['jumlah'] for r in reports for c in r['courts'] if c['kategori'] == 'AYO')
        man = sum(c['harga'] * c['jumlah'] for r in reports for c in r['courts'] if c['kategori'] == 'Manual')
        sales = sum(s['harga'] * s['qty'] for r in reports for s in r['sales'])
        other = sum(o['nominal'] for r in reports for o in r['other'])
        hours = sum(c['jumlah'] for r in reports for c in r['courts'])
        total = ayo + man + sales + other
        recon.append({'tanggal': tanggal, 'file': f.name, 'hours': hours,
                      'import': {'ayo': ayo, 'manual': man, 'sales': sales, 'other': other, 'total': total},
                      'file_summary': ft, 'notes': notes,
                      'shifts': [(r['shift'], r['admin']) for r in reports]})
        allreports += reports
    out.write_text(json.dumps({'reports': allreports, 'reconciliation': recon}, ensure_ascii=False, indent=1), encoding='utf-8')

    rp = lambda v: 'Rp{:,.0f}'.format(v).replace(',', '.')
    print('%-10s %5s %12s %12s %12s %10s %13s %13s  %s' % ('Tanggal', 'Jam', 'AYO', 'Manual', 'Sales', 'Lain', 'Total impor', 'Total file', 'Selisih'))
    for x in recon:
        i, f = x['import'], x['file_summary']
        diff = i['total'] - f['total']
        print('%-10s %5g %12s %12s %12s %10s %13s %13s  %s' % (x['tanggal'], x['hours'], rp(i['ayo']), rp(i['manual']), rp(i['sales']), rp(i['other']), rp(i['total']), rp(f['total']), rp(diff) if diff else 'cocok'))
        for k in ('ayo', 'manual', 'sales'):
            if abs(i[k] - f[k]) > 0.5:
                print('   - %s: impor %s vs file %s' % (k, rp(i[k]), rp(f[k])))
        for n in x['notes']:
            print('   * ' + n)
    print('\n%d file, %d laporan shift -> %s' % (len(recon), len(allreports), out))


if __name__ == '__main__':
    main()
