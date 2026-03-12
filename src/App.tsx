import { useState, useEffect, useRef } from "react";
import "./App.css";
import type {
  Order,
  OrderStatus,
} from "./utils/gameState";
import {
  addOrder,
  deleteRecentOrder,
  normalizeScheduleOrderIds,
  updateOrder,
} from "./utils/orders";
import { ProductionSchedule } from "./components/ProductionSchedule";
import { StationView } from "./components/StationView";
import type {
  PaperInventory,
  Transaction,
} from "./utils/gameState";
import { useAmplifySharedGameState } from "./hooks/useAmplifySharedGameState";
import {
  gameState,
  PaperColor,
  PAPER_COLORS,
  OCCASIONS,
  getColorName,
  getColorPrice,
} from "./utils/gameState";
import {
  fuzzySearch,
  getColorClass,
  getRowColorClass,
  formatOrderTime,
  getStatusColor,
  formatTime,
} from "./utils/ui";
import { DEFAULT_TEAM_ID, TEAM_ID_STORAGE_KEY } from "./utils/sharedGameState";
import {
  DEFAULT_STATION_SPEED_MULTIPLIERS,
  type StationSpeedMultipliers,
} from "./utils/station";
import {
  buildSchedulerSuggestions,
  type RequiredPapers,
  type RankedScheduleCandidate,
  type SchedulerSuggestionResult,
} from "./utils/strategyPlanner";
import {
  estimateLitePlanTotalProfit,
  type PlanForecastResult,
} from "./utils/orderForecasting";

type ViewType = "operations" | "station1" | "station2" | "station3";
const SCHEDULER_ENABLED_STORAGE_KEY = "production-game/device-enable-scheduler";
const LITE_FORECAST_ENABLED_STORAGE_KEY =
  "production-game/device-enable-lite-forecast";

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }

  return value === "1";
}

function getSyncStatusClass(state: string): string {
  switch (state) {
    case "synced":
      return "text-green-300";
    case "syncing":
    case "connecting":
    case "configuring":
      return "text-yellow-300";
    case "error":
      return "text-red-300";
    default:
      return "text-gray-300";
  }
}

function areOrderIdListsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((orderId, index) => orderId === right[index])
  );
}

function getPaperSizeDigits(size: string): string {
  return size.toUpperCase().replace(/A/g, "").replace(/[^0-9]/g, "");
}

function normalizePaperSize(value: string): string {
  const digits = getPaperSizeDigits(value);
  return digits ? `A${digits}` : "";
}

