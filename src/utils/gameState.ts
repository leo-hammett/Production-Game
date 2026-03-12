import {
  DEFAULT_STATION_SPEED_MULTIPLIERS,
  StationManager,
  type StationSpeedMultipliers,
} from "./station";
import {
  BUYING_COOLDOWN_SECONDS,
  PAPER_DELIVERY_SECONDS,
  STANDARD_TIME_RATIO,
} from "./gameConstants";
import { Schedule } from "./strategyPlanner";

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
  getEffectivePrice(
    colourLoveMultiplier: number = 1.0,
    whiteLoveMultiplier: number = 1.0,
  ): number {
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
  type: "cash" | "paper" | "inventory";
  paperColor?: string;
  paperQuantity?: number;
  reason?: string; // Optional reason
  orderId?: string; // Link to order for failure fines
  pending?: boolean; // For inventory transactions that haven't arrived yet
  deliveryTime?: number; // Expected delivery time in milliseconds
  arrivalTime?: number; // When the item should arrive (timestamp + deliveryTime)
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

export type StationNumber = 1 | 2 | 3;
export type OrderStationKey = "station1" | "station2" | "station3";

export interface StationTaskState {
  startedAt?: number;
  activeSince?: number;
  accumulatedActiveMs?: number;
  isPaused?: boolean;
  pausedAt?: number;
  completedAt?: number;
  performanceRating?: number;
  recordedAt?: number;
  recordedBatchTimeMs?: number;
  recordedQuantity?: number;
}

export interface OrderStationTasks {
  station1?: StationTaskState;
  station2?: StationTaskState;
  station3?: StationTaskState;
}

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
  progress: number; // 0 waiting on inventory, 1 ready station 1, 2 ready station 2, 3 ready station 3
  startTime?: number;
  dueTime?: number;
  selectedVerse?: string; // The actual verse text selected for this order (TODO)
  stationTasks?: OrderStationTasks;
}

// Game parameters that affect gameplay
export interface GameParameters {
  workstationSpeed: number;
  stationSpeedMultipliers: StationSpeedMultipliers;
  safetyStock: number;
  buyingCooldown: number;
  paperDeliverySeconds: number;
  buyingCooldownEndTime: number | null; // Unix timestamp when cooldown ends (null = no cooldown)
  sellMarkdown: number;
  failureFineRatio: number;
  colourLoveMultiplier: number; // For demand-based pricing
  whiteLoveMultiplier: number; // For demand-based pricing
  standardTimeRatio: number; // Contingency factor for worker breaks, etc. (normal time = observed time * this ratio)
  greedometer: number; // -1 bearish to +1 bullish bias for demand forecasting
  forecastSpeed: number; // Future production speed multiplier relative to observed current speed
}

