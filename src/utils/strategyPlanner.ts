import type { GameParameters, Order, PaperInventory } from "./gameState";
import { FAILURE_FINE_RATIO } from "./gameState";
import { PAPER_DELIVERY_MS } from "./gameConstants";
import { normalizeScheduleOrderIds } from "./orders";
import type { Transaction } from "./gameState";
import {
  calculateStationItemTimeDistribution,
  type NormalDistribution,
  type Station,
} from "./station";

export type { NormalDistribution } from "./station";

const COMMITTED_STATUSES = new Set<Order["status"]>([
  "ordered",
  "pending_inventory",
  "WIP",
  "sent",
]);
const MAX_CANDIDATE_EVALUATIONS = 25_000;
const DEFAULT_TOP_SUGGESTION_COUNT = 5;

export interface RequiredPapers {
  [colorCode: string]: {
    orderRequirement: number;
    safetyStockGap: number;
    totalNeeded: number;
    currentInventory: number;
    pendingDelivery: number;
  };
}

export class Schedule {
  id: string;
  orderIds: string[];

  constructor(id: string, orderIds: string[] = []) {
    this.id = id;
    this.orderIds = orderIds;
  }
}

export interface ScheduleOrderEvaluation {
  orderId: string;
  successProbability: number;
  expectedValue: number;
  baseProfit: number;
  failureFine: number;
  cumulativeBusyMs: number;
}

export interface RankedScheduleCandidate {
  id: string;
  rank: number;
  orderIds: string[];
  expectedProfit: number;
  expectedBusyMs: number;
  expectedProductionMs: number;
  inventoryDelayMs: number;
  profitPerSecond: number;
  requiredPapers: RequiredPapers;
  orderEvaluations: ScheduleOrderEvaluation[];
}

export interface SchedulerContext {
  orders: Order[];
  scheduleOrderIds: string[];
  paperInventory: PaperInventory;
  transactions?: Transaction[];
  parameters: Pick<GameParameters, "safetyStock" | "workstationSpeed">;
  stations: Station[];
  currentTime: number;
  buyingCooldownRemainingMs?: number;
  calculatePaperCurrentWorth: (paperColor: Order["paperColor"]) => number;
  maxCandidateEvaluations?: number;
  topSuggestionCount?: number;
}

export interface SchedulerSuggestionResult {
  currentSchedule: RankedScheduleCandidate | null;
  bestSuggestion: RankedScheduleCandidate | null;
  suggestions: RankedScheduleCandidate[];
  evaluatedCandidateCount: number;
  truncated: boolean;
  warning: string | null;
}

export function addDistributions(
  a: NormalDistribution,
  b: NormalDistribution,
): NormalDistribution {
  return {
    mean: a.mean + b.mean,
    stdDev: Math.sqrt(a.stdDev * a.stdDev + b.stdDev * b.stdDev),
  };
}

export function sumDistributions(
  distributions: NormalDistribution[],
): NormalDistribution {
  return distributions.reduce(
    (sum, distribution) => addDistributions(sum, distribution),
    {
      mean: 0,
      stdDev: 0,
    },
  );
}

export function probabilityLessThan(
  distribution: NormalDistribution,
  threshold: number,
): number {
  if (threshold === Infinity) {
    return 1;
  }

  if (distribution.stdDev <= Number.EPSILON) {
    return distribution.mean <= threshold ? 1 : 0;
  }

  const z = (threshold - distribution.mean) / distribution.stdDev;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const probability =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - probability : probability;
}

export function getCommittedOrders(orders: Order[]): Order[] {
  return orders.filter((order) => COMMITTED_STATUSES.has(order.status));
}

export function getOptionalOrders(orders: Order[]): Order[] {
  return orders.filter(
    (order) => order.status === "passive" && order.available,
  );
}

export function calculateCostOfFailure(order: Order): number {
  return order.price * FAILURE_FINE_RATIO;
}

export function estimateOrderTimeDistribution(
  order: Order,
  stations: Station[],
  workstationSpeed: number,
): NormalDistribution {
  const effectiveSpeed = workstationSpeed > 0 ? workstationSpeed : 1;
  const stationDistributions = stations
    .map((station) => {
      const distribution = calculateStationItemTimeDistribution(station, order);
      return {
        mean: (distribution.mean * 1000) / effectiveSpeed,
        stdDev: (distribution.stdDev * 1000) / effectiveSpeed,
      };
    })
    .filter((distribution) => distribution.mean > 0);

  if (!stationDistributions.length) {
    return {
      mean: order.quantity * 60_000,
      stdDev: Math.max(5_000, order.quantity * 15_000),
    };
  }

  const firstItemDistribution = sumDistributions(stationDistributions);
  const bottleneckDistribution = stationDistributions.reduce((slowest, current) =>
    current.mean > slowest.mean ? current : slowest,
  );
  const additionalItems = Math.max(0, order.quantity - 1);

  if (!additionalItems) {
    return firstItemDistribution;
  }

  return addDistributions(firstItemDistribution, {
    mean: bottleneckDistribution.mean * additionalItems,
    stdDev: bottleneckDistribution.stdDev * Math.sqrt(additionalItems),
  });
}