function formatDurationCompact(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "∞";
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatProfitPerSecond(value: number): string {
  return `£${value.toFixed(Math.abs(value) >= 1 ? 2 : 3)}/s`;
}

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`;
}

function formatSuccessRate(schedule: RankedScheduleCandidate | null): string {
  if (!schedule || !schedule.orderEvaluations.length) {
    return "n/a";
  }

  const planSuccessProbability = schedule.orderEvaluations.reduce(
    (product, evaluation) =>
      product * Math.min(1, Math.max(0, evaluation.successProbability)),
    1,
  );

  return `${(planSuccessProbability * 100).toFixed(1)}%`;
}

interface PaperRequirementEntry {
  colorCode: string;
  orderRequirement: number;
  safetyStockGap: number;
  totalNeeded: number;
  currentInventory: number;
  pendingDelivery: number;
}

interface PlanForecastSummaries {
  currentPlan: PlanForecastResult | null;
  bestPlan: PlanForecastResult | null;
}

const STATION_CONTROL_CONFIG: Array<{
  key: keyof StationSpeedMultipliers;
  label: string;
  stationId: string;
}> = [
  { key: "station1", label: "Station 1", stationId: "station1_folding" },
  { key: "station2", label: "Station 2", stationId: "station2_stencilling" },
  { key: "station3", label: "Station 3", stationId: "station3_writing" },
];

function App() {
  // View state
  const [currentView, setCurrentView] = useState<ViewType>("operations");
  
  // Resizable panes state
  const [leftPaneWidth, setLeftPaneWidth] = useState(70); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [teamId, setTeamId] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_TEAM_ID;
    }

    return window.localStorage.getItem(TEAM_ID_STORAGE_KEY) || DEFAULT_TEAM_ID;
  });
  const [teamIdInput, setTeamIdInput] = useState(teamId);

  const [, setOccasionSearch] = useState("");
  const [filteredOccasions, setFilteredOccasions] = useState<string[]>([]);
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  const [activeField, setActiveField] = useState<'color' | 'occasion' | null>(null);
  const occasionInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>(
    {},
  );
  const colorInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const quantityInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>(
    {},
  );
  const [colorSearch, setColorSearch] = useState("");
  const [filteredColors, setFilteredColors] = useState<string[]>([]);
  const [showNewColorDialog, setShowNewColorDialog] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorPrice, setNewColorPrice] = useState(20);
  const [leadTimeDrafts, setLeadTimeDrafts] = useState<Record<string, string>>(
    {},
  );
  const [pendingColorOrderId, setPendingColorOrderId] = useState<string | null>(null);
  const [pendingQuantityFocusOrderId, setPendingQuantityFocusOrderId] =
    useState<string | null>(null);
  const [scheduleOrderIds, setScheduleOrderIds] = useState<string[]>([]);
  const [schedulerSuggestions, setSchedulerSuggestions] =
    useState<SchedulerSuggestionResult | null>(null);
  const [clearedSuggestedPaperPlanId, setClearedSuggestedPaperPlanId] =
    useState<string | null>(null);

  // Inventory Management State - the game starts with nothing, then we will manually buy
  const [paperInventory, setPaperInventory] = useState<PaperInventory>({
    w: 0,
    g: 0,
    p: 0,
    y: 0,
    b: 0,
    s: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cash, setCash] = useState(0); // Game starts with no cash
  const initialParameters = gameState.getParameters();
  const [safetyStock, setSafetyStock] = useState(initialParameters.safetyStock);
  const [workstationSpeed, setWorkstationSpeed] = useState(
    initialParameters.workstationSpeed,
  );
  const [buyingCooldown, setBuyingCooldown] = useState(
    initialParameters.buyingCooldown,
  );
  const [paperDeliverySeconds, setPaperDeliverySeconds] = useState(
    initialParameters.paperDeliverySeconds,
  );
  const [sellMarkdown, setSellMarkdown] = useState(
    initialParameters.sellMarkdown,
  );
  const [failureFineRatio, setFailureFineRatio] = useState(
    initialParameters.failureFineRatio,
  );
  const [colourLoveMultiplier, setColourLoveMultiplier] = useState(
    initialParameters.colourLoveMultiplier,
  );
  const [whiteLoveMultiplier, setWhiteLoveMultiplier] = useState(
    initialParameters.whiteLoveMultiplier,
  );
  const [standardTimeRatio, setStandardTimeRatio] = useState(
    initialParameters.standardTimeRatio,
  );
  const [greedometer, setGreedometer] = useState(initialParameters.greedometer);
  const [forecastSpeed, setForecastSpeed] = useState(
    initialParameters.forecastSpeed,
  );
  const [stationSpeedMultipliers, setStationSpeedMultipliers] =
    useState<StationSpeedMultipliers>({
      ...DEFAULT_STATION_SPEED_MULTIPLIERS,
      ...initialParameters.stationSpeedMultipliers,
    });
  const [planForecastSummaries, setPlanForecastSummaries] =
    useState<PlanForecastSummaries>({
      currentPlan: null,
      bestPlan: null,
    });
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const schedulerTimeBucket = Math.floor(currentTime / 30000) * 30000;
  const liteForecastMinuteBucket = Math.floor(currentTime / 60000) * 60000;
  const liteForecastTimeoutRef = useRef<number | null>(null);
  const liteForecastIdleCallbackRef = useRef<number | null>(null);
  const lastLiteForecastMinuteBucketRef = useRef<number | null>(null);
  const [schedulerEnabled, setSchedulerEnabled] = useState(() =>
    getStoredBoolean(SCHEDULER_ENABLED_STORAGE_KEY, true),
  );
  const [liteForecastEnabled, setLiteForecastEnabled] = useState(() =>
    getStoredBoolean(LITE_FORECAST_ENABLED_STORAGE_KEY, true),
  );
  const syncStatus = useAmplifySharedGameState({
    teamId,
    orders,
    setOrders,
    paperInventory,
    setPaperInventory,
    transactions,
    setTransactions,
    cash,
    setCash,
    safetyStock,
    setSafetyStock,
    workstationSpeed,
    setWorkstationSpeed,
    buyingCooldown,
    setBuyingCooldown,
    paperDeliverySeconds,
    setPaperDeliverySeconds,
    sellMarkdown,
    setSellMarkdown,
    failureFineRatio,
    setFailureFineRatio,
    colourLoveMultiplier,
    setColourLoveMultiplier,
    whiteLoveMultiplier,
    setWhiteLoveMultiplier,
    standardTimeRatio,
    setStandardTimeRatio,
    greedometer,
    setGreedometer,
    forecastSpeed,
    setForecastSpeed,
    stationSpeedMultipliers,
    setStationSpeedMultipliers,
  });


  // Update order
  const updateOrderField = (id: string, field: keyof Order, value: unknown) => {
    const updatedOrders = updateOrder(
      orders,
      id,
      field,
      value,
      transactions,
      cash,
      setTransactions,
      setCash
    );
    setOrders(updatedOrders);
  };

  const handleAddOrder = () => {
    const newOrder = addOrder();
    setOrders((currentOrders) => [...currentOrders, newOrder]);
    setPendingQuantityFocusOrderId(newOrder.id);
  };

  const updateStationSpeedMultiplier = (
    stationKey: keyof StationSpeedMultipliers,
    nextValue: number,
  ) => {
    setStationSpeedMultipliers((currentMultipliers) => ({
      ...currentMultipliers,
      [stationKey]: nextValue,
    }));
  };

  const commitLeadTimeDraft = (order: Order) => {
    const draftValue = leadTimeDrafts[order.id];
    if (draftValue === undefined) {
      return;
    }

    const trimmedValue = draftValue.trim();
    const nextLeadTime =
      trimmedValue === "" ? -1 : parseInt(trimmedValue, 10);

    updateOrderField(
      order.id,
      "leadTime",
      Number.isFinite(nextLeadTime) ? nextLeadTime : order.leadTime,
    );

    setLeadTimeDrafts((currentDrafts) => {
      const { [order.id]: _removed, ...remainingDrafts } = currentDrafts;
      return remainingDrafts;
    });
  };

  const createPaperPurchaseTransactions = (
    requirements: RequiredPapers | undefined,
    label: string,
  ): Transaction[] => {
    if (!requirements) {
      return [];
    }

    const requirementEntries = Object.entries(requirements).filter(
      ([, requirement]) => requirement.totalNeeded > 0,
    );
    if (!requirementEntries.length) {
      return [];
    }

    return requirementEntries.map(([colorCode, requirement]) =>
      gameState.createTransaction(
        -Math.abs(requirement.totalNeeded * getColorPrice(colorCode)),
        `${label}: buy ${requirement.totalNeeded} ${getColorName(colorCode)} sheets`,
        "paper",
        colorCode,
        requirement.totalNeeded,
        undefined,
        true,
        paperDeliverySeconds * 1000,
      ),
    );
  };

  const registerPaperRequirements = (
    requirements: RequiredPapers | undefined,
    label: string,
  ) => {
    const newTransactions = createPaperPurchaseTransactions(requirements, label);
    if (!newTransactions.length) {
      return;
    }

    setTransactions((currentTransactions) => [
      ...currentTransactions,
      ...newTransactions,
    ]);
    setCash((currentCash) =>
      currentCash + newTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    );
    gameState.startBuyingCooldown(buyingCooldown);
  };

  const acceptAndOrderSuggestedPlan = () => {
    const bestSuggestion = schedulerSuggestions?.bestSuggestion;
    if (!bestSuggestion) {
      return;
    }

    const activationTime = Date.now();
    const bestSuggestionIdSet = new Set(bestSuggestion.orderIds);
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const availablePaperByColor: Record<string, number> = { ...paperInventory };
    const nextStatusesByOrderId = new Map<
      string,
      { status: OrderStatus; progress: number; startTime: number; dueTime?: number }
    >();

    bestSuggestion.orderIds.forEach((orderId) => {
      const order = orderMap.get(orderId);
      if (!order || order.status !== "passive") {
        return;
      }

      const colorCode = order.paperColor.code;
      const hasInventoryForOrder = (availablePaperByColor[colorCode] || 0) >= order.quantity;
      if (hasInventoryForOrder) {
        availablePaperByColor[colorCode] -= order.quantity;
      }

      const startTime = order.startTime ?? activationTime;
      nextStatusesByOrderId.set(orderId, {
        status: hasInventoryForOrder ? "WIP" : "pending_inventory",
        progress: hasInventoryForOrder ? Math.max(1, order.progress || 0) : 0,
        startTime,
        dueTime:
          order.dueTime ??
          (order.leadTime > 0 ? startTime + order.leadTime * 60 * 1000 : undefined),
      });
    });

    const nextOrders = orders.map((order) => {
      const nextState = nextStatusesByOrderId.get(order.id);
      if (!bestSuggestionIdSet.has(order.id) || !nextState) {
        return order;
      }

      return {
        ...order,
        status: nextState.status,
        progress: nextState.progress,
        startTime: nextState.startTime,
        dueTime: nextState.dueTime,
      };
    });

    const paperTransactions = createPaperPurchaseTransactions(
      bestSuggestion.requiredPapers,
      "Suggested schedule paper order",
    );

    setOrders(nextOrders);
    if (paperTransactions.length) {
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...paperTransactions,
      ]);
      setCash((currentCash) =>
        currentCash +
        paperTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      );
      gameState.startBuyingCooldown(buyingCooldown);
    }
    setScheduleOrderIds(bestSuggestion.orderIds);
    gameState.updateScheduleOrderIds(bestSuggestion.orderIds);
    setClearedSuggestedPaperPlanId(null);
  };

  // Handle pane resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = (e.clientX / window.innerWidth) * 100;
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

  // Sync local state with gameState singleton
  useEffect(() => {
    gameState.setOrders(orders);
  }, [orders]);

  useEffect(() => {
    if (!pendingQuantityFocusOrderId) {
      return;
    }

    const quantityInput = quantityInputRefs.current[pendingQuantityFocusOrderId];
    if (!quantityInput) {
      return;
    }

    quantityInput.focus();
    quantityInput.select();
    setPendingQuantityFocusOrderId(null);
  }, [orders, pendingQuantityFocusOrderId]);

  useEffect(() => {
    return gameState.subscribe(() => {
      const nextOrderIds = gameState.getCurrentSchedule().orderIds;
      setScheduleOrderIds((currentOrderIds) =>
        areOrderIdListsEqual(currentOrderIds, nextOrderIds)
          ? currentOrderIds
          : [...nextOrderIds],
      );
    });
  }, []);

  useEffect(() => {
    const normalizedOrderIds = normalizeScheduleOrderIds(orders, scheduleOrderIds);
    if (areOrderIdListsEqual(scheduleOrderIds, normalizedOrderIds)) {
      return;
    }

    setScheduleOrderIds(normalizedOrderIds);
    gameState.updateScheduleOrderIds(normalizedOrderIds);
  }, [orders, scheduleOrderIds]);

  useEffect(() => {
    gameState.setCash(cash);
  }, [cash]);

  useEffect(() => {
    gameState.setPaperInventory(paperInventory);
  }, [paperInventory]);

  useEffect(() => {
    gameState.setTransactions(transactions);
  }, [transactions]);

  useEffect(() => {
    gameState.updateParameters({
      workstationSpeed,
      safetyStock,
      buyingCooldown,
      paperDeliverySeconds,
      sellMarkdown,
      failureFineRatio,
      colourLoveMultiplier,
      whiteLoveMultiplier,
      standardTimeRatio,
      greedometer,
      forecastSpeed,
      stationSpeedMultipliers,
    });
  }, [
    buyingCooldown,
    colourLoveMultiplier,
    failureFineRatio,
    forecastSpeed,
    greedometer,
    paperDeliverySeconds,
    safetyStock,
    sellMarkdown,
    standardTimeRatio,
    stationSpeedMultipliers,
    workstationSpeed,
    whiteLoveMultiplier,
  ]);

  useEffect(() => {
    gameState.setTeamId(teamId);
    window.localStorage.setItem(TEAM_ID_STORAGE_KEY, teamId);
    setTeamIdInput(teamId);
  }, [teamId]);

  useEffect(() => {
    (window as Window & { gameState?: typeof gameState }).gameState = gameState;
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SCHEDULER_ENABLED_STORAGE_KEY,
      schedulerEnabled ? "1" : "0",
    );
  }, [schedulerEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      LITE_FORECAST_ENABLED_STORAGE_KEY,
      liteForecastEnabled ? "1" : "0",
    );
  }, [liteForecastEnabled]);

  useEffect(() => {
    return () => {
      if (liteForecastTimeoutRef.current !== null) {
        window.clearTimeout(liteForecastTimeoutRef.current);
        liteForecastTimeoutRef.current = null;
      }

      if (
        liteForecastIdleCallbackRef.current !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(liteForecastIdleCallbackRef.current);
        liteForecastIdleCallbackRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!schedulerEnabled || currentView !== "operations") {
      setSchedulerSuggestions(null);
      return;
    }

    setSchedulerSuggestions(
      buildSchedulerSuggestions({
        orders,
        scheduleOrderIds,
        paperInventory,
        parameters: {
          failureFineRatio,
          paperDeliverySeconds,
          safetyStock,
          workstationSpeed,
        },
        stations: gameState.getStationManager().getAllStations(),
        currentTime: schedulerTimeBucket,
        transactions,
        buyingCooldownRemainingMs: gameState.getBuyingCooldownRemaining() * 1000,
        calculatePaperCurrentWorth: (paperColor) =>
          gameState.calculatePaperCurrentWorth(paperColor),
      }),
    );
  }, [
    currentView,
    schedulerEnabled,
    orders,
    paperInventory,
    safetyStock,
    scheduleOrderIds,
    schedulerTimeBucket,
    transactions,
    workstationSpeed,
    stationSpeedMultipliers,
    failureFineRatio,
  ]);

  useEffect(() => {
    const clearScheduledLiteForecast = () => {
      if (liteForecastTimeoutRef.current !== null) {
        window.clearTimeout(liteForecastTimeoutRef.current);
        liteForecastTimeoutRef.current = null;
      }

      if (
        liteForecastIdleCallbackRef.current !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(liteForecastIdleCallbackRef.current);
        liteForecastIdleCallbackRef.current = null;
      }
    };

    if (
      !schedulerSuggestions ||
      !schedulerEnabled ||
      !liteForecastEnabled ||
      currentView !== "operations"
    ) {
      clearScheduledLiteForecast();
      setPlanForecastSummaries({
        currentPlan: null,
        bestPlan: null,
      });
      return;
    }

    clearScheduledLiteForecast();

    const isMinuteTick =
      lastLiteForecastMinuteBucketRef.current !== liteForecastMinuteBucket;
    lastLiteForecastMinuteBucketRef.current = liteForecastMinuteBucket;
    const delayMs = isMinuteTick
      ? 0
      : planForecastSummaries.currentPlan || planForecastSummaries.bestPlan
        ? 60_000
        : 0;

    liteForecastTimeoutRef.current = window.setTimeout(() => {
      liteForecastTimeoutRef.current = null;

      const computeForecastSummaries = () => {
        const stations = gameState.getStationManager().getAllStations();
        const forecastingContext = {
          orders,
          scheduleOrderIds,
          paperInventory,
          parameters: {
            failureFineRatio,
            paperDeliverySeconds,
            safetyStock,
            workstationSpeed,
            greedometer,
            forecastSpeed,
          },
          stations,
          currentTime: schedulerTimeBucket,
          calculatePaperCurrentWorth: (paperColor: Order["paperColor"]) =>
            gameState.calculatePaperCurrentWorth(paperColor),
        };

        setPlanForecastSummaries({
          currentPlan: estimateLitePlanTotalProfit(
            forecastingContext,
            schedulerSuggestions.currentSchedule,
          ),
          bestPlan: estimateLitePlanTotalProfit(
            forecastingContext,
            schedulerSuggestions.bestSuggestion,
          ),
        });
      };

      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        liteForecastIdleCallbackRef.current = window.requestIdleCallback(
          () => {
            liteForecastIdleCallbackRef.current = null;
            computeForecastSummaries();
          },
          { timeout: 1500 },
        );
        return;
      }

      computeForecastSummaries();
    }, delayMs);

    return clearScheduledLiteForecast;
  }, [
    currentView,
    liteForecastEnabled,
    liteForecastMinuteBucket,
    colourLoveMultiplier,
    failureFineRatio,
    forecastSpeed,
    greedometer,
    orders,
    paperInventory,
    paperDeliverySeconds,
    safetyStock,
    schedulerEnabled,
    scheduleOrderIds,
    schedulerSuggestions,
    schedulerTimeBucket,
    stationSpeedMultipliers,
    workstationSpeed,
    whiteLoveMultiplier,
  ]);

  // Warning before leaving the page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved game data. Are you sure you want to leave?';
      return 'You have unsaved game data. Are you sure you want to leave?';
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+N: Add new order
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        handleAddOrder();
      }
      // Ctrl+Z: Delete newest passive order with confirmation
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        const newestPassive = orders.find(o => o.status === "passive");
        if (newestPassive && confirm("Delete the newest passive order?")) {
          setOrders(deleteRecentOrder(orders));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleAddOrder, orders]);

  const applyTeamId = () => {
    const normalized = teamIdInput.trim().toUpperCase();
    if (!normalized) {
      return;
    }

    setTeamId(normalized);
  };

  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const toPaperRequirementEntries = (
    requirements: RequiredPapers | undefined,
  ): PaperRequirementEntry[] =>
    Object.entries(requirements || {})
      .map(([colorCode, requirement]) => ({
        colorCode,
        ...requirement,
      }))
      .filter((entry) => entry.totalNeeded > 0)
      .sort((left, right) => right.totalNeeded - left.totalNeeded);

  const describeSchedule = (schedule: RankedScheduleCandidate | null) =>
    schedule
      ? schedule.orderIds
          .map((orderId) => {
            const order = orderMap.get(orderId);
            if (!order) {
              return orderId.slice(-6);
            }

            return `${order.quantity}x ${order.occasion || "Cards"} (${order.paperColor.code.toUpperCase()})`;
          })
          .join(" -> ")
      : "No schedulable orders";

  const currentScheduleMatchesSuggestion = Boolean(
    schedulerSuggestions?.bestSuggestion &&
      schedulerSuggestions.currentSchedule &&
      areOrderIdListsEqual(
        schedulerSuggestions.bestSuggestion.orderIds,
        schedulerSuggestions.currentSchedule.orderIds,
      ),
  );
  const currentSchedulePaperRequirements = toPaperRequirementEntries(
    schedulerSuggestions?.currentSchedule?.requiredPapers,
  );
  const suggestedSchedulePaperRequirements = toPaperRequirementEntries(
    schedulerSuggestions?.bestSuggestion?.requiredPapers,
  );
  const showSuggestedPaperRequirements = Boolean(
    schedulerSuggestions?.bestSuggestion &&
      clearedSuggestedPaperPlanId !== schedulerSuggestions.bestSuggestion.id,
  );
  const buyingCooldownRemainingSeconds = gameState.getBuyingCooldownRemaining();
  const suggestedPlanNeedsPaperOrder = suggestedSchedulePaperRequirements.length > 0;
  const suggestedPlanActionDisabled =
    !schedulerSuggestions?.bestSuggestion ||
    currentScheduleMatchesSuggestion ||
    (suggestedPlanNeedsPaperOrder && buyingCooldownRemainingSeconds > 0);

  // Add new transaction
  const addTransaction = (
    amount: number,
    reason: string,
    type: "cash" | "paper" | "inventory" = "cash",
    paperColor?: string,
    paperQuantity?: number,
    orderId?: string,
    pending?: boolean,
    deliveryTime?: number,
  ) => {
    const newTransaction = gameState.createTransaction(
      amount,
      reason,
      type,
      paperColor,
      paperQuantity,
      orderId,
      pending,
      deliveryTime
    );

    setTransactions([...transactions, newTransaction]);
    setCash((prev) => prev + amount);

    // Update paper inventory if it's a paper transaction and not pending
    // Negative quantities are allowed (for returns/corrections)
    if (paperColor && paperQuantity !== undefined && !pending) {
      setPaperInventory((prev) => ({
        ...prev,
        [paperColor]: (prev[paperColor] || 0) + paperQuantity,
      }));
    }
  };

  // Edit transaction
  const editTransaction = (id: string, updates: Partial<Transaction>) => {
    const transIndex = transactions.findIndex(t => t.id === id);
    if (transIndex === -1) return;
    
    const oldTrans = transactions[transIndex];
    const newTrans = { ...oldTrans, ...updates };
    
    // Update transactions array
    const newTransactions = [...transactions];
    newTransactions[transIndex] = newTrans;
    setTransactions(newTransactions);
    
    // Update cash if amount changed
    if (updates.amount !== undefined) {
      const amountDiff = newTrans.amount - oldTrans.amount;
      setCash((prev) => prev + amountDiff);
    }
    
    // Update inventory if paper transaction changed
    if (oldTrans.paperColor && oldTrans.paperQuantity) {
      // Reverse old transaction
      setPaperInventory((prev) => ({
        ...prev,
        [oldTrans.paperColor!]: (prev[oldTrans.paperColor!] || 0) - oldTrans.paperQuantity!,
      }));
    }
    if (newTrans.paperColor && newTrans.paperQuantity) {
      // Apply new transaction
      setPaperInventory((prev) => ({
        ...prev,
        [newTrans.paperColor!]: (prev[newTrans.paperColor!] || 0) + newTrans.paperQuantity!,
      }));
    }
  };

  // Delete transaction
  const deleteTransaction = (id: string) => {
    const trans = transactions.find(t => t.id === id);
    if (!trans) return;
    
    // Remove from transactions
    setTransactions(transactions.filter(t => t.id !== id));
    
    // Reverse the cash effect
    setCash((prev) => prev - trans.amount);
    
    // Reverse inventory effect if it's a paper transaction (and not pending)
    if (trans.paperColor && trans.paperQuantity && !trans.pending) {
      setPaperInventory((prev) => ({
        ...prev,
        [trans.paperColor!]: (prev[trans.paperColor!] || 0) - trans.paperQuantity!,
      }));
    }
  };

  const resetGameState = () => {
    if (!window.confirm("ARE YOU REALLY REALLY SURE you want to reset the whole game?")) {
      return;
    }

    if (!window.confirm("This clears orders, cash, inventory, transactions, schedule, and synced state for this team. Continue?")) {
      return;
    }

    gameState.reset();
    const resetParameters = gameState.getParameters();
    setOrders([]);
    setPaperInventory({ w: 0, g: 0, p: 0, y: 0, b: 0, s: 0 });
    setTransactions([]);
    setCash(0);
    setScheduleOrderIds([]);
    setSchedulerSuggestions(null);
    setPlanForecastSummaries({
      currentPlan: null,
      bestPlan: null,
    });
    setSafetyStock(resetParameters.safetyStock);
    setWorkstationSpeed(resetParameters.workstationSpeed);
    setBuyingCooldown(resetParameters.buyingCooldown);
    setPaperDeliverySeconds(resetParameters.paperDeliverySeconds);
    setSellMarkdown(resetParameters.sellMarkdown);
    setFailureFineRatio(resetParameters.failureFineRatio);
    setColourLoveMultiplier(resetParameters.colourLoveMultiplier);
    setWhiteLoveMultiplier(resetParameters.whiteLoveMultiplier);
    setStandardTimeRatio(resetParameters.standardTimeRatio);
    setGreedometer(resetParameters.greedometer);
    setForecastSpeed(resetParameters.forecastSpeed);
    setStationSpeedMultipliers({
      ...resetParameters.stationSpeedMultipliers,
    });
    setClearedSuggestedPaperPlanId(null);
  };

  // Complete a pending transaction
  function completePendingTransaction(id: string) {
    const transIndex = transactions.findIndex(t => t.id === id && t.pending);
    if (transIndex === -1) return;
    
    const trans = transactions[transIndex];
    if (!trans.pending) return;
    
    // Update transaction to no longer be pending
    const updatedTrans = { ...trans, pending: false };
    const newTransactions = [...transactions];
    newTransactions[transIndex] = updatedTrans;
    setTransactions(newTransactions);
    
    // Now add to inventory
    if (trans.paperColor && trans.paperQuantity !== undefined) {
      setPaperInventory((prev) => ({
        ...prev,
        [trans.paperColor!]: (prev[trans.paperColor!] || 0) + trans.paperQuantity!,
      }));
    }
  }

  // Timer for pending transactions countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
      
      // Check for completed pending transactions
      transactions.forEach(trans => {
        if (trans.pending && trans.arrivalTime && Date.now() >= trans.arrivalTime) {
          completePendingTransaction(trans.id);
        }
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [transactions]);

  return (
    <div className="min-h-screen w-full bg-gray-100">
      {/* Cash Metrics Header Bar - Different colors for different views */}
      <div className={`text-white p-2 border-b border-gray-700 sticky top-0 z-40 ${
        currentView === "station1" ? "bg-blue-900" :
        currentView === "station2" ? "bg-green-900" :
        currentView === "station3" ? "bg-purple-900" :
        "bg-gray-900"
      }`}>
        <div className="flex justify-between items-center">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Cash:</span>
              <span className="text-sm font-bold text-green-400">
                £{cash.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Net Worth:</span>
              <span className="text-sm font-bold text-blue-400">
                £{gameState.calculateNetWorth().toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Profit:</span>
              <span
                className={`text-sm font-bold ${gameState.calculateProfit() >= 0 ? "text-green-400" : "text-red-400"}`}
              >
                £{gameState.calculateProfit().toFixed(2)}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Navigation Buttons */}
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentView("operations")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  currentView === "operations" 
                    ? "bg-blue-600 hover:bg-blue-700 text-white" 
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}>
                Operations Management
              </button>
              <button 
                onClick={() => setCurrentView("station1")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  currentView === "station1" 
                    ? "bg-blue-600 hover:bg-blue-700 text-white" 
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}>
                Station 1
              </button>
              <button 
                onClick={() => setCurrentView("station2")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  currentView === "station2" 
                    ? "bg-blue-600 hover:bg-blue-700 text-white" 
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}>
                Station 2
              </button>
              <button 
                onClick={() => setCurrentView("station3")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  currentView === "station3" 
                    ? "bg-blue-600 hover:bg-blue-700 text-white" 
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}>
                Station 3
              </button>
            </div>
            
            {gameState.getBuyingCooldownRemaining() > 0 && (
              <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
                <span className="text-xs text-yellow-400">Buying Cooldown:</span>
                <span className="text-sm font-mono">
                  {formatTime(gameState.getBuyingCooldownRemaining())}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
              <span className={`text-xs font-medium ${getSyncStatusClass(syncStatus.state)}`}>
                {syncStatus.message}
              </span>
              <input
                type="text"
                value={teamIdInput}
                onChange={(e) => setTeamIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyTeamId();
                  }
                }}
                className="w-28 rounded border border-gray-500 bg-gray-800 px-2 py-1 text-xs text-white"
                placeholder="TEAM ID"
              />
              <button
                onClick={applyTeamId}
                className="rounded bg-gray-700 px-2 py-1 text-xs font-medium text-white hover:bg-gray-600"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Render different views based on currentView */}
      {currentView === "operations" ? (
        <>
          {/* Two-pane section - Operations Management View */}
          <div className="flex relative">
            {/* Left Pane - Order Management */}
            <div
              className="bg-white border-r border-gray-300"
              style={{ width: `${leftPaneWidth}%` }}
            >
              <div className="p-2">
                <div className="flex justify-between items-center mb-1">
                  <h2 className="text-base font-bold text-gray-800">
                    Order Management
                  </h2>
                </div>

                {/* Orders Table */}
                <div className="mb-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      ID
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order.id}
                      className={`border-b hover:bg-gray-50 ${getRowColorClass(order)}`}
                    >
                      <td className="px-2 py-1">
                        <span className="font-mono text-xs text-gray-500">
                          {order.id.slice(-6)}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={formatOrderTime(order.orderTime)}
                          onChange={(e) => {
                            const timeStr = e.target.value;
                            const [hours, minutes] = timeStr
                              .split(":")
                              .map(Number);
                            if (!isNaN(hours) && !isNaN(minutes)) {
                              const newDate = new Date(order.orderTime);
                              newDate.setHours(hours, minutes);
                              updateOrderField(
                                order.id,
                                "orderTime",
                                newDate.getTime(),
                              );
                            }
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="HH:MM"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          ref={(el) => {
                            quantityInputRefs.current[order.id] = el;
                          }}
                          type="text"
                          value={order.quantity}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "quantity",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={
                            leadTimeDrafts[order.id] ??
                            (order.leadTime < 0 ? "" : String(order.leadTime))
                          }
                          onChange={(e) =>
                            setLeadTimeDrafts((currentDrafts) => ({
                              ...currentDrafts,
                              [order.id]: e.target.value,
                            }))
                          }
                          onFocus={() =>
                            setLeadTimeDrafts((currentDrafts) => ({
                              ...currentDrafts,
                              [order.id]:
                                currentDrafts[order.id] ??
                                (order.leadTime < 0 ? "" : String(order.leadTime)),
                            }))
                          }
                          onBlur={() => commitLeadTimeDraft(order)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="∞"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) => {colorInputRefs.current[order.id] = el}}
                          type="text"
                          value={
                            activeRowIndex === index && activeField === "color"
                              ? colorSearch
                              : order.paperColor.name
                          }
                          onChange={(e) => {
                            const value = e.target.value;
                            setColorSearch(value);
                            setActiveRowIndex(index);
                            setActiveField('color');
                            setFilteredColors(
                              fuzzySearch(
                                value,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                            // Try to match color immediately if exact match
                            const exactMatch = PAPER_COLORS.find(
                              (c) =>
                                c.name.toLowerCase() === value.toLowerCase(),
                            );
                            if (exactMatch) {
                              updateOrderField(
                                order.id,
                                "paperColor",
                                exactMatch,
                              );
                              setColorSearch("");
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredColors([]);
                            }
                          }}
                          onFocus={() => {
                            setColorSearch(order.paperColor.name);
                            setActiveRowIndex(index);
                            setActiveField('color');
                            setFilteredColors(
                              fuzzySearch(
                                order.paperColor.name,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                          }}
                          onBlur={() => {
                            // Check if user typed something that doesn't exist
                            if (colorSearch && colorSearch !== order.paperColor.name) {
                              const exactMatch = PAPER_COLORS.find(
                                (c) => c.name.toLowerCase() === colorSearch.toLowerCase()
                              );
                              if (!exactMatch && filteredColors.length === 0) {
                                // No matches at all - prompt to create new color
                                setNewColorName(colorSearch);
                                setPendingColorOrderId(order.id);
                                setShowNewColorDialog(true);
                              }
                            }
                            setTimeout(() => {
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredColors([]);
                              setColorSearch("");
                            }, 200);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && filteredColors.length > 0) {
                              // Auto-populate with top match on Tab
                              const topMatch = PAPER_COLORS.find(c => c.name === filteredColors[0]);
                              if (topMatch) {
                                updateOrderField(order.id, "paperColor", topMatch);
                                setColorSearch("");
                                setActiveRowIndex(-1);
                              setActiveField(null);
                                setFilteredColors([]);
                              }
                            } else if (e.key === 'Enter') {
                              if (filteredColors.length > 0) {
                                // Select the first match on Enter
                                const topMatch = PAPER_COLORS.find(c => c.name === filteredColors[0]);
                                if (topMatch) {
                                  updateOrderField(order.id, "paperColor", topMatch);
                                  setColorSearch("");
                                  setActiveRowIndex(-1);
                              setActiveField(null);
                                  setFilteredColors([]);
                                }
                              } else if (colorSearch && filteredColors.length === 0) {
                                // Enter with no matches - prompt to create new color
                                e.preventDefault();
                                const exactMatch = PAPER_COLORS.find(
                                  (c) => c.name.toLowerCase() === colorSearch.toLowerCase()
                                );
                                if (!exactMatch) {
                                  setNewColorName(colorSearch);
                                  setPendingColorOrderId(order.id);
                                  setShowNewColorDialog(true);
                                }
                              }
                            } else if (e.key === 'Escape') {
                              setColorSearch("");
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredColors([]);
                            }
                          }}
                          className={`w-full px-1 py-1.5 border rounded text-xs h-8 ${getColorClass(order.paperColor)}`}
                          placeholder="Color..."
                        />
                        {activeRowIndex === index && activeField === 'color' &&
                          filteredColors.length > 0 && (
                            <div className="mt-1 w-full rounded border bg-white shadow-lg">
                              {filteredColors.map((colorName) => {
                                const color = PAPER_COLORS.find(
                                  (c) => c.name === colorName,
                                );
                                return (
                                  <button
                                    key={colorName}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      if (color) {
                                        updateOrderField(
                                          order.id,
                                          "paperColor",
                                          color,
                                        );
                                      }
                                      setFilteredColors([]);
                                      setActiveRowIndex(-1);
                              setActiveField(null);
                                    }}
                                    className={`flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-blue-50 ${color?.cssClass}`}
                                  >
                                    <span>{colorName}</span>
                                    <span className="text-gray-500">
                                      £{color?.basePrice}/sheet
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1 rounded border bg-white px-1 text-xs">
                          <span className="text-gray-500">A</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={getPaperSizeDigits(order.size)}
                            onChange={(e) =>
                              updateOrderField(
                                order.id,
                                "size",
                                normalizePaperSize(e.target.value),
                              )
                            }
                            className="w-full py-1.5 text-xs h-8 outline-none"
                            placeholder="5"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.verseSize}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "verseSize",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) => {
                            occasionInputRefs.current[order.id] = el}
                          }
                          type="text"
                          value={order.occasion}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateOrderField(order.id, "occasion", value);
                            setOccasionSearch(value);
                            setFilteredOccasions(fuzzySearch(value, OCCASIONS));
                            setActiveRowIndex(index);
                            setActiveField('occasion');
                          }}
                          onFocus={(e) => {
                            setOccasionSearch(e.target.value);
                            setFilteredOccasions(
                              e.target.value ? fuzzySearch(e.target.value, OCCASIONS) : OCCASIONS
                            );
                            setActiveRowIndex(index);
                            setActiveField('occasion');
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredOccasions([]);
                              setOccasionSearch("");
                            }, 200);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && filteredOccasions.length > 0) {
                              // Auto-populate with top match on Tab
                              updateOrderField(order.id, "occasion", filteredOccasions[0]);
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredOccasions([]);
                            } else if (e.key === 'Enter' && filteredOccasions.length > 0) {
                              // Select the first match on Enter
                              e.preventDefault();
                              updateOrderField(order.id, "occasion", filteredOccasions[0]);
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredOccasions([]);
                            } else if (e.key === 'Escape') {
                              setActiveRowIndex(-1);
                              setActiveField(null);
                              setFilteredOccasions([]);
                            }
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Occasion..."
                        />
                        {activeRowIndex === index && activeField === 'occasion' &&
                          filteredOccasions.length > 0 && (
                            <div className="mt-1 max-h-32 w-full overflow-y-auto rounded border bg-white shadow-lg">
                              {filteredOccasions.map((occasion) => (
                                <button
                                  key={occasion}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateOrderField(order.id, "occasion", occasion);
                                    setFilteredOccasions([]);
                                    setActiveRowIndex(-1);
                              setActiveField(null);
                                  }}
                                  className="block w-full text-left px-2 py-1 hover:bg-blue-50 text-xs"
                                >
                                  {occasion}
                                </button>
                              ))}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center">
                          <span className="mr-0.5 text-gray-500">£</span>
                          <input
                            type="text"
                            value={order.price}
                            onChange={(e) =>
                              updateOrderField(
                                order.id,
                                "price",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={order.available}
                            onChange={(e) =>
                              updateOrderField(
                                order.id,
                                "available",
                                e.target.checked,
                              )
                            }
                            className="sr-only peer"
                          />
                          <div className="w-6 h-3 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-2 after:w-2.5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={order.status}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "status",
                              e.target.value as OrderStatus,
                            )
                          }
                          className={`w-full px-1 py-1.5 rounded text-xs font-medium h-8 ${getStatusColor(order.status)}`}
                        >
                          <option value="passive">Passive</option>
                          <option value="ordered">Ordered</option>
                          <option value="pending_inventory">Pending</option>
                          <option value="WIP">WIP</option>
                          <option value="sent">Sent</option>
                          <option value="approved">Approved</option>
                          <option value="failed">Failed</option>
                          <option value="deleted">Deleted</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      ID
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Action buttons below table */}
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="flex gap-2">
                <button
                  onClick={handleAddOrder}
                  className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium"
                  title="Add Order (Ctrl+N)"
                >
                  + Add Order
                </button>
                <button
                  onClick={() => setOrders(deleteRecentOrder(orders))}
                  className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 text-xs font-medium"
                  title="Delete newest passive order (Ctrl+Z)"
                >
                  Delete New Order
                </button>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+N: New
                </span>
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+Z: Delete New
                </span>
              </div>
            </div>

            {/* Suggested Orders Section */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Suggested Orders
              </h3>
              <div className="space-y-2">
                <div className="rounded border border-blue-200 bg-blue-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-blue-800">
                        Required Paper For Current Schedule
                      </div>
                      <div className="text-[11px] text-blue-700">
                        {currentSchedulePaperRequirements.length
                          ? "Paper needed to fulfill the current production schedule."
                          : "Current schedule can be fulfilled with inventory and pending deliveries."}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        registerPaperRequirements(
                          schedulerSuggestions?.currentSchedule?.requiredPapers,
                          "Current schedule paper order",
                        )
                      }
                      disabled={
                        !currentSchedulePaperRequirements.length ||
                        buyingCooldownRemainingSeconds > 0
                      }
                      className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {buyingCooldownRemainingSeconds > 0
                        ? `Cooldown ${formatTime(buyingCooldownRemainingSeconds)}`
                        : "Order"}
                    </button>
                  </div>
                  <div className="mt-2 space-y-1">
                    {currentSchedulePaperRequirements.map((requirement) => (
                      <div
                        key={`current-${requirement.colorCode}`}
                        className="flex items-center justify-between rounded border border-blue-100 bg-white px-2 py-1 text-[11px]"
                      >
                        <div>
                          <span className="font-semibold">
                            {getColorName(requirement.colorCode)}
                          </span>{" "}
                          need {requirement.totalNeeded}
                        </div>
                        <div className="text-blue-700">
                          In stock {requirement.currentInventory} | Pending{" "}
                          {requirement.pendingDelivery} | Orders{" "}
                          {requirement.orderRequirement}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {showSuggestedPaperRequirements && (
                  <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-emerald-800">
                          Required Paper For Suggested Schedule
                        </div>
                        <div className="text-[11px] text-emerald-700">
                          {suggestedSchedulePaperRequirements.length
                            ? "Paper needed if you import the suggested schedule."
                            : "Suggested schedule does not need additional paper."}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            schedulerSuggestions?.bestSuggestion &&
                            setClearedSuggestedPaperPlanId(
                              schedulerSuggestions.bestSuggestion.id,
                            )
                          }
                          className="rounded bg-white px-2 py-1 text-[11px] font-medium text-emerald-700"
                        >
                          Clear
                        </button>
                        <button
                          onClick={acceptAndOrderSuggestedPlan}
                          disabled={suggestedPlanActionDisabled}
                          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
                        >
                          {suggestedPlanNeedsPaperOrder &&
                          buyingCooldownRemainingSeconds > 0
                            ? `Cooldown ${formatTime(buyingCooldownRemainingSeconds)}`
                            : "Accept and Order"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {suggestedSchedulePaperRequirements.map((requirement) => (
                        <div
                          key={`suggested-${requirement.colorCode}`}
                          className="flex items-center justify-between rounded border border-emerald-100 bg-white px-2 py-1 text-[11px]"
                        >
                          <div>
                            <span className="font-semibold">
                              {getColorName(requirement.colorCode)}
                            </span>{" "}
                            need {requirement.totalNeeded}
                          </div>
                          <div className="text-emerald-700">
                            In stock {requirement.currentInventory} | Pending{" "}
                            {requirement.pendingDelivery} | Orders{" "}
                            {requirement.orderRequirement}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                  Delivery / pending time is {paperDeliverySeconds} seconds ({paperDeliverySeconds / 60} minutes). Buying cooldown is{" "}
                  {buyingCooldown / 60} minutes. Suggested schedule timing now
                  includes procurement delay when extra paper must be bought.
                </div>
              </div>
            </div>

            {/* Scheduler Suggestions */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Scheduler Suggestions
              </h3>
              <div className="space-y-2">
                <div className="rounded border border-green-200 bg-green-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-green-800">
                        Best Plan
                      </div>
                      <div className="text-[11px] text-green-700">
                        {schedulerSuggestions?.bestSuggestion
                          ? describeSchedule(schedulerSuggestions.bestSuggestion)
                          : "No schedulable plan available yet."}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-green-900">
                      <div>
                        Profit: £
                        {schedulerSuggestions?.bestSuggestion?.expectedProfit.toFixed(2) ??
                          "0.00"}
                      </div>
                      <div>
                        Busy:{" "}
                        {formatDurationCompact(
                          schedulerSuggestions?.bestSuggestion?.expectedBusyMs ?? 0,
                        )}
                      </div>
                      <div>
                        Rate:{" "}
                        {formatProfitPerSecond(
                          schedulerSuggestions?.bestSuggestion?.profitPerSecond ?? 0,
                        )}
                      </div>
                      <div>
                        Plan Success:{" "}
                        {formatSuccessRate(
                          schedulerSuggestions?.bestSuggestion ?? null,
                        )}
                      </div>
                      <div>
                        Expected Total Profit:{" "}
                        {formatCurrency(
                          planForecastSummaries.bestPlan?.expectedTotalProfit ?? 0,
                        )}
                      </div>
                      <div>
                        Idle £/min:{" "}
                        {formatCurrency(
                          planForecastSummaries.bestPlan?.expectedProfitPerIdleMinute ?? 0,
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-gray-200 bg-gray-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-gray-700">
                      <div className="font-semibold text-gray-800">Current Plan</div>
                      <div>{describeSchedule(schedulerSuggestions?.currentSchedule ?? null)}</div>
                    </div>
                    <div className="text-right text-[11px] text-gray-700">
                      <div>
                        Profit: £
                        {schedulerSuggestions?.currentSchedule?.expectedProfit.toFixed(2) ??
                          "0.00"}
                      </div>
                      <div>
                        Busy:{" "}
                        {formatDurationCompact(
                          schedulerSuggestions?.currentSchedule?.expectedBusyMs ?? 0,
                        )}
                      </div>
                      <div>
                        Rate:{" "}
                        {formatProfitPerSecond(
                          schedulerSuggestions?.currentSchedule?.profitPerSecond ?? 0,
                        )}
                      </div>
                      <div>
                        Plan Success:{" "}
                        {formatSuccessRate(
                          schedulerSuggestions?.currentSchedule ?? null,
                        )}
                      </div>
                      <div>
                        Expected Total Profit:{" "}
                        {formatCurrency(
                          planForecastSummaries.currentPlan?.expectedTotalProfit ?? 0,
                        )}
                      </div>
                      <div>
                        Idle £/min:{" "}
                        {formatCurrency(
                          planForecastSummaries.currentPlan?.expectedProfitPerIdleMinute ?? 0,
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-gray-200 bg-white p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-800">
                      Top Alternatives
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {schedulerSuggestions?.evaluatedCandidateCount ?? 0} plans
                      checked
                    </div>
                  </div>
                  {schedulerSuggestions?.suggestions.length ? (
                    <div className="space-y-1">
                      {schedulerSuggestions.suggestions.slice(0, 3).map((schedule) => (
                        <div
                          key={schedule.id}
                          className="rounded border border-gray-200 bg-gray-50 p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] text-gray-800">
                              <span className="font-semibold">#{schedule.rank}</span>{" "}
                              {describeSchedule(schedule)}
                            </div>
                            <div className="text-right text-[11px] text-gray-600">
                              <div>{formatProfitPerSecond(schedule.profitPerSecond)}</div>
                              <div>£{schedule.expectedProfit.toFixed(2)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-500">
                      No candidate schedules available.
                    </div>
                  )}
                </div>

                {schedulerSuggestions?.warning && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    {schedulerSuggestions.warning}
                  </div>
                )}
              </div>
            </div>

            {/* Accept Button */}
            <div className="flex justify-center pb-2">
              <button
                onClick={acceptAndOrderSuggestedPlan}
                disabled={suggestedPlanActionDisabled}
                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-xs font-medium"
              >
                {currentScheduleMatchesSuggestion
                  ? "Current Schedule Already Best"
                  : suggestedPlanNeedsPaperOrder &&
                      buyingCooldownRemainingSeconds > 0
                    ? `Cooldown ${formatTime(buyingCooldownRemainingSeconds)}`
                    : "Accept and Order"}
              </button>
            </div>
          </div>
        </div>
        {/* Draggable Divider */}
        <div
          ref={dividerRef}
          className="w-1 bg-gray-400 hover:bg-gray-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />

        {/* Right Pane - Production Schedule */}
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
                onReorderSchedule={(nextOrderIds) => {
                  setScheduleOrderIds(nextOrderIds);
                  gameState.updateScheduleOrderIds(nextOrderIds);
                }}
                currentTime={currentTime}
              />
            </div>
          </div>
        </div>
          </div>

          {/* Full-width sections below the two panes - Only for operations view */}
          <div className="bg-white border-t border-gray-300">
        <div className="p-2">
          <h2 className="text-base font-bold text-gray-800 mb-2">
            Inventory Management System
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Paper Tracked Inventory
              </h3>
              <table className="w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="px-1 py-0.5 text-left">Color</th>
                    <th className="px-1 py-0.5 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(paperInventory).map(([color, quantity]) => (
                    <tr key={color} className="border-b">
                      <td className="px-1 py-0.5">
                        <div className="flex items-center gap-1">
                          <div
                            className={`w-3 h-3 rounded ${getColorClass(color)}`}
                          />
                          <span className="font-medium">
                            {getColorName(color)}
                          </span>
                          <span className="text-gray-500 text-xs">
                            (£{getColorPrice(color)})
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-0.5 text-right font-mono">
                        {quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td className="px-1 py-0.5">Total</td>
                    <td className="px-1 py-0.5 text-right font-mono">
                      {Object.values(paperInventory).reduce(
                        (sum, qty) => sum + qty,
                        0,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Cash Transactions Ledger
              </h3>
              <div className="mb-2">
                <table className="w-full text-xs">
                  <thead className="bg-gray-200 sticky top-0">
                    <tr>
                      <th className="px-1 py-0.5 text-left">Revenue</th>
                      <th className="px-1 py-0.5 text-left">Type</th>
                      <th className="px-1 py-0.5 text-left">Reason</th>
                      <th className="px-1 py-0.5 text-left">Status</th>
                      <th className="px-1 py-0.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .slice(-10)
                      .reverse()
                      .map((trans) => (
                        <tr
                          key={`${trans.id}-${trans.arrivalTime ?? trans.timestamp.toISOString()}-${trans.reason ?? ""}`}
                          className="border-b"
                        >
                          <td
                            className={`px-1 py-0.5 font-mono ${trans.amount >= 0 ? "text-green-600" : "text-red-600"}`}
                          >
                            {editingTransactionId === trans.id ? (
                              <input
                                type="number"
                                step="0.01"
                                value={trans.amount}
                                onChange={(e) => editTransaction(trans.id, { amount: parseFloat(e.target.value) || 0 })}
                                className="w-20 px-1 border rounded text-xs"
                              />
                            ) : (
                              <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                £{trans.amount.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5">
                            {trans.type === "paper" && trans.paperColor ? (
                              editingTransactionId === trans.id ? (
                                <div className="flex gap-1">
                                  <select
                                    value={trans.paperColor}
                                    onChange={(e) => editTransaction(trans.id, { paperColor: e.target.value })}
                                    className="w-12 px-1 border rounded text-xs"
                                  >
                                    {PAPER_COLORS.map(color => (
                                      <option key={color.code} value={color.code}>{color.code}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    value={trans.paperQuantity || 0}
                                    onChange={(e) => editTransaction(trans.id, { paperQuantity: parseInt(e.target.value) || 0 })}
                                    className="w-12 px-1 border rounded text-xs"
                                  />
                                </div>
                              ) : (
                                <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                  {trans.paperColor}:{trans.paperQuantity}
                                </span>
                              )
                            ) : editingTransactionId === trans.id ? (
                              <select
                                value={trans.type}
                                onChange={(e) => editTransaction(trans.id, { 
                                  type: e.target.value as "cash" | "paper" | "inventory",
                                  paperColor: e.target.value === "paper" ? trans.paperColor : undefined,
                                  paperQuantity: e.target.value === "paper" ? trans.paperQuantity : undefined
                                })}
                                className="w-20 px-1 border rounded text-xs"
                              >
                                <option value="cash">Cash</option>
                                <option value="inventory">Inventory</option>
                                <option value="paper">Paper</option>
                              </select>
                            ) : (
                              <span 
                                onClick={() => setEditingTransactionId(trans.id)} 
                                className="cursor-pointer"
                              >
                                {trans.type === "inventory" ? "Inventory" : trans.type === "paper" ? "Paper" : "Cash"}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {editingTransactionId === trans.id ? (
                              <input
                                type="text"
                                value={trans.reason || ""}
                                onChange={(e) => editTransaction(trans.id, { reason: e.target.value })}
                                className="w-full px-1 border rounded text-xs"
                              />
                            ) : (
                              <span onClick={() => setEditingTransactionId(trans.id)} className="cursor-pointer">
                                {trans.reason || ""}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {trans.pending ? (
                              <span 
                                onClick={() => completePendingTransaction(trans.id)}
                                className="cursor-pointer text-yellow-600 hover:text-yellow-800"
                              >
                                {trans.arrivalTime ? (
                                  <>
                                    Pending ({Math.max(0, Math.ceil((trans.arrivalTime - currentTime) / 1000))}s)
                                  </>
                                ) : "Pending"}
                              </span>
                            ) : (
                              <span className="text-green-600">✓</span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            {editingTransactionId === trans.id ? (
                              <button
                                onClick={() => setEditingTransactionId(null)}
                                className="px-1 py-0.5 bg-green-500 text-white rounded text-xs"
                              >
                                ✓
                              </button>
                            ) : (
                              <button
                                onClick={() => deleteTransaction(trans.id)}
                                className="px-1 py-0.5 text-gray-500 hover:text-gray-700 text-xs"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Add Transaction Forms */}
              <div className="space-y-1">
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Revenue"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashAmount"
                  />
                  <input
                    type="text"
                    placeholder="Reason"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashReason"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      id="affectsInventory"
                      className="rounded"
                    />
                    <span>Inventory</span>
                  </label>
                  <button
                    onClick={() => {
                      const amount = parseFloat(
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const reason =
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value || "Cash transaction";
                      const isInventory = (
                        document.getElementById(
                          "affectsInventory",
                        ) as HTMLInputElement
                      ).checked;
                      if (amount) {
                        addTransaction(
                          amount,
                          reason,
                          isInventory ? "inventory" : "cash",
                        );
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "affectsInventory",
                          ) as HTMLInputElement
                        ).checked = false;
                      }
                    }}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs"
                  >
                    Add Cash
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <input
                    type="number"
                    placeholder="Qty"
                    className="w-16 px-1 py-0.5 border rounded text-xs"
                    id="paperQty"
                    onChange={() => {
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      const colorInput = document.getElementById(
                        "paperColorInput",
                      ) as HTMLInputElement;
                      const colorName = colorInput?.value;
                      const color = PAPER_COLORS.find(
                        (c) =>
                          c.name.toLowerCase() === colorName?.toLowerCase(),
                      );
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Color"
                    className="w-24 px-1 py-0.5 border rounded text-xs"
                    id="paperColorInput"
                    list="paperColorsList"
                    onChange={(e) => {
                      const colorName = e.target.value;
                      const color = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <datalist id="paperColorsList">
                    {PAPER_COLORS.map((color) => (
                      <option key={color.code} value={color.name} />
                    ))}
                  </datalist>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Cost"
                    className="w-20 px-1 py-0.5 border rounded text-xs"
                    id="paperCost"
                  />
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="paperReason"
                  />
                  <div className="flex items-center px-2 text-[11px] text-gray-500">
                    Pending {paperDeliverySeconds}s
                  </div>
                  <button
                    onClick={() => {
                      const qty = parseInt(
                        (
                          document.getElementById(
                            "paperQty",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const colorName = (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value;
                      const colorMatch = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );

                      if (!colorMatch) {
                        alert("Please select a valid color");
                        return;
                      }

                      // Allow any quantity including 0 (for theft) or negative (for returns)

                      const costInput = parseFloat(
                        (document.getElementById("paperCost") as HTMLInputElement).value
                      );
                      const cost = costInput ? -Math.abs(costInput) : -Math.abs(qty * colorMatch.basePrice);
                      const reason =
                        (
                          document.getElementById(
                            "paperReason",
                          ) as HTMLInputElement
                        ).value || `Bought ${qty} sheets of ${colorMatch.name}`;
                      
                      const deliveryMs = paperDeliverySeconds * 1000;

                      // Create pending transaction for paper purchases
                      addTransaction(cost, reason, "paper", colorMatch.code, qty, undefined, true, deliveryMs);
                      gameState.startBuyingCooldown(buyingCooldown);

                      // Clear form
                      (
                        document.getElementById("paperQty") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById("paperCost") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperReason",
                        ) as HTMLInputElement
                      ).value = "";
                    }}
                    className="px-2 py-0.5 bg-green-600 text-white rounded text-xs"
                  >
                    Buy Paper
                  </button>
                </div>
              </div>

              {/* Overrides Section */}
              <div className="mt-2 pt-2 border-t">
                <h4 className="text-xs font-semibold mb-1">Overrides</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Cooldown:</span>
                    <button
                      onClick={() => {
                        if (gameState.isBuyingOnCooldown()) {
                          gameState.clearBuyingCooldown();
                        } else {
                          gameState.startBuyingCooldown(buyingCooldown);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        gameState.isBuyingOnCooldown()
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-green-500 hover:bg-green-600 text-white"
                      }`}
                    >
                      {gameState.isBuyingOnCooldown() ? "Stop" : "Start"}
                    </button>
                    <button
                      onClick={() => gameState.clearBuyingCooldown()}
                      className="px-2 py-0.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs"
                    >
                      Reset
                    </button>
                    <span className="text-xs font-mono w-12 text-center">
                      {formatTime(gameState.getBuyingCooldownRemaining())}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Safety Stock:</span>
                    <input
                      type="number"
                      value={safetyStock}
                      onChange={(e) => setSafetyStock(parseInt(e.target.value))}
                      className="w-16 px-1 py-0.5 border rounded text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Workstation Controls
              </h3>
              <div className="space-y-3">
                <div className="text-[11px] text-gray-600">
                  Station performance overrides sync through shared parameters. Range is
                  `0.0` to `1.5`, where `1.0` is expected pace.
                </div>
                <div className="flex items-end justify-around rounded bg-white px-2 py-3">
                  {STATION_CONTROL_CONFIG.map((stationControl) => {
                    const sliderValue =
                      stationSpeedMultipliers[stationControl.key] ?? 1;

                    return (
                      <div
                        key={stationControl.stationId}
                        className="flex w-16 flex-col items-center gap-2"
                      >
                        <div className="text-xs font-semibold text-gray-700">
                          {stationControl.label}
                        </div>
                        <span className="text-[11px] font-mono text-gray-500">
                          {sliderValue.toFixed(2)}x
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1.5"
                          step="0.05"
                          value={sliderValue}
                          onChange={(e) =>
                            updateStationSpeedMultiplier(
                              stationControl.key,
                              parseFloat(e.target.value),
                            )
                          }
                          className="h-32 w-32 -rotate-90 accent-blue-600"
                          aria-label={`${stationControl.label} performance`}
                        />
                        <div className="flex w-full justify-between text-[10px] text-gray-400">
                          <span>0</span>
                          <span>1.5</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] text-gray-500">
                  `StationManager` itself is still local runtime state. Only these
                  mirrored station multipliers are shared/synced right now.
                </div>
              </div>
            </div>

            <div className="col-span-3 rounded bg-gray-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    All Game Parameters
                  </h3>
                  <div className="text-[11px] text-gray-600">
                    These values are live controls for game day. They sync through
                    shared parameters.
                  </div>
                </div>
                <div className="text-[11px] text-gray-500">
                  Cooldown remaining: {formatTime(gameState.getBuyingCooldownRemaining())}
                </div>
              </div>

              <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Device Scheduler</div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">
                      Run exhaustive plan search on this device
                    </span>
                    <input
                      type="checkbox"
                      checked={schedulerEnabled}
                      onChange={(e) => setSchedulerEnabled(e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                  </div>
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Lite Forecast</div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">
                      Run idle-profit estimates on this device
                    </span>
                    <input
                      type="checkbox"
                      checked={liteForecastEnabled}
                      onChange={(e) => setLiteForecastEnabled(e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                  </div>
                </label>
                <div className="rounded bg-white p-2 text-gray-500">
                  Delivery / pending time is controlled below as
                  <span className="font-medium text-gray-700"> Paper Delivery (s)</span>.
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs">
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Workstation Speed</div>
                  <input
                    type="number"
                    step="0.05"
                    value={workstationSpeed}
                    onChange={(e) =>
                      setWorkstationSpeed(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Safety Stock</div>
                  <input
                    type="number"
                    value={safetyStock}
                    onChange={(e) =>
                      setSafetyStock(parseInt(e.target.value, 10) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Buying Cooldown (s)</div>
                  <input
                    type="number"
                    value={buyingCooldown}
                    onChange={(e) =>
                      setBuyingCooldown(parseInt(e.target.value, 10) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Paper Delivery / Pending Time (s)</div>
                  <input
                    type="number"
                    value={paperDeliverySeconds}
                    onChange={(e) =>
                      setPaperDeliverySeconds(parseInt(e.target.value, 10) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Sell Markdown</div>
                  <input
                    type="number"
                    step="0.01"
                    value={sellMarkdown}
                    onChange={(e) =>
                      setSellMarkdown(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>

                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Failure Fine Ratio</div>
                  <input
                    type="number"
                    step="0.01"
                    value={failureFineRatio}
                    onChange={(e) =>
                      setFailureFineRatio(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Colour Love Multiplier</div>
                  <input
                    type="number"
                    step="0.05"
                    value={colourLoveMultiplier}
                    onChange={(e) =>
                      setColourLoveMultiplier(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">White Love Multiplier</div>
                  <input
                    type="number"
                    step="0.05"
                    value={whiteLoveMultiplier}
                    onChange={(e) =>
                      setWhiteLoveMultiplier(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Standard Time Ratio</div>
                  <input
                    type="number"
                    step="0.05"
                    value={standardTimeRatio}
                    onChange={(e) =>
                      setStandardTimeRatio(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>

                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Greedometer</div>
                  <input
                    type="number"
                    step="0.05"
                    min="-1"
                    max="1"
                    value={greedometer}
                    onChange={(e) =>
                      setGreedometer(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="rounded bg-white p-2">
                  <div className="mb-1 font-medium text-gray-700">Forecast Speed</div>
                  <input
                    type="number"
                    step="0.05"
                    value={forecastSpeed}
                    onChange={(e) =>
                      setForecastSpeed(parseFloat(e.target.value) || 0)
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                {STATION_CONTROL_CONFIG.map((stationControl) => (
                  <label
                    key={`param-${stationControl.stationId}`}
                    className="rounded bg-white p-2"
                  >
                    <div className="mb-1 font-medium text-gray-700">
                      {stationControl.label} Multiplier
                    </div>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1.5"
                      value={stationSpeedMultipliers[stationControl.key] ?? 1}
                      onChange={(e) =>
                        updateStationSpeedMultiplier(
                          stationControl.key,
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full rounded border px-2 py-1"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-700">Cooldown Control</span>
                  <button
                    onClick={() => gameState.startBuyingCooldown(buyingCooldown)}
                    className="rounded bg-yellow-600 px-2 py-1 font-medium text-white hover:bg-yellow-700"
                  >
                    Start Cooldown
                  </button>
                  <button
                    onClick={() => gameState.clearBuyingCooldown()}
                    className="rounded bg-gray-600 px-2 py-1 font-medium text-white hover:bg-gray-700"
                  >
                    Clear Cooldown
                  </button>
                </div>
                <div className="text-gray-500">Reminder: add charts if possible.</div>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  onClick={resetGameState}
                  className="rounded bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Reset Game
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
        </>
      ) : (
        /* Station Views */
        <div className="h-screen bg-gray-100">
          <StationView
            stationNumber={currentView === "station1" ? 1 : currentView === "station2" ? 2 : 3}
            orders={orders}
            setOrders={setOrders}
            updateOrderField={updateOrderField}
            scheduleOrderIds={scheduleOrderIds}
            currentTime={currentTime}
            stationSpeedMultipliers={stationSpeedMultipliers}
            updateStationSpeedMultiplier={updateStationSpeedMultiplier}
          />
        </div>
      )}

      {/* New Color Creation Dialog - Always rendered regardless of view */}
      {showNewColorDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 max-w-md w-full">
            <h3 className="text-lg font-bold mb-3">Create New Paper Color</h3>
            <p className="text-sm text-gray-600 mb-4">
              The color "{newColorName}" doesn't exist. Would you like to create it?
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Color Name</label>
                <input
                  type="text"
                  value={newColorName}
                  onChange={(e) => setNewColorName(e.target.value)}
                  className="w-full px-2 py-1 border rounded text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Price per Sheet (£)</label>
                <input
                  type="number"
                  value={newColorPrice}
                  onChange={(e) => setNewColorPrice(parseFloat(e.target.value) || 20)}
                  min="0"
                  step="0.5"
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </div>
              <div className="text-xs text-gray-500">
                CSS class will be auto-generated as: bg-gray-100
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  // Create the new color
                  const colorCode = newColorName.substring(0, 2).toLowerCase();
                  const newColor = new PaperColor(
                    colorCode,
                    newColorName,
                    "bg-gray-100", // Default CSS class for new colors
                    newColorPrice
                  );
                  
                  gameState.addPaperColor(newColor);
                  
                  // Update the pending order with the new color
                  if (pendingColorOrderId) {
                    updateOrderField(pendingColorOrderId, "paperColor", newColor);
                  }
                  
                  // Close dialog and reset
                  setShowNewColorDialog(false);
                  setNewColorName("");
                  setNewColorPrice(20);
                  setPendingColorOrderId(null);
                }}
                className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
              >
                Create Color
              </button>
              <button
                onClick={() => {
                  setShowNewColorDialog(false);
                  setNewColorName("");
                  setNewColorPrice(20);
                  setPendingColorOrderId(null);
                }}
                className="flex-1 px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
