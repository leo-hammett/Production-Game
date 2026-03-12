import type { GameParameters, Order, PaperInventory } from "./gameState";
import {
  buildSchedulerSuggestions,
  getCommittedOrders,
  estimateOrderTimeDistribution,
  type RankedScheduleCandidate,
  type SchedulerSuggestionResult,
} from "./strategyPlanner";
import type { Station } from "./station";

const DEFAULT_SIMULATION_RUNS = 32;
const DEFAULT_FORECAST_HORIZON_MS = 8 * 60 * 60 * 1000;
const MIN_ARRIVAL_INTERVAL_MS = 60 * 1000;

type ForecastableParameters = Pick<
  GameParameters,
  | "failureFineRatio"
  | "forecastSpeed"
  | "greedometer"
  | "paperDeliverySeconds"
  | "safetyStock"
  | "workstationSpeed"
>;

export interface ForecastDistribution {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  sampleCount: number;
}

export interface ForecastOrderTemplate {
  quantity: number;
  leadTime: number;
  paperColor: Order["paperColor"];
  size: string;
  verseSize: number;
  occasion: string;
  price: number;
  weight: number;
  baseProfit: number;
  expectedProcessingMs: number;
}

export interface OrderForecastModel {
  generatedAt: number;
  historicalOrderCount: number;
  arrivalIntervalMs: ForecastDistribution;
  baseProfit: ForecastDistribution;
  processingTimeMs: ForecastDistribution;
  templates: ForecastOrderTemplate[];
}

export interface ForecastingContext {
  orders: Order[];
  scheduleOrderIds: string[];
  paperInventory: PaperInventory;
  parameters: ForecastableParameters;
  stations: Station[];
  currentTime: number;
  calculatePaperCurrentWorth: (paperColor: Order["paperColor"]) => number;
}

export interface ForecastingOptions {
  horizonMs?: number;
  simulationRuns?: number;
  randomSeed?: number;
}

export interface ForecastScenarioResult {
  expectedFutureProfit: number;
  acceptedOrders: Order[];
  skippedOrders: Order[];
  completedOrders: Order[];
  failedOrders: Order[];
  generatedOrders: Order[];
  horizonEndTime: number;
}

export interface AcceptanceComparisonResult {
  acceptExpectedProfit: number;
  skipExpectedProfit: number;
  deltaExpectedProfit: number;
  model: OrderForecastModel;
  simulationRuns: number;
}

export interface PlanForecastResult {
  immediateExpectedProfit: number;
  expectedContinuationProfit: number;
  expectedTotalProfit: number;
  simulationRuns: number;
  horizonMs: number;
}

interface ScenarioPolicyContext {
  candidateOrder: Order;
  queueOrders: Order[];
  forecastingContext: ForecastingContext;
  horizonEndTime: number;
  currentTime: number;
}

export type ForecastAcceptancePolicy = (
  context: ScenarioPolicyContext,
) => boolean;

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDistribution(samples: number[], fallback: number): ForecastDistribution {
  const usableSamples = samples.length ? samples : [fallback];
  const mean =
    usableSamples.reduce((sum, sample) => sum + sample, 0) / usableSamples.length;
  const variance =
    usableSamples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) /
    usableSamples.length;

  return {
    mean,
    stdDev: Math.sqrt(variance),
    min: Math.min(...usableSamples),
    max: Math.max(...usableSamples),
    sampleCount: usableSamples.length,
  };
}

function getHistoricalOrders(orders: Order[]): Order[] {
  return orders
    .filter(
      (order) =>
        order.status !== "deleted" &&
        order.status !== "other",
    )
    .sort((left, right) => left.orderTime - right.orderTime);
}

function getForecastSpeed(parameters: ForecastableParameters): number {
  return Math.max(
    0.1,
    parameters.workstationSpeed * (parameters.forecastSpeed || 1),
  );
}

function calculateBaseProfit(
  order: Order,
  calculatePaperCurrentWorth: ForecastingContext["calculatePaperCurrentWorth"],
): number {
  return (
    order.price - order.quantity * calculatePaperCurrentWorth(order.paperColor)
  );
}

function buildTemplateWeight(
  order: Order,
  baseProfit: number,
  historicalOrders: Order[],
  greedometer: number,
): number {
  const normalizedGreed = clamp(greedometer, -1, 1);
  const latestOrderTime =
    historicalOrders[historicalOrders.length - 1]?.orderTime || order.orderTime;
  const earliestOrderTime = historicalOrders[0]?.orderTime || order.orderTime;
  const timeRange = Math.max(1, latestOrderTime - earliestOrderTime);
  const recencyFactor =
    0.75 + 0.25 * ((order.orderTime - earliestOrderTime) / timeRange);
  const profitScale = Math.max(1, Math.abs(baseProfit));
  const greedFactor = 1 + normalizedGreed * (baseProfit / profitScale) * 0.3;

  return Math.max(0.1, recencyFactor * greedFactor);
}

