"""
Builds the monthly stock workbook ("INVENTORY STOKIES <BULAN>") from PCC's own file,
keeping its tabs, header rows, styles and drop-downs, with one row per day and the same
formulas on every row.

  python tools/build_inventory.py <PCC inventory .xlsx> <template.xlsx> [<month.xlsx> YYYY-MM]

* template.xlsx  31 empty day rows (Apps Script fills the dates and the opening stock
                 when it creates a new month from it).
* month.xlsx     optional: the given month with its dates, the opening stock (row 7) and
                 the admins' own extra rows (complimentary items, notes, stock in) carried
                 over from the source file. Daily "Qty Keluar" stays 0; the backend fills it
                 from the daily reports (rebuildInventoryMonth).
"""
import calendar
import copy
import datetime
import sys

import openpyxl

BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
# Product name in 'Master Produk' for each tab (used by the price look-ups).
MASTER = {
    'grip': 'GRIP', 'bola': 'bola odea', 'mineral': 'Mineral', 'mineral jumbo': 'Mineral jumbo',
    'pocari sweet 500ml': 'Pocari Sweet 500ml', 'ion water 500ml': 'Ion Water 500ml',
    'uc 1000 lemon': 'UC 1000 Lemon', 'uc 1000 orange': 'UC 1000 Orange', 'kara coco': 'Kara coco',
}
FIRST = 8      # first day row
DAY_ROWS = 31  # rows in the template
COLS = 11      # A..K


def row_formulas(r, master):
    look = "VLOOKUP(\"%s\",'Master Produk'!$B$2:$D$100,%d,FALSE)"
    return {
        5: '=IF(OR(C{r}<>"",D{r}<>""),{prev}C{r}-D{r},"")'.format(r=r, prev='' if r == 7 else 'E%d+' % (r - 1)),
        6: '=IF(AND(A{r}<>"",B{r}<>""),{l},"")'.format(r=r, l=look % (master, 2)),
        7: '=IF(AND(A{r}<>"",B{r}<>""),{l},"")'.format(r=r, l=look % (master, 3)),
        8: '=IF(D{r}<>"",D{r}*N(F{r}),"")'.format(r=r),
        9: '=IF(D{r}<>"",IF(J{r}="Yes",0,D{r}*N(G{r})),"")'.format(r=r),
    }


def read_extras(ws):
    """Admin entries worth keeping: notes, stock in and complimentary rows, per date."""
    plain, comp = {}, {}
    for r in range(FIRST, ws.max_row + 1):
        a = ws.cell(r, 1).value
        if not isinstance(a, datetime.datetime):
            continue
        t = a.date()
        c, d = ws.cell(r, 3).value or 0, ws.cell(r, 4).value or 0
        j, k = ws.cell(r, 10).value, ws.cell(r, 11).value
        if str(j).strip().lower() == 'yes':
            comp.setdefault(t, []).append((c, d, k))
        else:
            p = plain.setdefault(t, {'masuk': 0, 'notes': []})
            p['masuk'] += c
            if k:
                p['notes'].append(str(k))
    return plain, comp


def rebuild(ws, master, days=None, extras=None, opening=None):
    style7 = [copy.copy(ws.cell(7, c)._style) for c in range(1, COLS + 1)]
    style8 = [copy.copy(ws.cell(FIRST, c)._style) for c in range(1, COLS + 1)]
    date_fmt = ws.cell(FIRST, 1).number_format
    ws.delete_rows(7, ws.max_row)

    def put(r, styles, values):
        for c in range(1, COLS + 1):
            cell = ws.cell(r, c)
            cell._style = copy.copy(styles[c - 1])
            cell.value = values.get(c)
        for c, f in row_formulas(r, master).items():
            ws.cell(r, c).value = f

    put(7, style7, {1: opening[0] if opening else None, 2: 'Masuk', 3: opening[1] if opening else 0, 4: 0, 11: 'Stok Awal'})
    r = FIRST
    plain, comp = extras or ({}, {})
    rows = days if days else [None] * DAY_ROWS
    for day in rows:
        p = plain.get(day, {'masuk': 0, 'notes': []}) if day else {'masuk': 0, 'notes': []}
        put(r, style8, {1: datetime.datetime.combine(day, datetime.time()) if day else None, 2: 'Keluar',
                        3: p['masuk'], 4: 0, 11: '; '.join(p['notes']) or None})
        ws.cell(r, 1).number_format = date_fmt
        r += 1
        for c, d, k in (comp.get(day, []) if day else []):
            put(r, style8, {1: datetime.datetime.combine(day, datetime.time()), 2: 'Keluar', 3: c, 4: d, 10: 'Yes', 11: k})
            ws.cell(r, 1).number_format = date_fmt
            r += 1
    return r - 1


def build(src, out, month=None):
    wb = openpyxl.load_workbook(src)
    for ws in wb.worksheets[1:]:
        master = MASTER[ws.title.strip().lower()]
        if month:
            y, m = map(int, month.split('-'))
            days = [datetime.date(y, m, d) for d in range(1, calendar.monthrange(y, m)[1] + 1)]
            prev = BULAN[(m - 2) % 12]
            last = rebuild(ws, master, days, read_extras(ws), (prev, ws.cell(7, 3).value or 0))
        else:
            last = rebuild(ws, master)
        print('%-20s rows 7..%d' % (ws.title, last))
    wb.save(out)


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
    if len(sys.argv) > 4:
        build(sys.argv[1], sys.argv[3], sys.argv[4])
