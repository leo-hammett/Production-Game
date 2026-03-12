import {
  PaperColor,
  gameState,
  type GameParameters,
  type Order,
  type PaperInventory,
  type Transaction,
} from "./gameState";
import { Schedule } from "./strategyPlanner";

export const DEFAULT_TEAM_ID = "TEAM-001";
export const TEAM_ID_STORAGE_KEY = "production-game/team-id";
export const SHARED_GAME_SCHEMA_VERSION = 1;

const DEFAULT_OCCASIONS = [
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
];

export interface SerializablePaperColor {
  code: string;
  name: string;
  cssClass: string;
  basePrice: number;
}

export interface SerializableOrder {
  id: string;
  orderTime: number;
  quantity: number;
  leadTime: number;
  paperColorCode: string;
  size: string;
  verseSize: number;
  occasion: string;
  price: number;
  available: boolean;
  status: Order["status"];
  progress: number;
  startTime?: number;
  dueTime?: number;
  selectedVerse?: string;
}

export interface SerializableTransaction {
  id: string;
  timestamp: string;
  amount: number;
  type: Transaction["type"];
  paperColor?: string;
  paperQuantity?: number;
  reason?: string;
  orderId?: string;
  pending?: boolean;
  deliveryTime?: number;
  arrivalTime?: number;
}

export interface SharedGameSnapshot {
  schemaVersion: number;
  teamId: string;
  orders: SerializableOrder[];
  paperInventory: PaperInventory;
  transactions: SerializableTransaction[];
  cash: number;
  // StationManager is runtime-only and does not sync directly.
  // Mirror any station state that must sync through `parameters`.
  parameters: GameParameters;
  currentSchedule: {
    id: string;
    orderIds: string[];
  };
  occasions: string[];
  paperColors: SerializablePaperColor[];
}

export interface SharedGameStateInput {
  teamId: string;
  orders: Order[];
  paperInventory: PaperInventory;
  transactions: Transaction[];
  cash: number;
  parameters: GameParameters;
  currentSchedule: Schedule;
  occasions: string[];
  paperColors: PaperColor[];
}

export interface DeserializedSharedGameState {
  teamId: string;
  orders: Order[];
  paperInventory: PaperInventory;
  transactions: Transaction[];
  cash: number;
  parameters: GameParameters;
  currentSchedule: Schedule;
  occasions: string[];
  paperColors: PaperColor[];
}

export function createDefaultPaperColors(): PaperColor[] {
  return [
    new PaperColor("w", "White", "bg-white", 10),
    new PaperColor("g", "Green", "bg-green-100", 20),
    new PaperColor("p", "Pink", "bg-pink-100", 20),
    new PaperColor("y", "Yellow", "bg-yellow-100", 20),
    new PaperColor("b", "Blue", "bg-blue-100", 20),
    new PaperColor("s", "Salmon", "bg-orange-100", 20),
  ];
}

export function createDefaultOccasions(): string[] {
  return [...DEFAULT_OCCASIONS];
}

export function createEmptySharedGameState(
  teamId: string,
): DeserializedSharedGameState {
  return {
    teamId,
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
      ...gameState.getParameters(),
      buyingCooldownEndTime: null,
    },
    currentSchedule: new Schedule("current", []),
    occasions: createDefaultOccasions(),
    paperColors: createDefaultPaperColors(),
  };
}

export function buildSharedGameSnapshot(
  input: SharedGameStateInput,
): SharedGameSnapshot {
  const snapshot = {
    schemaVersion: SHARED_GAME_SCHEMA_VERSION,
    teamId: input.teamId,
    orders: input.orders.map(serializeOrder),
    paperInventory: { ...input.paperInventory },
    transactions: input.transactions.map(serializeTransaction),
    cash: input.cash,
    parameters: { ...input.parameters },
    currentSchedule: {
      id: input.currentSchedule.id,
      orderIds: [...input.currentSchedule.orderIds],
    },
    occasions: [...input.occasions],
    paperColors: input.paperColors.map(serializePaperColor),
  };

  return JSON.parse(JSON.stringify(snapshot)) as SharedGameSnapshot;
}

