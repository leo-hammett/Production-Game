import { gameState, type PaperInventory, type Transaction } from "./gameState";

export interface ResolvedTransactionMetadata {
  category: NonNullable<Transaction["category"]>;
  financeBucket: NonNullable<Transaction["financeBucket"]>;
  metricContribution: number;
  inventoryValueDelta: number;
}

export interface FinancialMetrics {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  cash: number;
  trackedInventoryValue: number;
  otherInventoryValue: number;
  totalInventoryValue: number;
}

export interface FinancialHistoryPoint {
  id: string;
  timestamp: number;
  cash: number;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
}

function resolveLegacyMetadata(
  transaction: Transaction,
): ResolvedTransactionMetadata {
  const reason = transaction.reason?.toLowerCase() || "";

  if (transaction.type === "paper") {
    return {
      category: "paper_purchase",
      financeBucket: "cost_of_sales",
      metricContribution: Math.abs(transaction.amount),
      inventoryValueDelta: 0,
    };
  }

  if (transaction.type === "inventory") {
    return {
      category: "inventory_purchase",
      financeBucket: "cost_of_sales",
      metricContribution: Math.abs(transaction.amount),
      inventoryValueDelta: -transaction.amount,
    };
  }

  if (transaction.orderId && reason.includes("payment")) {
    return {
      category: "order_income",
      financeBucket: "revenue",
      metricContribution: transaction.amount,
      inventoryValueDelta: 0,
    };
  }

  if (reason.includes("failure fine")) {
    return {
      category: "fine",
      financeBucket: "operating_expense",
      metricContribution: -transaction.amount,
      inventoryValueDelta: 0,
    };
  }

  if (transaction.amount < 0) {
    return {
      category: "operating_expense",
      financeBucket: "operating_expense",
      metricContribution: -transaction.amount,
      inventoryValueDelta: 0,
    };
  }

  return {
    category: "manual_cash",
    financeBucket: "neutral",
    metricContribution: 0,
    inventoryValueDelta: 0,
  };
}

export function resolveTransactionMetadata(
  transaction: Transaction,
): ResolvedTransactionMetadata {
  if (
    transaction.category &&
    transaction.financeBucket &&
    transaction.metricContribution !== undefined
  ) {
    return {
      category: transaction.category,
      financeBucket: transaction.financeBucket,
      metricContribution: transaction.metricContribution,
      inventoryValueDelta: transaction.inventoryValueDelta ?? 0,
    };
  }

  return resolveLegacyMetadata(transaction);
}

export function getTransactionCategoryLabel(transaction: Transaction): string {
  const metadata = resolveTransactionMetadata(transaction);

  switch (metadata.category) {
    case "manual_cash":
      return "Manual cash";
    case "order_income":
      return "Order income";
    case "paper_purchase":
      return "Paper purchase";
    case "inventory_purchase":
      return "Inventory purchase";
    case "inventory_allocation":
      return "Allocation";
    case "inventory_return":
      return "Inventory return";
    case "fine":
      return "Fine";
    case "starting_inventory":
      return "Starting inventory";
    case "operating_expense":
      return "Operating expense";
    default:
      return "Transaction";
  }
}

export function transactionAffectsTrackedInventory(
  transaction: Transaction,
): boolean {
  const metadata = resolveTransactionMetadata(transaction);

  return (
    transaction.type === "paper" &&
    !transaction.pending &&
    metadata.category === "paper_purchase"
  );
}

export function isManualTransaction(transaction: Transaction): boolean {
  const metadata = resolveTransactionMetadata(transaction);

  return (
    metadata.category === "manual_cash" ||
    metadata.category === "operating_expense" ||
    metadata.category === "inventory_purchase" ||
    metadata.category === "starting_inventory" ||
    metadata.category === "paper_purchase"
  );
}

export function calculateTrackedInventoryValue(
  paperInventory: PaperInventory,
): number {
  return Object.entries(paperInventory).reduce((total, [itemCode, quantity]) => {
    const item = gameState.getColorByCode(itemCode);
    return total + quantity * (item?.basePrice || 0);
  }, 0);
}

export function calculateOtherInventoryValue(
  transactions: Transaction[],
): number {
  return transactions.reduce((total, transaction) => {
    const metadata = resolveTransactionMetadata(transaction);
    return total + metadata.inventoryValueDelta;
  }, 0);
}

export function calculateFinancialMetrics(
  transactions: Transaction[],
  paperInventory: PaperInventory,
  cash: number,
): FinancialMetrics {
  const bucketTotals = transactions.reduce(
    (totals, transaction) => {
      const metadata = resolveTransactionMetadata(transaction);

      if (metadata.financeBucket === "revenue") {
        totals.revenue += metadata.metricContribution;
      } else if (metadata.financeBucket === "cost_of_sales") {
        totals.costOfSales += metadata.metricContribution;
      } else if (metadata.financeBucket === "operating_expense") {
        totals.operatingExpenses += metadata.metricContribution;
      }

      return totals;
    },
    {
      revenue: 0,
      costOfSales: 0,
      operatingExpenses: 0,
    },
  );

  const trackedInventoryValue = calculateTrackedInventoryValue(paperInventory);
  const otherInventoryValue = calculateOtherInventoryValue(transactions);
  const grossProfit = bucketTotals.revenue - bucketTotals.costOfSales;
  const netProfit = grossProfit - bucketTotals.operatingExpenses;

  return {
    revenue: bucketTotals.revenue,
    costOfSales: bucketTotals.costOfSales,
    grossProfit,
    operatingExpenses: bucketTotals.operatingExpenses,
    netProfit,
    cash,
    trackedInventoryValue,
    otherInventoryValue,
    totalInventoryValue: trackedInventoryValue + otherInventoryValue,
  };
}

export function buildFinancialHistory(
  transactions: Transaction[],
): FinancialHistoryPoint[] {
  const sortedTransactions = [...transactions].sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() ||
      left.id.localeCompare(right.id),
  );

  let runningCash = 0;
  let runningRevenue = 0;
  let runningCostOfSales = 0;
  let runningOperatingExpenses = 0;

  return sortedTransactions.map((transaction) => {
    const metadata = resolveTransactionMetadata(transaction);

    runningCash += transaction.amount;
    if (metadata.financeBucket === "revenue") {
      runningRevenue += metadata.metricContribution;
    } else if (metadata.financeBucket === "cost_of_sales") {
      runningCostOfSales += metadata.metricContribution;
    } else if (metadata.financeBucket === "operating_expense") {
      runningOperatingExpenses += metadata.metricContribution;
    }

    const grossProfit = runningRevenue - runningCostOfSales;

    return {
      id: transaction.id,
      timestamp: transaction.timestamp.getTime(),
      cash: runningCash,
      revenue: runningRevenue,
      costOfSales: runningCostOfSales,
      grossProfit,
      operatingExpenses: runningOperatingExpenses,
      netProfit: grossProfit - runningOperatingExpenses,
    };
  });
}
