import { describe, expect, it } from "bun:test";
import { createAppsScriptContext } from "./helpers/apps-script-context.mjs";

describe("Spreadsheet retry status & menu", () => {
  it("treats status=retry as pending (not processed)", () => {
    const context = createAppsScriptContext({
      files: ["src/log-sheet.js"],
    });

    const isProcessed = context.shouldTreatLogRowAsProcessed_(
      "retry",
      "",
      "rename",
      "some-archive-id",
    );

    expect(isProcessed).toBe(false);
  });

  it("updates selected rows to status=retry in retrySelectedScanRenameRows", () => {
    let toastMessage = "";
    const activeRange = {
      getRow() {
        return 2;
      },
      getNumRows() {
        return 2;
      },
    };

    const sheetMock = {
      getName() {
        return "scan_rename_log";
      },
      getRange(row, col, numRows, numCols) {
        return {
          setValue(val) {
            valuesSet.push({ row, col, numRows, numCols, val });
          },
        };
      },
    };

    const valuesSet = [];
    const uiMock = {
      createMenu(title) {
        return {
          addItem(label, funcName) {
            return this;
          },
          addToUi() {},
        };
      },
    };

    const spreadsheetMock = {
      getActiveSheet() {
        return sheetMock;
      },
      getActiveRange() {
        return activeRange;
      },
      toast(msg) {
        toastMessage = msg;
      },
    };

    const context = createAppsScriptContext({
      files: ["src/logger.js", "src/utils.js", "src/config.js", "src/log-sheet.js", "src/main.js"],
      globals: {
        SpreadsheetApp: {
          getActiveSpreadsheet() {
            return spreadsheetMock;
          },
          getUi() {
            return uiMock;
          },
        },
      },
    });

    context.retrySelectedScanRenameRows();

    expect(valuesSet).toHaveLength(1);
    expect(valuesSet[0].row).toBe(2);
    expect(valuesSet[0].numRows).toBe(2);
    expect(valuesSet[0].val).toBe("retry");
    expect(toastMessage).toContain("再処理");
  });
});