function sampleOne<T>(
  items: T[],
  random: () => number,
  getWeight?: (item: T) => number,
): T {
  if (items.length === 0) {
    throw new Error("Cannot sample from empty collection");
  }

  if (!getWeight) {
    return items[Math.floor(random() * items.length)];
  }

  const totalWeight = items.reduce((sum, item) => sum + getWeight(item), 0);
  if (totalWeight <= 0) {
    return items[Math.floor(random() * items.length)];
  }

  let threshold = random() * totalWeight;
  for (const item of items) {
    threshold -= getWeight(item);
    if (threshold <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
}

export function buildOrderForecastModel(
  context: ForecastingContext,
): OrderForecastModel {
  const historicalOrders = getHistoricalOrders(context.orders);
  const arrivalIntervals = historicalOrders
    .slice(1)
    .map((order, index) => order.orderTime - historicalOrders[index].orderTime)
    .filter((interval) => interval > 0);
  const processingMsSamples = historicalOrders.map(
    (order) =>
      estimateOrderTimeDistribution(
        order,
        context.stations,
        getForecastSpeed(context.parameters),
      ).mean,
  );
  const baseProfitSamples = historicalOrders.map((order) =>
    calculateBaseProfit(order, context.calculatePaperCurrentWorth),
  );

  const templates = historicalOrders.map((order, index) => {
    const baseProfit = baseProfitSamples[index] ?? 0;
    return {
      quantity: order.quantity,
      leadTime: order.leadTime,
      paperColor: order.paperColor,
      size: order.size,
      verseSize: order.verseSize,
      occasion: order.occasion,
      price: order.price,
      weight: buildTemplateWeight(
        order,
        baseProfit,
        historicalOrders,
        context.parameters.greedometer,
      ),
      baseProfit,
      expectedProcessingMs: processingMsSamples[index] ?? 0,
    };
  });

  return {
    generatedAt: context.currentTime,
    historicalOrderCount: historicalOrders.length,
    arrivalIntervalMs: toDistribution(
      arrivalIntervals,
      30 * 60 * 1000,
    ),
    baseProfit: toDistribution(baseProfitSamples, 0),
    processingTimeMs: toDistribution(processingMsSamples, 10 * 60 * 1000),
    templates,
  };
}

export function generateForecastOrders(
  model: OrderForecastModel,
  context: ForecastingContext,
  options: ForecastingOptions = {},
): Order[] {
  const horizonMs = options.horizonMs ?? DEFAULT_FORECAST_HORIZON_MS;
  const random = createMulberry32(options.randomSeed ?? 1);
  const result: Order[] = [];
  const horizonEndTime = context.currentTime + horizonMs;

  if (!model.templates.length) {
    return result;
  }

  let nextOrderTime = context.currentTime;
  let orderIndex = 0;

  while (nextOrderTime < horizonEndTime) {
    const sampledInterval =
      sampleOne(
        [model.arrivalIntervalMs.min, model.arrivalIntervalMs.mean, model.arrivalIntervalMs.max],
        random,
      ) || model.arrivalIntervalMs.mean;
    const nextIntervalMs = Math.max(MIN_ARRIVAL_INTERVAL_MS, sampledInterval);
    nextOrderTime += nextIntervalMs;

    if (nextOrderTime > horizonEndTime) {
      break;
    }

    const template = sampleOne(
      model.templates,
      random,
      (candidateTemplate) => candidateTemplate.weight,
    );
    result.push({
      id: `forecast-${options.randomSeed ?? 1}-${orderIndex}`,
      orderTime: nextOrderTime,
      quantity: template.quantity,
      leadTime: template.leadTime,
      paperColor: template.paperColor,
      size: template.size,
      verseSize: template.verseSize,
      occasion: template.occasion,
      price: template.price,
      available: true,
      status: "passive",
      progress: 0,
    });
    orderIndex += 1;
  }

  return result;
}

function getDueTime(order: Order): number {
  if (order.dueTime !== undefined) {
    return order.dueTime;
  }

  if (order.leadTime < 0) {
    return Number.POSITIVE_INFINITY;
  }

  return order.orderTime + order.leadTime * 60 * 1000;
}

function getCommittedQueue(
  context: ForecastingContext,
): Order[] {
  return getCommittedOrders(context.orders).map((order) => ({
    ...order,
    status: "ordered",
  }));
}

function cloneQueueOrders(queueOrders: Order[]): Order[] {
  return queueOrders.map((order) => ({ ...order }));
}

function getScheduleSnapshot(
  queueOrders: Order[],
  context: ForecastingContext,
  currentTime: number,
): SchedulerSuggestionResult {
  return buildSchedulerSuggestions({
    orders: queueOrders,
    scheduleOrderIds: queueOrders.map((order) => order.id),
    paperInventory: context.paperInventory,
    parameters: {
      safetyStock: context.parameters.safetyStock,
      failureFineRatio: context.parameters.failureFineRatio,
      paperDeliverySeconds: context.parameters.paperDeliverySeconds,
      workstationSpeed: getForecastSpeed(context.parameters),
    },
    stations: context.stations,
    currentTime,
    calculatePaperCurrentWorth: context.calculatePaperCurrentWorth,
    maxCandidateEvaluations: 10_000,
    topSuggestionCount: 3,
  });
}

export const defaultForecastAcceptancePolicy: ForecastAcceptancePolicy = ({
  candidateOrder,
  queueOrders,
  forecastingContext,
  currentTime,
}) => {
  const currentPlan = getScheduleSnapshot(queueOrders, forecastingContext, currentTime);
  const nextPlan = getScheduleSnapshot(
    [...queueOrders, { ...candidateOrder, status: "ordered", available: true }],
    forecastingContext,
    currentTime,
  );
  const currentRate = currentPlan.bestSuggestion?.profitPerSecond ?? 0;
  const nextRate = nextPlan.bestSuggestion?.profitPerSecond ?? 0;
  const currentProfit = currentPlan.bestSuggestion?.expectedProfit ?? 0;
  const nextProfit = nextPlan.bestSuggestion?.expectedProfit ?? 0;
  const greedTolerance = Math.max(0, clamp(forecastingContext.parameters.greedometer, -1, 1)) * 0.05;

  return (
    nextProfit >= currentProfit &&
    nextRate >= currentRate - Math.max(0.01, Math.abs(currentRate) * greedTolerance)
  );
};

function settleOrderProfit(
  order: Order,
  completionTime: number,
  calculatePaperCurrentWorth: ForecastingContext["calculatePaperCurrentWorth"],
  failureFineRatio: number,
): number {
  const dueTime = getDueTime(order);
  const baseProfit = calculateBaseProfit(order, calculatePaperCurrentWorth);

  if (completionTime <= dueTime) {
    return baseProfit;
  }

  return -(order.price * failureFineRatio);
}

function simulateScenario(
  context: ForecastingContext,
  futureOrders: Order[],
  options: ForecastingOptions,
  policy: ForecastAcceptancePolicy,
  forcedDecision?: { orderId: string; accept: boolean },
  initialQueueOrders?: Order[],
): ForecastScenarioResult {
  const horizonMs = options.horizonMs ?? DEFAULT_FORECAST_HORIZON_MS;
  const horizonEndTime = context.currentTime + horizonMs;
  const queueOrders = initialQueueOrders
    ? cloneQueueOrders(initialQueueOrders)
    : getCommittedQueue(context);
  const acceptedOrders = [...queueOrders];
  const skippedOrders: Order[] = [];
  const completedOrders: Order[] = [];
  const failedOrders: Order[] = [];
  let now = context.currentTime;
  let expectedFutureProfit = 0;

  const advanceQueueTo = (targetTime: number) => {
    while (queueOrders.length > 0) {
      const scheduleSnapshot = getScheduleSnapshot(queueOrders, context, now);
      const nextOrderId =
        scheduleSnapshot.bestSuggestion?.orderIds[0] || queueOrders[0]?.id;
      const nextOrderIndex = queueOrders.findIndex(
        (order) => order.id === nextOrderId,
      );
      const nextOrder =
        nextOrderIndex >= 0 ? queueOrders[nextOrderIndex] : queueOrders[0];

      if (!nextOrder) {
        break;
      }

      const durationMs = estimateOrderTimeDistribution(
        nextOrder,
        context.stations,
        getForecastSpeed(context.parameters),
      ).mean;

      if (now + durationMs > targetTime) {
        break;
      }

      now += durationMs;
      queueOrders.splice(nextOrderIndex >= 0 ? nextOrderIndex : 0, 1);
      const realizedProfit = settleOrderProfit(
        nextOrder,
        now,
        context.calculatePaperCurrentWorth,
        context.parameters.failureFineRatio,
      );
      expectedFutureProfit += realizedProfit;

      if (realizedProfit >= 0) {
        completedOrders.push(nextOrder);
      } else {
        failedOrders.push(nextOrder);
      }
    }

    now = targetTime;
  };

  const orderedFutureOrders = [...futureOrders].sort(
    (left, right) => left.orderTime - right.orderTime,
  );

  for (const futureOrder of orderedFutureOrders) {
    advanceQueueTo(futureOrder.orderTime);
    if (futureOrder.orderTime > horizonEndTime) {
      break;
    }

    const committedOrder = {
      ...futureOrder,
      status: "ordered" as const,
      available: true,
    };
    const acceptOrder =
      forcedDecision && forcedDecision.orderId === futureOrder.id
        ? forcedDecision.accept
        : policy({
            candidateOrder: futureOrder,
            queueOrders: [...queueOrders],
            forecastingContext: context,
            horizonEndTime,
            currentTime: now,
          });

    if (acceptOrder) {
      queueOrders.push(committedOrder);
      acceptedOrders.push(committedOrder);
    } else {
      skippedOrders.push(futureOrder);
    }
  }

  advanceQueueTo(horizonEndTime);

  return {
    expectedFutureProfit,
    acceptedOrders,
    skippedOrders,
    completedOrders,
    failedOrders,
    generatedOrders: orderedFutureOrders,
    horizonEndTime,
  };
}

export function simulateForecastProfit(
  context: ForecastingContext,
  options: ForecastingOptions = {},
  policy: ForecastAcceptancePolicy = defaultForecastAcceptancePolicy,
): ForecastScenarioResult {
  const model = buildOrderForecastModel(context);
  const forecastOrders = generateForecastOrders(model, context, {
    ...options,
    randomSeed: options.randomSeed ?? 1,
  });

  return simulateScenario(context, forecastOrders, options, policy);
}

export function estimatePlanTotalProfit(
  context: ForecastingContext,
  plan: RankedScheduleCandidate | null,
  options: ForecastingOptions = {},
  policy: ForecastAcceptancePolicy = defaultForecastAcceptancePolicy,
): PlanForecastResult | null {
  if (!plan) {
    return null;
  }

  const horizonMs = options.horizonMs ?? DEFAULT_FORECAST_HORIZON_MS;
  const simulationRuns = options.simulationRuns ?? DEFAULT_SIMULATION_RUNS;
  const planEndTime = context.currentTime + plan.expectedBusyMs;
  let expectedContinuationProfit = 0;

  for (let run = 0; run < simulationRuns; run += 1) {
    const runSeed = (options.randomSeed ?? 1) + run;
    const continuationContext: ForecastingContext = {
      ...context,
      currentTime: planEndTime,
    };
    const model = buildOrderForecastModel(continuationContext);
    const generatedOrders = generateForecastOrders(model, continuationContext, {
      ...options,
      randomSeed: runSeed,
      horizonMs,
    });
    const continuationResult = simulateScenario(
      continuationContext,
      generatedOrders,
      {
        ...options,
        horizonMs,
      },
      policy,
      undefined,
      [],
    );
    expectedContinuationProfit += continuationResult.expectedFutureProfit;
  }

  expectedContinuationProfit /= simulationRuns;

  return {
    immediateExpectedProfit: plan.expectedProfit,
    expectedContinuationProfit,
    expectedTotalProfit: plan.expectedProfit + expectedContinuationProfit,
    simulationRuns,
    horizonMs,
  };
}

export function compareOrderAcceptanceValue(
  context: ForecastingContext,
  candidateOrder: Order,
  options: ForecastingOptions = {},
  policy: ForecastAcceptancePolicy = defaultForecastAcceptancePolicy,
): AcceptanceComparisonResult {
  const model = buildOrderForecastModel(context);
  const simulationRuns = options.simulationRuns ?? DEFAULT_SIMULATION_RUNS;
  let acceptExpectedProfit = 0;
  let skipExpectedProfit = 0;

  for (let run = 0; run < simulationRuns; run += 1) {
    const runSeed = (options.randomSeed ?? 1) + run;
    const generatedOrders = generateForecastOrders(model, context, {
      ...options,
      randomSeed: runSeed,
    });
    const immediateCandidateOrder = {
      ...candidateOrder,
      id: `candidate-${run}`,
      orderTime: Math.max(context.currentTime, candidateOrder.orderTime),
    };
    const scenarioOrders = [immediateCandidateOrder, ...generatedOrders].sort(
      (left, right) => left.orderTime - right.orderTime,
    );

    const acceptScenario = simulateScenario(
      context,
      scenarioOrders,
      options,
      policy,
      {
        orderId: immediateCandidateOrder.id,
        accept: true,
      },
    );
    const skipScenario = simulateScenario(
      context,
      scenarioOrders,
      options,
      policy,
      {
        orderId: immediateCandidateOrder.id,
        accept: false,
      },
    );

    acceptExpectedProfit += acceptScenario.expectedFutureProfit;
    skipExpectedProfit += skipScenario.expectedFutureProfit;
  }

  acceptExpectedProfit /= simulationRuns;
  skipExpectedProfit /= simulationRuns;

  return {
    acceptExpectedProfit,
    skipExpectedProfit,
    deltaExpectedProfit: acceptExpectedProfit - skipExpectedProfit,
    model,
    simulationRuns,
  };
}