function getDueTime(order: Order): number {
  if (order.dueTime !== undefined) {
    return order.dueTime;
  }

  if (order.leadTime < 0) {
    return Infinity;
  }

  return order.orderTime + order.leadTime * 60 * 1000;
}

function buildRequiredPapers(
  orderIds: string[],
  orderMap: Map<string, Order>,
  paperInventory: PaperInventory,
  safetyStock: number,
  transactions: Transaction[] = [],
  currentTime: number,
): RequiredPapers {
  const requiredPapers: RequiredPapers = {};
  const pendingDeliveriesByColor = transactions.reduce<Record<string, number>>(
    (accumulator, transaction) => {
      if (
        transaction.type === "paper" &&
        transaction.pending &&
        transaction.paperColor &&
        transaction.paperQuantity &&
        (!transaction.arrivalTime || transaction.arrivalTime >= currentTime)
      ) {
        accumulator[transaction.paperColor] =
          (accumulator[transaction.paperColor] || 0) + transaction.paperQuantity;
      }

      return accumulator;
    },
    {},
  );

  orderIds.forEach((orderId) => {
    const order = orderMap.get(orderId);
    if (!order) {
      return;
    }

    const colorCode = order.paperColor.code;
    if (!requiredPapers[colorCode]) {
      requiredPapers[colorCode] = {
        orderRequirement: 0,
        safetyStockGap: 0,
        totalNeeded: 0,
        currentInventory: paperInventory[colorCode] || 0,
        pendingDelivery: pendingDeliveriesByColor[colorCode] || 0,
      };
    }

    requiredPapers[colorCode].orderRequirement += order.quantity;
  });

  Object.values(requiredPapers).forEach((paperRequirement) => {
    const availableInventory =
      paperRequirement.currentInventory + paperRequirement.pendingDelivery;
    const orderShortfall = Math.max(
      0,
      paperRequirement.orderRequirement - availableInventory,
    );
    const endingInventoryWithoutExtraSafety =
      availableInventory - paperRequirement.orderRequirement;

    paperRequirement.safetyStockGap = Math.max(
      0,
      safetyStock - Math.max(0, endingInventoryWithoutExtraSafety),
    );
    paperRequirement.totalNeeded = Math.max(
      0,
      paperRequirement.orderRequirement +
        safetyStock -
        availableInventory,
    );

    if (paperRequirement.totalNeeded < orderShortfall) {
      paperRequirement.totalNeeded = orderShortfall;
    }
  });

  return requiredPapers;
}

export function evaluateScheduleCandidate(
  orderIds: string[],
  context: SchedulerContext,
): RankedScheduleCandidate {
  const orderMap = new Map(context.orders.map((order) => [order.id, order]));
  let cumulativeDistribution: NormalDistribution = { mean: 0, stdDev: 0 };

  const orderEvaluations = orderIds
    .map((orderId) => orderMap.get(orderId))
    .filter((order): order is Order => Boolean(order))
    .map((order) => {
      const timeDistribution = estimateOrderTimeDistribution(
        order,
        context.stations,
        context.parameters.workstationSpeed,
      );
      cumulativeDistribution = addDistributions(
        cumulativeDistribution,
        timeDistribution,
      );

      const dueTime = getDueTime(order);
      const timeRemaining =
        dueTime === Infinity
          ? Infinity
          : Math.max(0, dueTime - context.currentTime);
      const successProbability = probabilityLessThan(
        cumulativeDistribution,
        timeRemaining,
      );
      const baseProfit =
        order.price -
        order.quantity * context.calculatePaperCurrentWorth(order.paperColor);
      const failureFine = calculateCostOfFailure(order);
      const expectedValue =
        baseProfit * successProbability -
        failureFine * (1 - successProbability);

      return {
        orderId: order.id,
        successProbability,
        expectedValue,
        baseProfit,
        failureFine,
        cumulativeBusyMs: cumulativeDistribution.mean,
      };
    });

  const expectedProfit = orderEvaluations.reduce(
    (sum, evaluation) => sum + evaluation.expectedValue,
    0,
  );
  const requiredPapers = buildRequiredPapers(
    orderIds,
    orderMap,
    context.paperInventory,
    context.parameters.safetyStock,
    context.transactions,
    context.currentTime,
  );
  const requiresInventoryPurchase = Object.values(requiredPapers).some(
    (paperRequirement) => paperRequirement.totalNeeded > 0,
  );
  const inventoryDelayMs = requiresInventoryPurchase
    ? (context.buyingCooldownRemainingMs || 0) + PAPER_DELIVERY_MS
    : 0;
  const expectedProductionMs = cumulativeDistribution.mean;
  const expectedBusyMs = expectedProductionMs + inventoryDelayMs;

  return {
    id: orderIds.join("|") || "empty",
    rank: 0,
    orderIds,
    expectedProfit,
    expectedBusyMs,
    expectedProductionMs,
    inventoryDelayMs,
    profitPerSecond:
      expectedBusyMs > 0 ? expectedProfit / (expectedBusyMs / 1000) : 0,
    requiredPapers,
    orderEvaluations,
  };
}

