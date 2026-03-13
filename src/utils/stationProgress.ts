import {
  gameState,
  type Order,
  type OrderStationKey,
  type StationNumber,
  type StationTaskState,
} from "./gameState";
import { getScheduledProductionOrders } from "./orders";
import {
  STATION_IDS,
  generateStationProcessingTimes,
  getNearestDistribution,
  getStationTaskDifficulty,
  scaleDistributionByItemCount,
  type NormalDistribution,
  type RawStationTaskTime,
  type Station,
} from "./station";

const STATION_NUMBERS: StationNumber[] = [1, 2, 3];

export interface StationProjection {
  stationNumber: StationNumber;
  durationMs: number;
  expectedStartTime: number | null;
  expectedEndTime: number | null;
  expectedProgress: number;
  actualElapsedMs: number;
  isActive: boolean;
  isPaused: boolean;
  isBlocked: boolean;
  isComplete: boolean;
}

export type StationProjectionMatrix = Record<
  string,
  Partial<Record<StationNumber, StationProjection>>
>;

export function getOrderStationKey(
  stationNumber: StationNumber,
): OrderStationKey {
  return `station${stationNumber}` as OrderStationKey;
}

export function getOrderStationTask(
  order: Order,
  stationNumber: StationNumber,
): StationTaskState | undefined {
  return order.stationTasks?.[getOrderStationKey(stationNumber)];
}

export function getStationActualElapsedMs(
  task: StationTaskState | undefined,
  currentTime: number,
): number {
  if (!task) {
    return 0;
  }

  const accumulated = task.accumulatedActiveMs ?? 0;
  if (!task.activeSince || task.isPaused || task.completedAt) {
    return accumulated;
  }

  return accumulated + Math.max(currentTime - task.activeSince, 0);
}

export function isStationConfirmedComplete(
  order: Order,
  stationNumber: StationNumber,
): boolean {
  if (getOrderStationTask(order, stationNumber)?.completedAt) {
    return true;
  }

  if (stationNumber === 1) {
    return order.progress >= 2;
  }

  if (stationNumber === 2) {
    return order.progress >= 3;
  }

  return order.status === "sent" || order.status === "approved";
}

function getRecordedRawTimes(
  stationNumber: StationNumber,
  orders: Order[],
): RawStationTaskTime[] {
  return orders.flatMap((order) => {
    const task = getOrderStationTask(order, stationNumber);
    if (
      !task?.recordedAt ||
      !task.recordedBatchTimeMs ||
      !task.recordedQuantity ||
      !task.performanceRating
    ) {
      return [];
    }

    return [
      {
        observedTimeTaken: task.recordedBatchTimeMs / 1000,
        numberOfItems: task.recordedQuantity,
        employeePerformance: task.performanceRating,
        taskDifficulty: getStationTaskDifficulty(
          STATION_IDS[stationNumber],
          order,
        ),
      },
    ];
  });
}

function getStationRawTimesWithRecordedSamples(
  station: Station,
  stationNumber: StationNumber,
  orders: Order[],
): RawStationTaskTime[] {
  return [
    ...station.rawStationTaskTimes,
    ...getRecordedRawTimes(stationNumber, orders),
  ];
}

export function getStationDistributionForOrder(
  stationNumber: StationNumber,
  order: Pick<Order, "quantity" | "size" | "verseSize">,
  orders: Order[],
): NormalDistribution {
  const station = gameState.getStationManager().getStation(STATION_IDS[stationNumber]);
  if (!station) {
    return { mean: 0, stdDev: 0 };
  }

  const rawTimes = getStationRawTimesWithRecordedSamples(station, stationNumber, orders);
  const distributions = generateStationProcessingTimes(
    rawTimes,
    gameState.getParameters().standardTimeRatio,
  );
  const taskDifficulty = getStationTaskDifficulty(station.id, order);
  const perItemDistribution =
    getNearestDistribution(distributions, taskDifficulty) ||
    getNearestDistribution(station.sizeDistributions, taskDifficulty) ||
    station.itemProcesingTime;
  const distribution = scaleDistributionByItemCount(
    {
      mean: perItemDistribution.mean / station.speedMultiplier,
      stdDev: perItemDistribution.stdDev / station.speedMultiplier,
    },
    order.quantity,
  );

  return distribution;
}