export function deserializeSharedGameSnapshot(
  snapshot: SharedGameSnapshot,
): DeserializedSharedGameState {
  const paperColors = snapshot.paperColors.length
    ? snapshot.paperColors.map(deserializePaperColor)
    : createDefaultPaperColors();
  const paperColorMap = new Map(paperColors.map((color) => [color.code, color]));

  return {
    teamId: snapshot.teamId || DEFAULT_TEAM_ID,
    orders: (snapshot.orders || []).map((order) =>
      deserializeOrder(order, paperColorMap),
    ),
    paperInventory: {
      ...snapshot.paperInventory,
    },
    transactions: (snapshot.transactions || []).map(deserializeTransaction),
    cash: snapshot.cash ?? 0,
    parameters: {
      ...gameState.getParameters(),
      ...snapshot.parameters,
    },
    currentSchedule: new Schedule(
      snapshot.currentSchedule?.id || "current",
      snapshot.currentSchedule?.orderIds || [],
    ),
    occasions: snapshot.occasions?.length
      ? [...snapshot.occasions]
      : createDefaultOccasions(),
    paperColors,
  };
}

function serializePaperColor(color: PaperColor): SerializablePaperColor {
  return {
    code: color.code,
    name: color.name,
    cssClass: color.cssClass,
    basePrice: color.basePrice,
  };
}

function deserializePaperColor(color: SerializablePaperColor): PaperColor {
  return new PaperColor(
    color.code,
    color.name,
    color.cssClass,
    color.basePrice,
  );
}

function serializeOrder(order: Order): SerializableOrder {
  return {
    id: order.id,
    orderTime: order.orderTime,
    quantity: order.quantity,
    leadTime: order.leadTime,
    paperColorCode: order.paperColor.code,
    size: order.size,
    verseSize: order.verseSize,
    occasion: order.occasion,
    price: order.price,
    available: order.available,
    status: order.status,
    progress: order.progress,
    startTime: order.startTime,
    dueTime: order.dueTime,
    selectedVerse: order.selectedVerse,
  };
}

function deserializeOrder(
  order: SerializableOrder,
  paperColorMap: Map<string, PaperColor>,
): Order {
  const fallbackColor =
    paperColorMap.get("w") ||
    paperColorMap.values().next().value ||
    createDefaultPaperColors()[0];

  return {
    id: order.id,
    orderTime: order.orderTime,
    quantity: order.quantity,
    leadTime: order.leadTime,
    paperColor: paperColorMap.get(order.paperColorCode) || fallbackColor,
    size: order.size,
    verseSize: order.verseSize,
    occasion: order.occasion,
    price: order.price,
    available: order.available,
    status: order.status,
    progress: order.progress ?? (order.status === "pending_inventory" ? 0 : order.status === "sent" || order.status === "approved" ? 3 : 1),
    startTime: order.startTime,
    dueTime: order.dueTime,
    selectedVerse: order.selectedVerse,
  };
}

function serializeTransaction(
  transaction: Transaction,
): SerializableTransaction {
  return {
    id: transaction.id,
    timestamp: transaction.timestamp.toISOString(),
    amount: transaction.amount,
    type: transaction.type,
    paperColor: transaction.paperColor,
    paperQuantity: transaction.paperQuantity,
    reason: transaction.reason,
    orderId: transaction.orderId,
    pending: transaction.pending,
    deliveryTime: transaction.deliveryTime,
    arrivalTime: transaction.arrivalTime,
  };
}

function deserializeTransaction(
  transaction: SerializableTransaction,
): Transaction {
  return {
    id: transaction.id,
    timestamp: new Date(transaction.timestamp),
    amount: transaction.amount,
    type: transaction.type,
    paperColor: transaction.paperColor,
    paperQuantity: transaction.paperQuantity,
    reason: transaction.reason,
    orderId: transaction.orderId,
    pending: transaction.pending,
    deliveryTime: transaction.deliveryTime,
    arrivalTime: transaction.arrivalTime,
  };
}
