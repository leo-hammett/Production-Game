import { useEffect, useRef, useState } from "react";
import { ProductionSchedule } from "./ProductionSchedule";
import {
  gameState,
  type Order,
  type PaperInventory,
  type StationNumber,
} from "../utils/gameState";
import {
  allocatePaperForOrderIfNeeded,
  getScheduledProductionOrders,
} from "../utils/orders";
import { STATION_IDS, type StationSpeedMultipliers } from "../utils/station";
import {
  calculateStationSchedule,
  getOrderStationKey,
  getOrderStationTask,
  getStationActualElapsedMs,
  getStationDistributionForOrder,
} from "../utils/stationProgress";
import { getVerseText } from "../utils/verses";

interface StationViewProps {
  stationNumber: number;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  updateOrderField: (id: string, field: keyof Order, value: unknown) => void;
  scheduleOrderIds: string[];
  currentTime: number;
  paperInventory: PaperInventory;
  setPaperInventory: React.Dispatch<React.SetStateAction<PaperInventory>>;
  stationSpeedMultipliers: StationSpeedMultipliers;
  updateStationSpeedMultiplier: (
    stationKey: keyof StationSpeedMultipliers,
    nextValue: number,
  ) => void;
}

interface CompletedTaskSummary {
  orderId: string;
  quantity: number;
  timeTakenMs: number;
  performanceRating: number;
  recordedAt?: number;
}

const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 130;
const GRAPH_P5_X = GRAPH_WIDTH / 6;
const GRAPH_MEAN_X = GRAPH_WIDTH / 2;
const GRAPH_P95_X = (GRAPH_WIDTH * 5) / 6;

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "--:--";
  }

  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatClockTime(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "--";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getPerformanceLabel(performanceRating: number): string {
  if (performanceRating < 0.9) {
    return "Low / slow";
  }
  if (performanceRating > 1.1) {
    return "High / fast";
  }
  return "Normal";
}

function buildNormalCurvePath(mean: number, stdDev: number): string {
  const safeStdDev = Math.max(stdDev, mean * 0.05, 0.01);
  const minX = Math.max(mean - safeStdDev * 3, 0);
  const maxX = mean + safeStdDev * 3;
  const steps = 36;

  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const x = minX + ((maxX - minX) * index) / steps;
    const normalized = (x - mean) / safeStdDev;
    const density = Math.exp(-0.5 * normalized * normalized);
    return {
      x: (index / steps) * GRAPH_WIDTH,
      y: GRAPH_HEIGHT - density * (GRAPH_HEIGHT - 22),
    };
  });

  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
}