// Global game state interface
export interface GameState {
  orders: Order[];
  paperInventory: PaperInventory;
  transactions: Transaction[];
  cash: number;
  parameters: GameParameters;
  stationManager: StationManager;
  currentSchedule: Schedule; // Active production schedule
  teamId: string; // Team identifier for the game session
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
      paperColors.map((color) => [color.code, color]),
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
        stationSpeedMultipliers: { ...DEFAULT_STATION_SPEED_MULTIPLIERS },
        safetyStock: 12,
        buyingCooldown: BUYING_COOLDOWN_SECONDS,
        paperDeliverySeconds: PAPER_DELIVERY_SECONDS,
        buyingCooldownEndTime: null,
        sellMarkdown: 0.7,
        failureFineRatio: 0.3,
        colourLoveMultiplier: 1.0,
        whiteLoveMultiplier: 1.0,
        standardTimeRatio: STANDARD_TIME_RATIO,
        greedometer: 0,
        forecastSpeed: 1.0,
      },
      stationManager: new StationManager(),
      currentSchedule: new Schedule("current", []),
      teamId: "TEAM-001", // Default team ID
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
    this.state.stationManager.applyStationSpeedMultipliers(
      this.state.parameters.stationSpeedMultipliers,
    );
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
    this.subscribers.forEach((callback) => callback());
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

  getCurrentSchedule(): Schedule {
    return this.state.currentSchedule;
  }

  getOccasions(): string[] {
    return this.state.occasions;
  }

  getPaperColors(): PaperColor[] {
    return this.state.paperColors;
  }

  getTeamId(): string {
    return this.state.teamId;
  }

  setTeamId(teamId: string) {
    this.state.teamId = teamId;
    this.notify();
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

  setOccasions(occasions: string[]) {
    this.state.occasions.length = 0;
    this.state.occasions.push(...occasions);
    this.notify();
  }

  setPaperColors(colors: PaperColor[]) {
    this.state.paperColors.length = 0;
    this.state.paperColors.push(...colors);
    this.state.paperColorMap.clear();
    colors.forEach((color) => {
      this.state.paperColorMap.set(color.code, color);
    });
    this.notify();
  }

  // Calculate current worth of paper based on demand multipliers
  calculatePaperCurrentWorth(paperColor: PaperColor | string): number {
    const color =
      typeof paperColor === "string"
        ? this.state.paperColorMap.get(paperColor)
        : paperColor;

    if (!color) return 0;

    const isWhite = color.code === "w";
    const multiplier = isWhite
      ? this.state.parameters.whiteLoveMultiplier
      : this.state.parameters.colourLoveMultiplier;

    return color.basePrice * multiplier;
  }

  // Calculate financial metrics - paper valued at cost (what we paid)
  calculateNetWorth(): number {
    // Paper inventory valued at purchase price
    const paperValue = Object.entries(this.state.paperInventory).reduce(
      (total, [colorCode, qty]) => {
        const color = this.state.paperColorMap.get(colorCode);
        return total + qty * (color?.basePrice || 10);
      },
      0,
    );

    // Pending paper purchases (paid for but not yet in inventory)
    const pendingPaperValue = this.state.transactions
      .filter((t) => t.type === "paper" && t.pending && t.paperQuantity && t.paperColor)
      .reduce((total, t) => {
        const color = this.state.paperColorMap.get(t.paperColor!);
        return total + (t.paperQuantity! * (color?.basePrice || 10));
      }, 0);

    // Other inventory value - sum all inventory transactions (positive or negative)
    // Negative amounts increase inventory value, positive amounts decrease it
    const otherInventoryValue = this.state.transactions
      .filter((t) => t.type === "inventory")
      .reduce((total, t) => total - t.amount, 0);

    // Net worth = cash + all inventory at cost
    return this.state.cash + paperValue + pendingPaperValue + otherInventoryValue;
  }

  // Calculate actual profit if we had to sell inventory at end-game markdown price
  // This shows the real P&L if game ended now
  calculateProfit(): number {
    // Paper inventory valued at selling price (with markdown)
    const paperSellValue = Object.entries(this.state.paperInventory).reduce(
      (total, [colorCode, qty]) => {
        const color = this.state.paperColorMap.get(colorCode);
        const basePrice = color?.basePrice || 10;
        return total + qty * basePrice * this.state.parameters.sellMarkdown;
      },
      0,
    );

    // Pending paper valued at selling price (with markdown)
    const pendingPaperSellValue = this.state.transactions
      .filter((t) => t.type === "paper" && t.pending && t.paperQuantity && t.paperColor)
      .reduce((total, t) => {
        const color = this.state.paperColorMap.get(t.paperColor!);
        const basePrice = color?.basePrice || 10;
        return total + (t.paperQuantity! * basePrice * this.state.parameters.sellMarkdown);
      }, 0);

    // Other inventory at sell price (with markdown)
    // Sum all inventory transactions and apply markdown
    const otherInventoryValue = this.state.transactions
      .filter((t) => t.type === "inventory")
      .reduce((total, t) => total - t.amount, 0);
    const otherInventorySellValue = otherInventoryValue * this.state.parameters.sellMarkdown;

    // Profit = cash + (all inventory at sell price)
    return this.state.cash + paperSellValue + pendingPaperSellValue + otherInventorySellValue;
  }

  // Helper functions for colors (backwards compatibility)
  getColorByCode(code: string): PaperColor | undefined {
    return this.state.paperColorMap.get(code);
  }

  getColorByName(name: string): PaperColor | undefined {
    return this.state.paperColors.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
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
    this.state.stationManager.applyStationSpeedMultipliers(
      this.state.parameters.stationSpeedMultipliers,
    );
    this.notify();
  }

  // Cooldown management
  startBuyingCooldown(durationSeconds: number) {
    const endTime = Date.now() + (durationSeconds * 1000);
    this.state.parameters.buyingCooldownEndTime = endTime;
    this.notify();
  }

  clearBuyingCooldown() {
    this.state.parameters.buyingCooldownEndTime = null;
    this.notify();
  }

  getBuyingCooldownRemaining(): number {
    if (!this.state.parameters.buyingCooldownEndTime) return 0;
    const remaining = this.state.parameters.buyingCooldownEndTime - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  isBuyingOnCooldown(): boolean {
    return this.getBuyingCooldownRemaining() > 0;
  }

  setCurrentSchedule(
    schedule: Schedule | { id: string; orderIds: string[] },
  ) {
    this.state.currentSchedule =
      schedule instanceof Schedule
        ? schedule
        : new Schedule(schedule.id, schedule.orderIds);
    this.notify();
  }

  updateScheduleOrderIds(orderIds: string[]) {
    this.state.currentSchedule.orderIds = orderIds;
    this.notify();
  }

  // Utility methods
  addOrder(order: Order) {
    this.state.orders.push(order);
    this.notify();
  }

  updateOrder(orderId: string, updates: Partial<Order>) {
    const index = this.state.orders.findIndex((o) => o.id === orderId);
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
    type: "cash" | "paper" | "inventory" = "cash",
    paperColor?: string,
    paperQuantity?: number,
    orderId?: string,
    pending?: boolean,
    deliveryTime?: number,
  ): Transaction {
    const now = Date.now();
    return {
      id: `${now}-${crypto.randomUUID()}`,
      timestamp: new Date(),
      amount,
      type: paperColor ? "paper" : type, // If paperColor is set, it's always "paper"
      paperColor,
      paperQuantity,
      reason,
      orderId,
      pending,
      deliveryTime,
      arrivalTime: pending && deliveryTime ? now + deliveryTime : undefined,
    };
  }

  updateInventory(colorCode: string, quantity: number) {
    this.state.paperInventory[colorCode] = quantity;
    this.notify();
  }

  // Get orders with specific status
  getOrdersByStatus(status: string): Order[] {
    return this.state.orders.filter((o) => o.status === status);
  }

  // Get pending orders (orders that will need inventory)
  getPendingOrders(): Order[] {
    return this.state.orders.filter(
      (o) =>
        o.status === "ordered" ||
        o.status === "pending_inventory" ||
        o.status === "WIP",
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
      paperColors.map((color) => [color.code, color]),
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
        stationSpeedMultipliers: { ...DEFAULT_STATION_SPEED_MULTIPLIERS },
        safetyStock: 12,
        buyingCooldown: BUYING_COOLDOWN_SECONDS,
        paperDeliverySeconds: PAPER_DELIVERY_SECONDS,
        buyingCooldownEndTime: null,
        sellMarkdown: 0.7,
        failureFineRatio: 0.3,
        colourLoveMultiplier: 1.0,
        whiteLoveMultiplier: 1.0,
        standardTimeRatio: STANDARD_TIME_RATIO,
        greedometer: 0,
        forecastSpeed: 1.0,
      },
      stationManager: new StationManager(),
      currentSchedule: new Schedule("current", []),
      teamId: "TEAM-001", // Default team ID
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
    this.state.stationManager.applyStationSpeedMultipliers(
      this.state.parameters.stationSpeedMultipliers,
    );
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
