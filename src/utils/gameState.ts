import { StationManager } from "./station";

// Asset-related types (moved from assets.ts)
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
  getSellPrice(sellMarkdown: number = 0.7): number {
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

// Order-related types (moved from orders.ts to avoid circular dependency)
export type OrderStatus =
  | "passive"
  | "ordered"
  | "pending_inventory"
  | "WIP"
  | "sent"
  | "approved"
  | "failed"
  | "deleted"
  | "other";

export interface Order {
  id: string;
  orderTime: number; // timestamp when order was placed
  quantity: number;
  leadTime: number; // -1 means infinite
  paperColor: PaperColor; // Now using the PaperColor object
  size: string; // A5, A6, A7
  verseSize: number;
  occasion: string;
  price: number;
  available: boolean;
  status: OrderStatus;
  startTime?: number;
  dueTime?: number;
}

// Game parameters that affect gameplay
export interface GameParameters {
  workstationSpeed: number;
  safetyStock: number;
  buyingCooldown: number;
  sellMarkdown: number;
  failureFineRatio: number;
  colourLoveMultiplier: number;  // For demand-based pricing
  whiteLoveMultiplier: number;   // For demand-based pricing
}

// Global game state interface
export interface GameState {
  orders: Order[];
  paperInventory: PaperInventory;
  transactions: Transaction[];
  cash: number;
  parameters: GameParameters;
  stationManager: StationManager;
  // Game data that can be modified
  occasions: string[];
  paperColors: PaperColor[];
  paperColorMap: Map<string, PaperColor>;
}

// Create a singleton game state
class GameStateManager {
  private static instance: GameStateManager;
  private state: GameState;
  private subscribers: Set<() => void> = new Set();

  private constructor() {
    // Initialize paper colors
    const paperColors = [
      new PaperColor("w", "White", "bg-white", 10),
      new PaperColor("g", "Green", "bg-green-100", 20),
      new PaperColor("p", "Pink", "bg-pink-100", 20),
      new PaperColor("y", "Yellow", "bg-yellow-100", 20),
      new PaperColor("b", "Blue", "bg-blue-100", 20),
      new PaperColor("s", "Salmon", "bg-orange-100", 20),
    ];
    
    const paperColorMap = new Map<string, PaperColor>(
      paperColors.map(color => [color.code, color])
    );

    this.state = {
      orders: [],
      paperInventory: {
        w: 0,
        g: 0,
        p: 0,
        y: 0,
        b: 0,
        s: 0,
      },
      transactions: [],
      cash: 0,
      parameters: {
        workstationSpeed: 1.0,
        safetyStock: 12,
        buyingCooldown: 0,
        sellMarkdown: 0.7,
        failureFineRatio: 0.3,
        colourLoveMultiplier: 1.0,
        whiteLoveMultiplier: 1.0,
      },
      stationManager: new StationManager(),
      occasions: [
        "Christmas",
        "New Year",
        "Wife's Birthday",
        "Father's Birthday",
        "Get Well Soon",
        "Baby Girl",
        "Baby Triplets",
        "Good Luck",
        "St David's Day",
        "Mother's Day",
        "Examination Pass",
        "Marriage",
        "Pregnancy",
        "New Job",
        "18 Birthday",
        "Driving Test Pass",
        "New Home",
        "Passover",
        "Easter",
        "Silver Wedding",
      ],
      paperColors,
      paperColorMap,
    };
  }

  static getInstance(): GameStateManager {
    if (!GameStateManager.instance) {
      GameStateManager.instance = new GameStateManager();
    }
    return GameStateManager.instance;
  }

  // Subscribe to state changes
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify() {
    this.subscribers.forEach(callback => callback());
  }

  // Getters
  getState(): GameState {
    return this.state;
  }

  getOrders(): Order[] {
    return this.state.orders;
  }

  getPaperInventory(): PaperInventory {
    return this.state.paperInventory;
  }

  getTransactions(): Transaction[] {
    return this.state.transactions;
  }

  getCash(): number {
    return this.state.cash;
  }

  getParameters(): GameParameters {
    return this.state.parameters;
  }

  getStationManager(): StationManager {
    return this.state.stationManager;
  }

  getOccasions(): string[] {
    return this.state.occasions;
  }

  getPaperColors(): PaperColor[] {
    return this.state.paperColors;
  }

  getPaperColorMap(): Map<string, PaperColor> {
    return this.state.paperColorMap;
  }

  // Add new paper color
  addPaperColor(color: PaperColor) {
    this.state.paperColors.push(color);
    this.state.paperColorMap.set(color.code, color);
    this.notify();
  }

  // Add new occasion
  addOccasion(occasion: string) {
    if (!this.state.occasions.includes(occasion)) {
      this.state.occasions.push(occasion);
      this.notify();
    }
  }

  // Calculate current worth of paper based on demand multipliers
  calculatePaperCurrentWorth(paperColor: PaperColor | string): number {
    const color = typeof paperColor === 'string' ? 
      this.state.paperColorMap.get(paperColor) : 
      paperColor;
    
    if (!color) return 0;
    
    const isWhite = color.code === "w";
    const multiplier = isWhite ? 
      this.state.parameters.whiteLoveMultiplier : 
      this.state.parameters.colourLoveMultiplier;
    
    return color.basePrice * multiplier;
  }

  // Calculate financial metrics - paper valued at cost (what we paid)
  calculateNetWorth(): number {
    const paperValue = Object.entries(this.state.paperInventory).reduce(
      (total, [colorCode, qty]) => {
        const color = this.state.paperColorMap.get(colorCode);
        return total + qty * (color?.basePrice || 10);
      },
      0,
    );

    // Add value of other inventory purchases (marked as affecting inventory)
    const otherInventoryValue = this.state.transactions
      .filter((t) => t.type === "cash" && t.affectsInventory && t.amount < 0)
      .reduce((total, t) => total + Math.abs(t.amount), 0);

    return this.state.cash + paperValue + otherInventoryValue;
  }

  // Calculate actual profit if we had to sell inventory at end-game markdown price
  calculateProfit(): number {
    const netWorth = this.calculateNetWorth();
    const inventoryValue = netWorth - this.state.cash;
    const finalSellValue = inventoryValue * this.state.parameters.sellMarkdown;
    return this.state.cash + finalSellValue;
  }

  // Helper functions for colors (backwards compatibility)
  getColorByCode(code: string): PaperColor | undefined {
    return this.state.paperColorMap.get(code);
  }

  getColorByName(name: string): PaperColor | undefined {
    return this.state.paperColors.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
  }

  getColorName(code: string): string {
    const color = this.getColorByCode(code);
    return color?.name || code;
  }

  getColorCode(name: string): string {
    const color = this.getColorByName(name);
    return color?.code || name;
  }

  getColorPrice(code: string): number {
    const color = this.getColorByCode(code);
    return color?.basePrice || 10;
  }

  // Setters with notification
  setOrders(orders: Order[]) {
    this.state.orders = orders;
    this.notify();
  }

  setPaperInventory(inventory: PaperInventory) {
    this.state.paperInventory = inventory;
    this.notify();
  }

  setTransactions(transactions: Transaction[]) {
    this.state.transactions = transactions;
    this.notify();
  }

  setCash(cash: number) {
    this.state.cash = cash;
    this.notify();
  }

  updateParameters(params: Partial<GameParameters>) {
    this.state.parameters = { ...this.state.parameters, ...params };
    this.notify();
  }

  // Utility methods
  addOrder(order: Order) {
    this.state.orders.push(order);
    this.notify();
  }

  updateOrder(orderId: string, updates: Partial<Order>) {
    const index = this.state.orders.findIndex(o => o.id === orderId);
    if (index !== -1) {
      this.state.orders[index] = { ...this.state.orders[index], ...updates };
      this.notify();
    }
  }

  addTransaction(transaction: Transaction) {
    this.state.transactions.push(transaction);
    this.notify();
  }

  // Create a new transaction
  createTransaction(
    amount: number,
    reason: string,
    paperColor?: string,
    paperQuantity?: number,
    affectsInventory?: boolean,
    orderId?: string,
  ): Transaction {
    return {
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
  }

  updateInventory(colorCode: string, quantity: number) {
    this.state.paperInventory[colorCode] = quantity;
    this.notify();
  }

  // Get orders with specific status
  getOrdersByStatus(status: string): Order[] {
    return this.state.orders.filter(o => o.status === status);
  }

  // Get pending orders (orders that will need inventory)
  getPendingOrders(): Order[] {
    return this.state.orders.filter(o => 
      o.status === "ordered" || 
      o.status === "pending_inventory" || 
      o.status === "WIP"
    );
  }

  // Reset the game state
  reset() {
    // Re-initialize paper colors
    const paperColors = [
      new PaperColor("w", "White", "bg-white", 10),
      new PaperColor("g", "Green", "bg-green-100", 20),
      new PaperColor("p", "Pink", "bg-pink-100", 20),
      new PaperColor("y", "Yellow", "bg-yellow-100", 20),
      new PaperColor("b", "Blue", "bg-blue-100", 20),
      new PaperColor("s", "Salmon", "bg-orange-100", 20),
    ];
    
    const paperColorMap = new Map<string, PaperColor>(
      paperColors.map(color => [color.code, color])
    );

    this.state = {
      orders: [],
      paperInventory: {
        w: 0,
        g: 0,
        p: 0,
        y: 0,
        b: 0,
        s: 0,
      },
      transactions: [],
      cash: 0,
      parameters: {
        workstationSpeed: 1.0,
        safetyStock: 12,
        buyingCooldown: 0,
        sellMarkdown: 0.7,
        failureFineRatio: 0.3,
        colourLoveMultiplier: 1.0,
        whiteLoveMultiplier: 1.0,
      },
      stationManager: new StationManager(),
      occasions: [
        "Christmas",
        "New Year",
        "Wife's Birthday",
        "Father's Birthday",
        "Get Well Soon",
        "Baby Girl",
        "Baby Triplets",
        "Good Luck",
        "St David's Day",
        "Mother's Day",
        "Examination Pass",
        "Marriage",
        "Pregnancy",
        "New Job",
        "18 Birthday",
        "Driving Test Pass",
        "New Home",
        "Passover",
        "Easter",
        "Silver Wedding",
      ],
      paperColors,
      paperColorMap,
    };
    this.notify();
  }
}

// Export singleton instance
export const gameState = GameStateManager.getInstance();

// React hook for using game state
export function useGameState() {
  // This would be used in React components to subscribe to state changes
  // For now, just return the state manager
  return gameState;
}

// Export legacy functions and constants for backwards compatibility
// These will be removed once all imports are updated
export const PAPER_COLORS = gameState.getPaperColors();
export const PAPER_COLOR_MAP = gameState.getPaperColorMap();
export const OCCASIONS = gameState.getOccasions();
export const SELL_MARKDOWN = 0.7;
export const FAILURE_FINE_RATIO = 0.3;

// Legacy function exports (use gameState methods directly instead)
export const getColorByCode = (code: string) => gameState.getColorByCode(code);
export const getColorByName = (name: string) => gameState.getColorByName(name);
export const getColorName = (code: string) => gameState.getColorName(code);
export const getColorCode = (name: string) => gameState.getColorCode(name);
export const getColorPrice = (code: string) => gameState.getColorPrice(code);
export const calculateNetWorth = () => gameState.calculateNetWorth();
export const calculateProfit = () => gameState.calculateProfit();
export const addTransaction = gameState.createTransaction.bind(gameState);