export function calculateStationSchedule(
  orders: Order[],
  scheduleOrderIds: string[],
  currentTime: number,
): StationProjectionMatrix {
  const scheduledOrders = getScheduledProductionOrders(orders, scheduleOrderIds);
  const projections: StationProjectionMatrix = {};
  const stationAvailableTimes: Record<StationNumber, number> = {
    1: 0,
    2: 0,
    3: 0,
  };

  scheduledOrders.forEach((order) => {
    projections[order.id] = {};

    STATION_NUMBERS.forEach((stationNumber) => {
      const stationDistribution = getStationDistributionForOrder(
        stationNumber,
        order,
        orders,
      );
      const durationMs = Math.max(stationDistribution.mean * 1000, 0);
      const task = getOrderStationTask(order, stationNumber);
      const actualElapsedMs = getStationActualElapsedMs(task, currentTime);
      const actualStartedAt = task?.startedAt ?? null;
      const isPaused = Boolean(task?.isPaused && !task?.completedAt);
      const isActive = Boolean(task?.activeSince && !task?.isPaused && !task?.completedAt);
      const confirmedComplete = isStationConfirmedComplete(order, stationNumber);

      let dependencyReadyTime: number | null;
      if (stationNumber === 1) {
        dependencyReadyTime =
          order.progress === 0 && order.status === "pending_inventory"
            ? null
            : (order.startTime ?? order.orderTime);
      } else {
        const previousStationNumber = (stationNumber - 1) as StationNumber;
        const previousProjection =
          projections[order.id][previousStationNumber];
        dependencyReadyTime = previousProjection?.expectedEndTime ?? null;
      }

      const stationAvailableTime =
        stationAvailableTimes[stationNumber] === Number.POSITIVE_INFINITY
          ? null
          : stationAvailableTimes[stationNumber];

      const baseStartTime =
        dependencyReadyTime === null || stationAvailableTime === null
          ? null
          : Math.max(dependencyReadyTime, stationAvailableTime);

      let expectedStartTime = actualStartedAt ?? baseStartTime;
      let expectedEndTime: number | null = null;
      let expectedProgress = 0;
      let isBlocked = false;

      if (confirmedComplete) {
        expectedEndTime = task?.completedAt ?? currentTime;
        expectedStartTime =
          actualStartedAt ??
          (baseStartTime !== null ? Math.min(baseStartTime, expectedEndTime) : expectedEndTime);
        expectedProgress = 100;
      } else if (actualStartedAt !== null) {
        expectedStartTime = actualStartedAt;
        expectedProgress =
          durationMs > 0
            ? Math.min((actualElapsedMs / durationMs) * 100, 100)
            : 0;

        if (isPaused) {
          expectedEndTime = null;
          isBlocked = true;
        } else {
          const remainingMs = Math.max(durationMs - actualElapsedMs, 0);
          expectedEndTime = currentTime + remainingMs;
        }
      } else if (baseStartTime === null) {
        expectedStartTime = null;
        expectedEndTime = null;
        expectedProgress = 0;
        isBlocked = true;
      } else {
        expectedEndTime = baseStartTime + durationMs;

        if (currentTime <= baseStartTime || durationMs <= 0) {
          expectedProgress = 0;
        } else if (currentTime >= expectedEndTime) {
          expectedProgress = 100;
        } else {
          expectedProgress =
            ((currentTime - baseStartTime) / durationMs) * 100;
        }
      }

      if (expectedEndTime === null) {
        stationAvailableTimes[stationNumber] = Number.POSITIVE_INFINITY;
      } else {
        stationAvailableTimes[stationNumber] = expectedEndTime;
      }

      projections[order.id][stationNumber] = {
        stationNumber,
        durationMs,
        expectedStartTime,
        expectedEndTime,
        expectedProgress: Math.max(0, Math.min(expectedProgress, 100)),
        actualElapsedMs,
        isActive,
        isPaused,
        isBlocked,
        isComplete: confirmedComplete,
      };
    });
  });

  return projections;
}
