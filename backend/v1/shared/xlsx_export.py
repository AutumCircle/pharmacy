"""Small, dependency-free XLSX export helpers for admin catalogue reports."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable
from xml.sax.saxutils import escape


PHARMACY_TIME_ZONE = timezone(timedelta(hours=5))


def _catalog_text(value: Any, *, country: bool = False, vendor: bool = False) -> str:
    if value is None:
        return "Нет данных"
    text = str(value).strip()
    if not text:
        return "Нет данных"
    if country and text.startswith("*"):
        return "Нет данных"
    if vendor and not text.replace(",", "").strip():
        return "Нет данных"
    return text


def _column_name(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _inline_cell(reference: str, value: Any, style: int) -> str:
    text = escape("" if value is None else str(value))
    return (
        f'<c r="{reference}" s="{style}" t="inlineStr">'
        f'<is><t xml:space="preserve">{text}</t></is></c>'
    )


def _number_cell(reference: str, value: Any, style: int) -> str:
    number = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    return f'<c r="{reference}" s="{style}" t="n"><v>{number}</v></c>'


def _formatted_updated_at(value: Any) -> str:
    if not isinstance(value, datetime):
        return "Нет данных"
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(PHARMACY_TIME_ZONE).strftime("%d.%m.%Y %H:%M")


def build_out_of_stock_workbook(rows: Iterable[dict[str, Any]], generated_at: datetime) -> bytes:
    medicines = list(rows)
    generated = generated_at.astimezone(PHARMACY_TIME_ZONE).strftime("%d.%m.%Y %H:%M")
    headers = (
        "Артикул",
        "Название",
        "Базовая цена (с.)",
        "Цена продажи (с.)",
        "Производитель",
        "Страна",
        "Последнее обновление",
    )
    worksheet_rows = [
        '<row r="1" ht="28" customHeight="1">'
        f'{_inline_cell("A1", "Лекарства без наличия", 1)}</row>',
        '<row r="2" ht="20" customHeight="1">'
        f'{_inline_cell("A2", f"Сформировано: {generated} · Всего: {len(medicines)}", 2)}</row>',
        '<row r="3" ht="8" customHeight="1"></row>',
        '<row r="4" ht="26" customHeight="1">'
        + "".join(
            _inline_cell(f"{_column_name(index)}4", header, 3)
            for index, header in enumerate(headers, start=1)
        )
        + "</row>",
    ]
    for row_number, medicine in enumerate(medicines, start=5):
        cells = (
            _inline_cell(f"A{row_number}", medicine.get("medicine_id"), 4),
            _inline_cell(f"B{row_number}", medicine.get("medicine_name") or "", 4),
            _number_cell(f"C{row_number}", medicine.get("base_unit_price"), 5),
            _number_cell(f"D{row_number}", medicine.get("selling_unit_price"), 5),
            _inline_cell(
                f"E{row_number}", _catalog_text(medicine.get("vendor"), vendor=True), 4,
            ),
            _inline_cell(
                f"F{row_number}", _catalog_text(medicine.get("country"), country=True), 4,
            ),
            _inline_cell(f"G{row_number}", _formatted_updated_at(medicine.get("updated_at")), 4),
        )
        worksheet_rows.append(
            f'<row r="{row_number}" ht="22" customHeight="1">{"".join(cells)}</row>'
        )

    last_row = max(4, len(medicines) + 4)
    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G{last_row}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="16" customWidth="1"/>
    <col min="2" max="2" width="52" customWidth="1"/>
    <col min="3" max="4" width="21" customWidth="1"/>
    <col min="5" max="6" width="28" customWidth="1"/>
    <col min="7" max="7" width="23" customWidth="1"/>
  </cols>
  <sheetData>{''.join(worksheet_rows)}</sheetData>
  <autoFilter ref="A4:G{last_row}"/>
  <mergeCells count="2"><mergeCell ref="A1:G1"/><mergeCell ref="A2:G2"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>'''

    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><i/><sz val="10"/><color rgb="FF666666"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFED1C24"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE3E3E3"/></left><right style="thin"><color rgb="FFE3E3E3"/></right><top style="thin"><color rgb="FFE3E3E3"/></top><bottom style="thin"><color rgb="FFE3E3E3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>'''

    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>''',
        "docProps/app.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pharmacy Vatan V4</Application></Properties>''',
        "docProps/core.xml": f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Лекарства без наличия</dc:title><dc:creator>Pharmacy Vatan V4</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">{generated_at.astimezone(timezone.utc).isoformat()}</dcterms:created></cp:coreProperties>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Нет в наличии" sheetId="1" r:id="rId1"/></sheets></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
        "xl/styles.xml": styles_xml,
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, content in files.items():
            archive.writestr(path, content.encode("utf-8"))
    return output.getvalue()