export function rankScheduleCandidates(
  schedules: RankedScheduleCandidate[],
): RankedScheduleCandidate[] {
  return [...schedules]
    .sort((left, right) => {
      if (right.profitPerSecond !== left.profitPerSecond) {
        return right.profitPerSecond - left.profitPerSecond;
      }

      if (right.expectedProfit !== left.expectedProfit) {
        return right.expectedProfit - left.expectedProfit;
      }

      return left.expectedBusyMs - right.expectedBusyMs;
    })
    .map((schedule, index) => ({
      ...schedule,
      rank: index + 1,
    }));
}

function buildPermutations(
  source: string[],
  maxCount: number,
): { permutations: string[][]; truncated: boolean } {
  const permutations: string[][] = [];
  const items = [...source];
  let truncated = false;

  const permute = (startIndex: number) => {
    if (permutations.length >= maxCount) {
      truncated = true;
      return;
    }

    if (startIndex >= items.length) {
      permutations.push([...items]);
      return;
    }

    for (let index = startIndex; index < items.length; index += 1) {
      [items[startIndex], items[index]] = [items[index], items[startIndex]];
      permute(startIndex + 1);
      [items[startIndex], items[index]] = [items[index], items[startIndex]];

      if (truncated) {
        return;
      }
    }
  };

  permute(0);

  return { permutations, truncated };
}

export function generateScheduleCandidates(
  orders: Order[],
  maxCandidateEvaluations: number = MAX_CANDIDATE_EVALUATIONS,
): { orderIds: string[][]; truncated: boolean } {
  const committedOrderIds = getCommittedOrders(orders).map((order) => order.id);
  const optionalOrderIds = getOptionalOrders(orders).map((order) => order.id);
  const candidates: string[][] = [];
  let truncated = false;

  for (
    let subsetMask = 0;
    subsetMask < 2 ** optionalOrderIds.length && !truncated;
    subsetMask += 1
  ) {
    const selectedOptionalIds = optionalOrderIds.filter(
      (_orderId, index) => (subsetMask & (1 << index)) !== 0,
    );
    const includedIds = [...committedOrderIds, ...selectedOptionalIds];

    if (!includedIds.length) {
      continue;
    }

    const remainingCapacity = maxCandidateEvaluations - candidates.length;
    if (remainingCapacity <= 0) {
      truncated = true;
      break;
    }

    const { permutations, truncated: permutationTruncated } = buildPermutations(
      includedIds,
      remainingCapacity,
    );
    candidates.push(...permutations);
    truncated = permutationTruncated;
  }

  return {
    orderIds: candidates,
    truncated,
  };
}

function getCurrentPlannerOrderIds(context: SchedulerContext): string[] {
  const plannerEligibleOrderIds = new Set(
    [...getCommittedOrders(context.orders), ...getOptionalOrders(context.orders)].map(
      (order) => order.id,
    ),
  );
  const normalizedScheduleOrderIds = normalizeScheduleOrderIds(
    context.orders,
    context.scheduleOrderIds,
  );
  const currentOrderIds = normalizedScheduleOrderIds.filter((orderId) =>
    plannerEligibleOrderIds.has(orderId),
  );

  if (currentOrderIds.length) {
    return currentOrderIds;
  }

  return getCommittedOrders(context.orders).map((order) => order.id);
}

export function buildSchedulerSuggestions(
  context: SchedulerContext,
): SchedulerSuggestionResult {
  const candidateOrderIds = generateScheduleCandidates(
    context.orders,
    context.maxCandidateEvaluations,
  );
  const rankedSuggestions = rankScheduleCandidates(
    candidateOrderIds.orderIds.map((orderIds) =>
      evaluateScheduleCandidate(orderIds, context),
    ),
  );
  const topSuggestionCount =
    context.topSuggestionCount ?? DEFAULT_TOP_SUGGESTION_COUNT;
  const currentOrderIds = getCurrentPlannerOrderIds(context);

  return {
    currentSchedule: currentOrderIds.length
      ? evaluateScheduleCandidate(currentOrderIds, context)
      : null,
    bestSuggestion: rankedSuggestions[0] || null,
    suggestions: rankedSuggestions.slice(0, topSuggestionCount),
    evaluatedCandidateCount: rankedSuggestions.length,
    truncated: candidateOrderIds.truncated,
    warning: candidateOrderIds.truncated
      ? `Candidate search capped at ${
          context.maxCandidateEvaluations ?? MAX_CANDIDATE_EVALUATIONS
        } schedules.`
      : null,
  };
}
