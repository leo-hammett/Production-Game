import type { SharedGameSnapshot } from "./sharedGameState";

export interface CsvExportFile {
  filename: string;
  content: string;
}

type CsvValue = string | number | boolean | null | undefined;

const JSON_MIME_TYPE = "application/json;charset=utf-8";
const CSV_MIME_TYPE = "text/csv;charset=utf-8";

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "team";
}

function formatTimestampForFilename(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
}

function formatCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

function buildCsv<Row>(
  rows: Row[],
  columns: Array<{ header: string; getValue: (row: Row) => CsvValue }>,
): string {
  const headerRow = columns.map((column) => formatCsvCell(column.header)).join(",");
  const dataRows = rows.map((row) =>
    columns.map((column) => formatCsvCell(column.getValue(row))).join(","),
  );

  return [headerRow, ...dataRows].join("\n");
}

function downloadTextFile(filename: string, content: string, mimeType: string): string {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  return filename;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateSnapshotShape(value: unknown): asserts value is SharedGameSnapshot {
  if (!isRecord(value)) {
    throw new Error("Backup file must contain a JSON object.");
  }

  if (typeof value.schemaVersion !== "number") {
    throw new Error("Backup file is missing schemaVersion.");
  }

  if (typeof value.teamId !== "string") {
    throw new Error("Backup file is missing teamId.");
  }

  if (!Array.isArray(value.orders)) {
    throw new Error("Backup file is missing orders.");
  }

  if (!isRecord(value.paperInventory)) {
    throw new Error("Backup file is missing paperInventory.");
  }

  if (!Array.isArray(value.transactions)) {
    throw new Error("Backup file is missing transactions.");
  }

  if (typeof value.cash !== "number") {
    throw new Error("Backup file is missing cash.");
  }

  if (!isRecord(value.parameters)) {
    throw new Error("Backup file is missing parameters.");
  }

  if (!isRecord(value.currentSchedule) || !Array.isArray(value.currentSchedule.orderIds)) {
    throw new Error("Backup file is missing currentSchedule.");
  }

  if (!Array.isArray(value.occasions)) {
    throw new Error("Backup file is missing occasions.");
  }

  if (!Array.isArray(value.paperColors)) {
    throw new Error("Backup file is missing paperColors.");
  }
}

export function createBackupBaseFilename(teamId: string, date: Date = new Date()): string {
  return `production-game-${sanitizeFilenamePart(teamId)}-${formatTimestampForFilename(date)}`;
}

export function downloadSnapshotJson(
  snapshot: SharedGameSnapshot,
  options?: { date?: Date; teamId?: string },
): string {
  const date = options?.date ?? new Date();
  const teamId = options?.teamId ?? snapshot.teamId;
  return downloadTextFile(
    `${createBackupBaseFilename(teamId, date)}.json`,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    JSON_MIME_TYPE,
  );
}

export function parseSnapshotJson(content: string): SharedGameSnapshot {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  validateSnapshotShape(parsed);
  return parsed;
}

export async function readSnapshotFile(file: File): Promise<SharedGameSnapshot> {
  return parseSnapshotJson(await file.text());
}

export function buildSnapshotCsvExports(
  snapshot: SharedGameSnapshot,
  options?: { date?: Date; teamId?: string },
): CsvExportFile[] {
  const date = options?.date ?? new Date();
  const teamId = options?.teamId ?? snapshot.teamId;
  const filenameBase = createBackupBaseFilename(teamId, date);

  const ordersCsv = buildCsv(snapshot.orders, [
    { header: "id", getValue: (order) => order.id },
    { header: "orderTime", getValue: (order) => order.orderTime },
    { header: "quantity", getValue: (order) => order.quantity },
    { header: "leadTime", getValue: (order) => order.leadTime },
    { header: "paperColorCode", getValue: (order) => order.paperColorCode },
    { header: "size", getValue: (order) => order.size },
    { header: "verseSize", getValue: (order) => order.verseSize },
    { header: "occasion", getValue: (order) => order.occasion },
    { header: "price", getValue: (order) => order.price },
    { header: "available", getValue: (order) => order.available },
    { header: "status", getValue: (order) => order.status },
    { header: "progress", getValue: (order) => order.progress },
    { header: "startTime", getValue: (order) => order.startTime },
    { header: "dueTime", getValue: (order) => order.dueTime },
    { header: "selectedVerse", getValue: (order) => order.selectedVerse },
  ]);

  const transactionsCsv = buildCsv(snapshot.transactions, [
    { header: "id", getValue: (transaction) => transaction.id },
    { header: "timestamp", getValue: (transaction) => transaction.timestamp },
    { header: "amount", getValue: (transaction) => transaction.amount },
    { header: "type", getValue: (transaction) => transaction.type },
    { header: "paperColor", getValue: (transaction) => transaction.paperColor },
    { header: "paperQuantity", getValue: (transaction) => transaction.paperQuantity },
    { header: "reason", getValue: (transaction) => transaction.reason },
    { header: "orderId", getValue: (transaction) => transaction.orderId },
    { header: "pending", getValue: (transaction) => transaction.pending },
    { header: "deliveryTime", getValue: (transaction) => transaction.deliveryTime },
    { header: "arrivalTime", getValue: (transaction) => transaction.arrivalTime },
  ]);

  const summaryRows: Array<{ section: string; key: string; value: CsvValue }> = [
    { section: "meta", key: "schemaVersion", value: snapshot.schemaVersion },
    { section: "meta", key: "teamId", value: snapshot.teamId },
    { section: "meta", key: "cash", value: snapshot.cash },
    { section: "meta", key: "currentScheduleId", value: snapshot.currentSchedule.id },
    {
      section: "meta",
      key: "currentScheduleOrderIds",
      value: snapshot.currentSchedule.orderIds.join("|"),
    },
  ];

  Object.entries(snapshot.paperInventory).forEach(([colorCode, quantity]) => {
    summaryRows.push({
      section: "paperInventory",
      key: colorCode,
      value: quantity,
    });
  });

  Object.entries(snapshot.parameters).forEach(([key, value]) => {
    summaryRows.push({
      section: "parameters",
      key,
      value: typeof value === "object" ? JSON.stringify(value) : value,
    });
  });

  snapshot.paperColors.forEach((color) => {
    summaryRows.push({
      section: "paperColors",
      key: color.code,
      value: JSON.stringify(color),
    });
  });

  snapshot.occasions.forEach((occasion, index) => {
    summaryRows.push({
      section: "occasions",
      key: String(index),
      value: occasion,
    });
  });

  const summaryCsv = buildCsv(summaryRows, [
    { header: "section", getValue: (row) => row.section },
    { header: "key", getValue: (row) => row.key },
    { header: "value", getValue: (row) => row.value },
  ]);

  return [
    {
      filename: `${filenameBase}-orders.csv`,
      content: `${ordersCsv}\n`,
    },
    {
      filename: `${filenameBase}-transactions.csv`,
      content: `${transactionsCsv}\n`,
    },
    {
      filename: `${filenameBase}-summary.csv`,
      content: `${summaryCsv}\n`,
    },
  ];
}

export function downloadSnapshotCsvExports(
  snapshot: SharedGameSnapshot,
  options?: { date?: Date; teamId?: string },
): string[] {
  return buildSnapshotCsvExports(snapshot, options).map((file) =>
    downloadTextFile(file.filename, file.content, CSV_MIME_TYPE),
  );
}
