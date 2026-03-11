// Asset-related types (financial and inventory)
export class PaperColor {
  code: string;
  name: string;
  cssClass: string;
  basePrice: number;

  constructor(code: string, name: string, cssClass: string, basePrice: number) {
    this.code = code;
    this.name = name;
    this.cssClass = cssClass;
    this.basePrice = basePrice;
  }

  // Get the effective price considering market conditions
  getEffectivePrice(colourLoveMultiplier: number = 1.0, whiteLoveMultiplier: number = 1.0): number {
    const isWhite = this.code === "w";
    const multiplier = isWhite ? whiteLoveMultiplier : colourLoveMultiplier;
    return this.basePrice * multiplier;
  }

  // Get the sell price (markdown at end of game)
  getSellPrice(sellMarkdown: number = SELL_MARKDOWN): number {
    return this.basePrice * sellMarkdown;
  }

  toString(): string {
    return this.name;
  }
}

export interface PaperInventory {
  [colorCode: string]: number;
}

export interface Transaction {
  id: string;
  timestamp: Date;
  amount: number; // positive for income, negative for expenses
  type: "cash" | "paper";
  paperColor?: string;
  paperQuantity?: number;
  reason?: string; // Optional reason
  affectsInventory?: boolean; // For non-paper inventory purchases
  orderId?: string; // Link to order for failure fines
}

// Financial constants
export const SELL_MARKDOWN = 0.7; // 30% loss when selling excess stock
export const FAILURE_FINE_RATIO = 0.3; // 30% fine for failed orders

// Color definitions with prices in pounds
export const PAPER_COLORS: PaperColor[] = [
  new PaperColor("w", "White", "bg-white", 10),
  new PaperColor("g", "Green", "bg-green-100", 20),
  new PaperColor("p", "Pink", "bg-pink-100", 20),
  new PaperColor("y", "Yellow", "bg-yellow-100", 20),
  new PaperColor("b", "Blue", "bg-blue-100", 20),
  new PaperColor("s", "Salmon", "bg-orange-100", 20),
];

// Create a map for quick lookups by code
export const PAPER_COLOR_MAP = new Map<string, PaperColor>(
  PAPER_COLORS.map(color => [color.code, color])
);

// Get color object from code
export const getColorByCode = (code: string): PaperColor | undefined => {
  return PAPER_COLOR_MAP.get(code);
};

// Get color object from name
export const getColorByName = (name: string): PaperColor | undefined => {
  return PAPER_COLORS.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
};

// Legacy helper functions for backwards compatibility
export const getColorName = (code: string): string => {
  const color = getColorByCode(code);
  return color?.name || code;
};

export const getColorCode = (name: string): string => {
  const color = getColorByName(name);
  return color?.code || name;
};

export const getColorPrice = (code: string): number => {
  const color = getColorByCode(code);
  return color?.basePrice || 10;
};

// Calculate financial metrics - paper valued at cost (what we paid)
export const calculateNetWorth = (
  cash: number,
  paperInventory: PaperInventory,
  transactions: Transaction[],
) => {
  const paperValue = Object.entries(paperInventory).reduce(
    (total, [color, qty]) => {
      return total + qty * getColorPrice(color);
    },
    0,
  );

  // Add value of other inventory purchases (marked as affecting inventory)
  const otherInventoryValue = transactions
    .filter((t) => t.type === "cash" && t.affectsInventory && t.amount < 0)
    .reduce((total, t) => total + Math.abs(t.amount), 0);

  return cash + paperValue + otherInventoryValue;
};

// Calculate actual profit if we had to sell inventory at end-game markdown price
// Paper inventory is worth less when selling at game end (70% of purchase price)
// Cash remains at full value
export const calculateProfit = (
  cash: number,
  paperInventory: PaperInventory,
  transactions: Transaction[],
) => {
  const netWorth = calculateNetWorth(cash, paperInventory, transactions);
  const inventoryValue = netWorth - cash; // Total value in inventory
  const finalSellValue = inventoryValue * SELL_MARKDOWN; // Inventory at final selling price
  return cash + finalSellValue; // Cash + discounted inventory
};

// Basically when we decide wether or not to do something we deem the cost as the cost of the inventory, but towards the end of the game it's worth nothing so we need a way to tell the simulation this. the love multipliers should be overrwriteable constants.
export const calculatePaperCurrentWorth = (
  colourLoveMultiplier: number, // do the same as below TODO:
  whiteLoveMultiplier: number, //Wait make this a systemwide variable, one that will be easy to sync using networking.md... sell_markdown too
  isColour: boolean,
  paperBuyPrice: number,
) => {
  if (isColour) {
    return paperBuyPrice * colourLoveMultiplier;
  } else {
    return paperBuyPrice * whiteLoveMultiplier;
  }
};

// Add new transaction
export const addTransaction = (
  amount: number,
  reason: string,
  paperColor?: string,
  paperQuantity?: number,
  affectsInventory?: boolean,
  orderId?: string,
): Transaction => {
  const newTransaction: Transaction = {
    id: Date.now().toString(),
    timestamp: new Date(),
    amount,
    type: paperColor ? "paper" : "cash",
    paperColor,
    paperQuantity,
    reason,
    affectsInventory,
    orderId,
  };

  return newTransaction;
};