export function StationView({
  stationNumber,
  orders,
  setOrders,
  updateOrderField,
  scheduleOrderIds,
  currentTime,
  paperInventory,
  setPaperInventory,
  stationSpeedMultipliers,
  updateStationSpeedMultiplier,
}: StationViewProps) {
  const stationIndex = stationNumber as StationNumber;
  const stationKey = `station${stationNumber}` as keyof StationSpeedMultipliers;
  const orderStationKey = getOrderStationKey(stationIndex);
  const requiredProgress = stationNumber;
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [completedTask, setCompletedTask] = useState<CompletedTaskSummary | null>(
    null,
  );
  const [leftPaneWidth, setLeftPaneWidth] = useState(70);
  const [isDragging, setIsDragging] = useState(false);
  const [groupOrders, setGroupOrders] = useState(true);
  const dividerRef = useRef<HTMLDivElement>(null);

  const scheduledOrders = getScheduledProductionOrders(orders, scheduleOrderIds);
  
  // All available orders (no progress filtering)
  const allAvailableOrders = scheduledOrders.filter(
    (order) =>
      order.status !== "pending_inventory" &&
      order.status !== "sent" &&
      order.status !== "approved" &&
      order.status !== "failed",
  );

  // Categorize orders for grouped view
  const todoOrders = allAvailableOrders.filter(order => 
    order.progress === requiredProgress && 
    !getOrderStationTask(order, stationIndex)?.startedAt
  );
  
  const pendingOrders = allAvailableOrders.filter(order => 
    order.progress < requiredProgress
  );
  
  const completedOrders = allAvailableOrders.filter(order => 
    getOrderStationTask(order, stationIndex)?.completedAt
  );

  // Choose display based on toggle
  const stationQueue = groupOrders 
    ? [...todoOrders, ...pendingOrders, ...completedOrders]
    : allAvailableOrders.sort((a, b) => {
        // Sort by schedule priority if available
        const aIndex = scheduleOrderIds.indexOf(a.id);
        const bIndex = scheduleOrderIds.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
  const stationSchedule = calculateStationSchedule(
    orders,
    scheduleOrderIds,
    currentTime,
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const newWidth = (event.clientX / window.innerWidth) * 100;
      if (newWidth >= 20 && newWidth <= 80) {
        setLeftPaneWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  const resolvedCurrentOrderId =
    currentOrderId && stationQueue.some((order) => order.id === currentOrderId)
      ? currentOrderId
      : stationQueue[0]?.id ?? null;
  const currentOrder = orders.find((order) => order.id === resolvedCurrentOrderId);
  const currentTask = currentOrder
    ? getOrderStationTask(currentOrder, stationIndex)
    : undefined;
  const currentProjection = currentOrder
    ? stationSchedule[currentOrder.id]?.[stationIndex]
    : undefined;
  const stationSpeed = stationSpeedMultipliers[stationKey] ?? 1;
  const displayedVerse = currentOrder
    ? currentOrder.selectedVerse ||
      getVerseText(currentOrder.occasion, currentOrder.verseSize)
    : undefined;
  const pipelineProgressPercent =
    currentOrder && currentOrder.progress > 0
      ? Math.min((currentOrder.progress / 3) * 100, 100)
      : 0;
  const currentElapsedMs = getStationActualElapsedMs(currentTask, currentTime);
  const canStart = Boolean(
    currentOrder && !currentTask?.startedAt && !currentTask?.completedAt,
  );
  const canTogglePause = Boolean(
    currentOrder && currentTask?.startedAt && !currentTask?.completedAt,
  );
  const canFinish = Boolean(
    currentOrder && currentTask?.startedAt && !currentTask?.completedAt,
  );
  const selectedOrderForStats =
    currentOrder || stationQueue[0] || scheduledOrders[0] || null;
  const stationDistribution = selectedOrderForStats
    ? getStationDistributionForOrder(stationIndex, selectedOrderForStats, orders)
    : { mean: 0, stdDev: 0 };
  const stationDefinition = gameState
    .getStationManager()
    .getStation(STATION_IDS[stationIndex]);
  const recordedSampleCount = orders.filter(
    (order) => getOrderStationTask(order, stationIndex)?.recordedAt,
  ).length;
  const completedTaskCount = orders.filter(
    (order) => getOrderStationTask(order, stationIndex)?.completedAt,
  ).length;
  const totalSampleCount =
    (stationDefinition?.rawStationTaskTimes.length ?? 0) + recordedSampleCount;
  const variance = stationDistribution.stdDev * stationDistribution.stdDev;
  const percentile05 = Math.max(
    stationDistribution.mean - stationDistribution.stdDev * 1.645,
    0,
  );
  const percentile95 =
    stationDistribution.mean + stationDistribution.stdDev * 1.645;
  const curvePath = buildNormalCurvePath(
    stationDistribution.mean,
    stationDistribution.stdDev,
  );

  const updateSelectedOrder = (updater: (order: Order) => Order) => {
    if (!currentOrder) {
      return;
    }

    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        order.id === currentOrder.id ? updater(order) : order,
      ),
    );
  };

  const applyStatusWithPaperAllocation = (
    order: Order,
    nextStatus: Order["status"],
  ): Order => {
    const allocationResult = allocatePaperForOrderIfNeeded(
      order,
      nextStatus,
      paperInventory,
    );

    if (allocationResult.allocatedNow) {
      setPaperInventory(allocationResult.paperInventory);
    }

    return {
      ...allocationResult.order,
      status: nextStatus,
    };
  };

  const handleStartJob = () => {
    if (!currentOrder) {
      return;
    }

    updateSelectedOrder((order) => {
      const existingTask = order.stationTasks?.[orderStationKey];
      if (existingTask?.completedAt || existingTask?.startedAt) {
        return order;
      }

      const nextStartTime = order.startTime ?? currentTime;
      const nextDueTime =
        order.dueTime ??
        (order.leadTime > 0
          ? nextStartTime + order.leadTime * 60 * 1000
          : undefined);

      return {
        ...applyStatusWithPaperAllocation(order, "WIP"),
        startTime: nextStartTime,
        dueTime: nextDueTime,
        stationTasks: {
          ...order.stationTasks,
          [orderStationKey]: {
            ...existingTask,
            startedAt: existingTask?.startedAt ?? currentTime,
            activeSince: currentTime,
            accumulatedActiveMs: existingTask?.accumulatedActiveMs ?? 0,
            isPaused: false,
            pausedAt: undefined,
          },
        },
      };
    });
  };

  const handlePauseToggle = () => {
    if (!currentOrder) {
      return;
    }

    updateSelectedOrder((order) => {
      const existingTask = order.stationTasks?.[orderStationKey];
      if (!existingTask?.startedAt || existingTask.completedAt) {
        return order;
      }

      if (existingTask.isPaused || !existingTask.activeSince) {
        return {
          ...applyStatusWithPaperAllocation(order, "WIP"),
          stationTasks: {
            ...order.stationTasks,
            [orderStationKey]: {
              ...existingTask,
              activeSince: currentTime,
              isPaused: false,
              pausedAt: undefined,
            },
          },
        };
      }

      const accumulatedActiveMs =
        (existingTask.accumulatedActiveMs ?? 0) +
        Math.max(currentTime - existingTask.activeSince, 0);

      return {
        ...applyStatusWithPaperAllocation(order, "WIP"),
        stationTasks: {
          ...order.stationTasks,
          [orderStationKey]: {
            ...existingTask,
            accumulatedActiveMs,
            activeSince: undefined,
            isPaused: true,
            pausedAt: currentTime,
          },
        },
      };
    });
  };

  const handleFinishJob = () => {
    if (!currentOrder) {
      return;
    }

    const timeTakenMs = currentElapsedMs;
    const performanceRating =
      currentTask?.performanceRating ?? completedTask?.performanceRating ?? 1;

    updateSelectedOrder((order) => {
      const existingTask = order.stationTasks?.[orderStationKey];
      const accumulatedActiveMs = getStationActualElapsedMs(existingTask, currentTime);

      return {
        ...applyStatusWithPaperAllocation(
          order,
          stationIndex === 3 ? "sent" : "ordered",
        ),
        progress: stationIndex === 3 ? 3 : stationIndex + 1,
        stationTasks: {
          ...order.stationTasks,
          [orderStationKey]: {
            ...existingTask,
            startedAt: existingTask?.startedAt ?? currentTime,
            accumulatedActiveMs,
            activeSince: undefined,
            isPaused: false,
            pausedAt: undefined,
            completedAt: currentTime,
            performanceRating,
          },
        },
      };
    });

    setCompletedTask({
      orderId: currentOrder.id,
      quantity: currentOrder.quantity,
      timeTakenMs,
      performanceRating,
      recordedAt: currentTask?.recordedAt,
    });
  };

  const handleRecordTime = () => {
    if (!completedTask || completedTask.recordedAt) {
      return;
    }

    setOrders((currentOrders) =>
      currentOrders.map((order) => {
        if (order.id !== completedTask.orderId) {
          return order;
        }

        const existingTask = order.stationTasks?.[orderStationKey];
        return {
          ...order,
          stationTasks: {
            ...order.stationTasks,
            [orderStationKey]: {
              ...existingTask,
              performanceRating: completedTask.performanceRating,
              recordedAt: currentTime,
              recordedBatchTimeMs: completedTask.timeTakenMs,
              recordedQuantity: completedTask.quantity,
            },
          },
        };
      }),
    );

    setCompletedTask((currentSummary) =>
      currentSummary
        ? {
            ...currentSummary,
            recordedAt: currentTime,
          }
        : currentSummary,
    );
  };

  return (
    <div className="flex relative h-full">
      <div
        className="bg-white border-r border-gray-300 overflow-y-auto"
        style={{ width: `${leftPaneWidth}%` }}
      >
        <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-sm">
          <div className="flex justify-between items-center">
            <h2
              className={`text-xl font-bold ${
                stationNumber === 1
                  ? "text-blue-800"
                  : stationNumber === 2
                    ? "text-green-800"
                    : "text-purple-800"
              }`}
            >
              Station {stationNumber}
            </h2>
            <div className="flex gap-2">
              <span
                className={`px-2 py-1 rounded text-sm font-medium ${
                  stationNumber === 1
                    ? "bg-blue-100 text-blue-700"
                    : stationNumber === 2
                      ? "bg-green-100 text-green-700"
                      : "bg-purple-100 text-purple-700"
                }`}
              >
                Online
              </span>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                Speed: {stationSpeed.toFixed(2)}x
              </span>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Active Timer
                </div>
                <div className="text-3xl font-black text-gray-900">
                  {formatDuration(currentElapsedMs)}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleStartJob}
                  disabled={!canStart}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium disabled:cursor-not-allowed disabled:bg-green-300"
                >
                  Start Job
                </button>
                <button
                  onClick={handlePauseToggle}
                  disabled={!canTogglePause}
                  className="px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm font-medium disabled:cursor-not-allowed disabled:bg-yellow-300"
                >
                  {currentTask?.isPaused ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={handleFinishJob}
                  disabled={!canFinish}
                  className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  Finish Job
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-700 mb-3">Current Job</h3>
            <div className="bg-gray-50 rounded p-4 space-y-3">
              {currentOrder ? (
                <>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Order ID:</span>
                    <span className="font-bold text-lg">
                      #{currentOrder.id.slice(-6)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Quantity:</span>
                    <span className="font-bold text-lg">
                      {currentOrder.quantity} cards
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Sheet Size:</span>
                    <span className="font-bold text-lg">{currentOrder.size}</span>
                  </div>
                  <div className="flex justify-between text-base items-center">
                    <span className="text-gray-600 font-medium">Paper Color:</span>
                    <span
                      className={`font-bold px-3 py-1 rounded text-base ${currentOrder.paperColor.cssClass}`}
                    >
                      {currentOrder.paperColor.name}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Occasion:</span>
                    <span className="font-bold text-lg">
                      {currentOrder.occasion}
                    </span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-600 font-medium">Team ID:</span>
                    <span className="font-bold text-lg">
                      {gameState.getTeamId()}
                    </span>
                  </div>
                  <div className="rounded-xl border-2 border-gray-200 bg-white px-6 py-5 shadow-sm">
                    <div className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">
                      Verse
                    </div>
                    <p className="min-h-[10vh] whitespace-pre-line text-[clamp(1.375rem,3vw,3rem)] font-black leading-[0.92] tracking-[-0.02em] text-gray-900">
                      {displayedVerse || `No verse for ${currentOrder.occasion}`}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <span>Pipeline</span>
                      <span>{pipelineProgressPercent.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${pipelineProgressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <span>Station Expected</span>
                      <span>
                        {(currentProjection?.expectedProgress ?? 0).toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          currentProjection?.isPaused
                            ? "bg-yellow-500"
                            : currentProjection?.isBlocked
                              ? "bg-gray-400"
                              : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${currentProjection?.expectedProgress ?? 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-lg text-gray-500 font-medium">
                    No job selected
                  </p>
                  <p className="text-base text-gray-400 mt-2">
                    The top priority scheduled job will appear here automatically
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Job Queue</h3>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={groupOrders}
                  onChange={(e) => setGroupOrders(e.target.checked)}
                  className="w-3 h-3"
                />
                Group Orders
              </label>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="space-y-2">
                {groupOrders ? (
                  // Grouped view with categories
                  <>
                    {todoOrders.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1 px-1">TODO</div>
                        {todoOrders.slice(0, 5).map((order, index) => (
                          <div
                            key={order.id}
                            onClick={() => setCurrentOrderId(order.id)}
                            className={`flex justify-between items-center p-2 bg-white rounded border hover:border-blue-400 cursor-pointer ${
                              resolvedCurrentOrderId === order.id
                                ? "border-blue-500 ring-1 ring-blue-300"
                                : ""
                            }`}
                          >
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                Order #{order.id.slice(-6)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {order.quantity}x {order.size} - {order.occasion}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Ready</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {pendingOrders.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1 px-1">PENDING</div>
                        {pendingOrders.slice(0, 5).map((order, index) => (
                          <div
                            key={order.id}
                            onClick={() => setCurrentOrderId(order.id)}
                            className={`flex justify-between items-center p-2 bg-amber-50 rounded border hover:border-blue-400 cursor-pointer ${
                              resolvedCurrentOrderId === order.id
                                ? "border-blue-500 ring-1 ring-blue-300"
                                : ""
                            }`}
                          >
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                Order #{order.id.slice(-6)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {order.quantity}x {order.size} - {order.occasion}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Waiting</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {completedOrders.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1 px-1">COMPLETED</div>
                        {completedOrders.slice(0, 5).map((order, index) => (
                          <div
                            key={order.id}
                            onClick={() => setCurrentOrderId(order.id)}
                            className={`flex justify-between items-center p-2 bg-green-50 rounded border hover:border-blue-400 cursor-pointer ${
                              resolvedCurrentOrderId === order.id
                                ? "border-blue-500 ring-1 ring-blue-300"
                                : ""
                            }`}
                          >
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                Order #{order.id.slice(-6)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {order.quantity}x {order.size} - {order.occasion}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Done</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {todoOrders.length === 0 && pendingOrders.length === 0 && completedOrders.length === 0 && (
                      <div className="text-sm text-gray-500 text-center py-4">
                        No orders available
                      </div>
                    )}
                  </>
                ) : (
                  // Priority view - show all orders by priority
                  <>
                    {stationQueue.slice(0, 10).map((order, index) => (
                      <div
                        key={order.id}
                        onClick={() => setCurrentOrderId(order.id)}
                        className={`flex justify-between items-center p-2 bg-white rounded border hover:border-blue-400 cursor-pointer ${
                          resolvedCurrentOrderId === order.id
                            ? "border-blue-500 ring-1 ring-blue-300"
                            : ""
                        }`}
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            Order #{order.id.slice(-6)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {order.quantity}x {order.size} - {order.occasion}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Priority</div>
                          <div className="text-sm font-medium">{index + 1}</div>
                        </div>
                      </div>
                    ))}
                    {stationQueue.length === 0 && (
                      <div className="text-sm text-gray-500 text-center py-4">
                        No jobs in queue
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Station Snapshot
            </h3>
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Mean Batch Time
                </div>
                <div className="text-xl font-black text-gray-900">
                  {selectedOrderForStats
                    ? formatDuration(
                        stationDistribution.mean *
                          selectedOrderForStats.quantity *
                          1000,
                      )
                    : "--:--"}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Expected Finish
                </div>
                <div className="text-sm font-semibold text-gray-800">
                  {currentProjection?.expectedEndTime === null
                    ? "Blocked"
                    : formatClockTime(currentProjection?.expectedEndTime)}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  State
                </div>
                <div className="text-sm font-semibold text-gray-800">
                  {currentTask?.completedAt
                    ? "Completed"
                    : currentTask?.isPaused
                      ? "Paused"
                      : currentTask?.activeSince
                        ? "Working"
                        : "Ready"}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Station Distribution
            </h3>
            <div className="bg-gray-50 rounded p-3 space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <svg
                  viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                  className="w-full h-44"
                >
                  <text
                    x={GRAPH_MEAN_X}
                    y="14"
                    textAnchor="middle"
                    className="fill-gray-500 text-[9px] font-semibold uppercase tracking-wide"
                  >
                    One-item processing time distribution
                  </text>
                  <path
                    d={curvePath}
                    fill="none"
                    stroke={stationNumber === 1 ? "#2563eb" : stationNumber === 2 ? "#16a34a" : "#9333ea"}
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <line
                    x1={GRAPH_P5_X}
                    y1="6"
                    x2={GRAPH_P5_X}
                    y2={GRAPH_HEIGHT - 6}
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={GRAPH_MEAN_X}
                    y1="6"
                    x2={GRAPH_MEAN_X}
                    y2={GRAPH_HEIGHT - 6}
                    stroke="#0f172a"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={GRAPH_P95_X}
                    y1="6"
                    x2={GRAPH_P95_X}
                    y2={GRAPH_HEIGHT - 6}
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={GRAPH_P5_X}
                    y="120"
                    textAnchor="middle"
                    className="fill-gray-500 text-[9px] font-semibold"
                  >
                    5% {percentile05.toFixed(1)}s
                  </text>
                  <text
                    x={GRAPH_MEAN_X}
                    y="120"
                    textAnchor="middle"
                    className="fill-slate-900 text-[9px] font-semibold"
                  >
                    Mean {stationDistribution.mean.toFixed(1)}s
                  </text>
                  <text
                    x={GRAPH_P95_X}
                    y="120"
                    textAnchor="middle"
                    className="fill-gray-500 text-[9px] font-semibold"
                  >
                    95% {percentile95.toFixed(1)}s
                  </text>
                </svg>
                <div className="mt-2 grid grid-cols-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <span>5%</span>
                  <span className="text-center">Mean</span>
                  <span className="text-right">95%</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">One-item mean:</span>
                  <span className="ml-2 font-medium">
                    {stationDistribution.mean.toFixed(2)}s
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Variance:</span>
                  <span className="ml-2 font-medium">{variance.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-600">5% end:</span>
                  <span className="ml-2 font-medium">
                    {percentile05.toFixed(2)}s
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">95% end:</span>
                  <span className="ml-2 font-medium">
                    {percentile95.toFixed(2)}s
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Samples:</span>
                  <span className="ml-2 font-medium">{totalSampleCount}</span>
                </div>
                <div>
                  <span className="text-gray-600">Completed here:</span>
                  <span className="ml-2 font-medium">{completedTaskCount}</span>
                </div>
              </div>
            </div>
          </div>

          {completedTask && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Task Completed
              </h3>
              <div className="bg-gray-50 rounded p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-600">Order:</span>
                    <span className="ml-2 font-medium">
                      #{completedTask.orderId.slice(-6)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Quantity:</span>
                    <span className="ml-2 font-medium">
                      {completedTask.quantity}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-600">Time taken:</span>
                    <span className="ml-2 font-bold text-lg text-gray-900">
                      {formatDuration(completedTask.timeTakenMs)}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <span>Performance Rating</span>
                    <span>{getPerformanceLabel(completedTask.performanceRating)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    value={completedTask.performanceRating}
                    onChange={(event) =>
                      setCompletedTask((currentSummary) =>
                        currentSummary
                          ? {
                              ...currentSummary,
                              performanceRating: parseFloat(event.target.value),
                            }
                          : currentSummary,
                      )
                    }
                    className="mt-2 w-full"
                  />
                  <div className="mt-1 flex justify-between text-xs text-gray-500">
                    <span>Low / slow</span>
                    <span>Normal</span>
                    <span>High / fast</span>
                  </div>
                </div>

                <button
                  onClick={handleRecordTime}
                  disabled={Boolean(completedTask.recordedAt)}
                  className="w-full px-3 py-2 bg-slate-800 text-white rounded hover:bg-slate-900 text-sm font-medium disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {completedTask.recordedAt ? "Recorded" : "Record Time"}
                </button>
              </div>
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Speed Override
            </h3>
            <div className="bg-gray-50 rounded p-3">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={stationSpeed}
                  onChange={(event) =>
                    updateStationSpeedMultiplier(
                      stationKey,
                      parseFloat(event.target.value),
                    )
                  }
                  className="flex-1"
                />
                <span className="text-sm font-mono w-12">
                  {stationSpeed.toFixed(2)}x
                </span>
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.0x</span>
                <span>Normal</span>
                <span>1.5x</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={dividerRef}
        className="w-1 bg-gray-400 hover:bg-gray-500 cursor-col-resize transition-colors"
        onMouseDown={() => setIsDragging(true)}
      />

      <div
        className="bg-gray-50 flex-1 relative overflow-y-auto"
        style={{ width: `${100 - leftPaneWidth}%` }}
      >
        <div className="p-2">
          <div className="max-w-2xl mx-auto">
            <ProductionSchedule
              orders={orders}
              updateOrderField={updateOrderField}
              scheduleOrderIds={scheduleOrderIds}
              currentTime={currentTime}
              isStationMode={true}
              onOrderClick={setCurrentOrderId}
              currentOrderId={resolvedCurrentOrderId}
              stationNumber={stationIndex}
              stationSchedule={stationSchedule}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
