import ExcelJS from "exceljs";

/** Reads an .xlsx with a separate library, as another program would. */
export async function readWorkbook(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return workbook;
}

/** The value of a cell in the row that starts with this text. */
export function rowStarting(sheet: ExcelJS.Worksheet, first: string) {
  for (let number = 1; number <= sheet.rowCount; number += 1) {
    if (sheet.getRow(number).getCell(1).value === first) {
      return sheet.getRow(number);
    }
  }
  throw new Error(`No row starts with ${first}`);
}

/** Finds a column by its title in the first row. Numbered from 1. */
export function columnOf(sheet: ExcelJS.Worksheet, title: string): number {
  for (let number = 1; number <= sheet.columnCount; number += 1) {
    if (sheet.getRow(1).getCell(number).value === title) return number;
  }
  throw new Error(`No column called ${title}`);
}
