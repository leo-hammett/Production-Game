import {
  useState,
  useEffect,
  useRef,
  useEffectEvent,
  type ChangeEvent,
} from "react";
import "./App.css";
import type {
  Order,
  OrderStatus,
} from "./utils/gameState";
import {
  allocatePaperForOrderIfNeeded,
  addOrder,
  createOrderAllocationTransactions,
  deleteRecentOrder,
  hasInventoryForOrder,
  normalizeScheduleOrderIds,
  updateOrder,
} from "./utils/orders";
import { ProductionSchedule } from "./components/ProductionSchedule";
import { StationView } from "./components/StationView";
import { TitleCenteringTool } from "./components/TitleCenteringTool";
import type {
  PaperInventory,
  Transaction,
  TransactionMetadata,
} from "./utils/gameState";
import { useAmplifySharedGameState } from "./hooks/useAmplifySharedGameState";
import {
  ENVELOPE_CODE,
  ENVELOPE_ITEM,
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
import {
  DEFAULT_TEAM_ID,
  TEAM_ID_STORAGE_KEY,
  buildSharedGameSnapshot,
  deserializeSharedGameSnapshot,
} from "./utils/sharedGameState";
import {
  downloadSnapshotCsvExports,
  downloadSnapshotJson,
  readSnapshotFile,
} from "./utils/backup";
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
import {
  buildFinancialHistory,
  calculateFinancialMetrics,
  getTransactionCategoryLabel,
  isManualTransaction,
  resolveTransactionMetadata,
  transactionAffectsTrackedInventory,
} from "./utils/financials";

type ViewType = "operations" | "station1" | "station2" | "station3";
const SCHEDULER_ENABLED_STORAGE_KEY = "production-game/device-enable-scheduler";
const LITE_FORECAST_ENABLED_STORAGE_KEY =
  "production-game/device-enable-lite-forecast";
const AUTO_BACKUP_ENABLED_STORAGE_KEY =
  "production-game/device-enable-auto-backup";
const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const AUTO_BACKUP_IDLE_MS = 10 * 1000;

interface BackupStatusState {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  pendingSince: number | null;
  lastError: string | null;
  browserPermissionHintVisible: boolean;
}

interface DeliveryPrompt {
  id: string;
  title: string;
  message: string;
  orderIds: string[];
}

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

function formatTimestamp(value: number | null): string {
  if (!value) {
    return "never";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLedgerTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getTransactionStatusLabel(
  transaction: Transaction,
  currentTime: number,
): string {
  if (!transaction.pending) {
    return "Posted";
  }

  if (!transaction.arrivalTime) {
    return "Pending";
  }

  return `Pending ${Math.max(
    0,
    Math.ceil((transaction.arrivalTime - currentTime) / 1000),
  )}s`;
}

function buildChartPath(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): string {
  if (!points.length) {
    return "";
  }

  const values = points.map((point) => point.y);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  return points
    .map((point, index) => {
      const x =
        points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.y - minValue) / valueRange) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function SimpleLineChart({
  title,
  colorClass,
  points,
  valueSelector,
}: {
  title: string;
  colorClass: string;
  points: ReturnType<typeof buildFinancialHistory>;
  valueSelector: (point: ReturnType<typeof buildFinancialHistory>[number]) => number;
}) {
  const chartPoints = points.map((point) => ({
    x: point.timestamp,
    y: valueSelector(point),
  }));
  const values = chartPoints.map((point) => point.y);
  const currentValue = values.length ? values[values.length - 1] : 0;
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 0;
  const path = buildChartPath(chartPoints, 320, 120);

  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
          <div className="text-[11px] text-gray-500">
            {points.length
              ? `${points.length} transaction points`
              : "No transaction history yet"}
          </div>
        </div>
        <div className={`text-sm font-semibold ${colorClass}`}>
          {formatCurrency(currentValue)}
        </div>
      </div>
      <svg
        viewBox="0 0 320 120"
        className="h-32 w-full rounded bg-gray-50"
        role="img"
        aria-label={title}
      >
        <line x1="0" y1="119" x2="320" y2="119" stroke="#d1d5db" strokeWidth="1" />
        <line x1="0" y1="1" x2="0" y2="119" stroke="#d1d5db" strokeWidth="1" />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className={colorClass}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <text
            x="160"
            y="64"
            textAnchor="middle"
            className="fill-gray-400 text-[11px]"
          >
            Waiting for transactions
          </text>
        )}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-gray-500">
        <span>Min {formatCurrency(minValue)}</span>
        <span>Max {formatCurrency(maxValue)}</span>
      </div>
    </div>
  );
}

function isSchedulerInventoryTransaction(reason: string | undefined): boolean {
  if (!reason) {
    return false;
  }

  return (
    reason.includes("Suggested schedule stock order") ||
    reason.includes("Current schedule stock order") ||
    reason.includes("Suggested schedule paper order") ||
    reason.includes("Current schedule paper order")
  );
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

  const [orders, setOrders] = useState<Order[]>(() => [...gameState.getOrders()]);
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

  // Inventory Management State
  const [paperInventory, setPaperInventory] = useState<PaperInventory>(() => ({
    ...gameState.getPaperInventory(),
  }));
  const trackedInventoryItems = [...PAPER_COLORS, ENVELOPE_ITEM];
  const [transactions, setTransactions] = useState<Transaction[]>(() => [
    ...gameState.getTransactions(),
  ]);
  const [cash, setCash] = useState(() => gameState.getCash());
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
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const schedulerTimeBucket = Math.floor(currentTime / 30000) * 30000;
  const liteForecastMinuteBucket = Math.floor(currentTime / 60000) * 60000;
  const liteForecastTimeoutRef = useRef<number | null>(null);
  const liteForecastIdleCallbackRef = useRef<number | null>(null);
  const lastLiteForecastMinuteBucketRef = useRef<number | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const autoBackupTimerRef = useRef<number | null>(null);
  const autoBackupDueAtRef = useRef<number>(Date.now() + AUTO_BACKUP_INTERVAL_MS);
  const lastUserActivityAtRef = useRef(Date.now());
  const [schedulerEnabled, setSchedulerEnabled] = useState(() =>
    getStoredBoolean(SCHEDULER_ENABLED_STORAGE_KEY, true),
  );
  const [liteForecastEnabled, setLiteForecastEnabled] = useState(() =>
    getStoredBoolean(LITE_FORECAST_ENABLED_STORAGE_KEY, true),
  );
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(() =>
    getStoredBoolean(AUTO_BACKUP_ENABLED_STORAGE_KEY, false),
  );
  const [backupStatus, setBackupStatus] = useState<BackupStatusState>({
    lastAttemptAt: null,
    lastSuccessAt: null,
    pendingSince: null,
    lastError: null,
    browserPermissionHintVisible: false,
  });
  const [deliveryPrompts, setDeliveryPrompts] = useState<DeliveryPrompt[]>([]);
  const [isSyncGuardActive, setIsSyncGuardActive] = useState(false);
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
    shouldDeferIncomingSync: isSyncGuardActive,
  });

  const buildSnapshotParameters = () => ({
    ...gameState.getParameters(),
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

  const createSnapshot = () =>
    buildSharedGameSnapshot({
      teamId,
      orders,
      paperInventory,
      transactions,
      cash,
      parameters: buildSnapshotParameters(),
      currentSchedule: gameState.getCurrentSchedule(),
      occasions: gameState.getOccasions(),
      paperColors: gameState.getPaperColors(),
    });

  const applyImportedSnapshot = (serializedSnapshot: ReturnType<typeof createSnapshot>) => {
    const nextState = deserializeSharedGameSnapshot({
      ...serializedSnapshot,
      teamId,
    });

    gameState.setTeamId(teamId);
    gameState.setPaperColors(nextState.paperColors);
    gameState.setOccasions(nextState.occasions);
    gameState.setCurrentSchedule(nextState.currentSchedule);
    gameState.updateParameters(nextState.parameters);
    setOrders(nextState.orders);
    setPaperInventory(nextState.paperInventory);
    setTransactions(nextState.transactions);
    setCash(nextState.cash);
    setSafetyStock(nextState.parameters.safetyStock);
    setWorkstationSpeed(nextState.parameters.workstationSpeed);
    setBuyingCooldown(nextState.parameters.buyingCooldown);
    setPaperDeliverySeconds(nextState.parameters.paperDeliverySeconds);
    setSellMarkdown(nextState.parameters.sellMarkdown);
    setFailureFineRatio(nextState.parameters.failureFineRatio);
    setColourLoveMultiplier(nextState.parameters.colourLoveMultiplier);
    setWhiteLoveMultiplier(nextState.parameters.whiteLoveMultiplier);
    setStandardTimeRatio(nextState.parameters.standardTimeRatio);
    setGreedometer(nextState.parameters.greedometer);
    setForecastSpeed(nextState.parameters.forecastSpeed);
    setStationSpeedMultipliers(nextState.parameters.stationSpeedMultipliers);
    setScheduleOrderIds([...nextState.currentSchedule.orderIds]);
    setSchedulerSuggestions(null);
    setPlanForecastSummaries({
      currentPlan: null,
      bestPlan: null,
    });
    setClearedSuggestedPaperPlanId(null);
    setDeliveryPrompts([]);
  };

  const triggerJsonBackupDownload = (mode: "manual" | "auto", date = new Date()) => {
    const timestamp = date.getTime();

    setBackupStatus((currentStatus) => ({
      ...currentStatus,
      lastAttemptAt: timestamp,
      lastError: null,
      browserPermissionHintVisible:
        currentStatus.browserPermissionHintVisible || mode === "auto",
    }));

    try {
      downloadSnapshotJson(createSnapshot(), { date, teamId });
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        pendingSince: null,
        lastError: null,
        browserPermissionHintVisible:
          currentStatus.browserPermissionHintVisible || mode === "auto",
      }));
      return true;
    } catch (error) {
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastAttemptAt: timestamp,
        lastError:
          error instanceof Error ? error.message : "Backup download failed.",
        browserPermissionHintVisible:
          currentStatus.browserPermissionHintVisible || mode === "auto",
      }));
      return false;
    }
  };

  const triggerCsvBackupDownload = () => {
    try {
      downloadSnapshotCsvExports(createSnapshot(), { teamId });
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastError: null,
      }));
    } catch (error) {
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastError:
          error instanceof Error ? error.message : "CSV export failed.",
      }));
    }
  };

  const openImportPicker = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) {
      return;
    }

    try {
      const snapshot = await readSnapshotFile(selectedFile);
      const importedTeamId = snapshot.teamId || "unknown team";
      const confirmed = window.confirm(
        `Import backup from ${importedTeamId}? This will replace the current ${teamId} state and sync it to the shared dashboard.`,
      );

      if (!confirmed) {
        return;
      }

      applyImportedSnapshot(snapshot);
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastError: null,
      }));
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Import failed.",
      );
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        lastError: error instanceof Error ? error.message : "Import failed.",
      }));
    }
  };

  const runAutoBackupCheck = useEffectEvent(() => {
    if (autoBackupTimerRef.current !== null) {
      window.clearTimeout(autoBackupTimerRef.current);
      autoBackupTimerRef.current = null;
    }

    if (!autoBackupEnabled) {
      return;
    }

    const now = Date.now();
    const dueAt = autoBackupDueAtRef.current;
    const idleForMs = now - lastUserActivityAtRef.current;

    if (now >= dueAt && idleForMs >= AUTO_BACKUP_IDLE_MS) {
      triggerJsonBackupDownload("auto", new Date(now));
      autoBackupDueAtRef.current = now + AUTO_BACKUP_INTERVAL_MS;
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        pendingSince: null,
      }));
      autoBackupTimerRef.current = window.setTimeout(() => {
        runAutoBackupCheck();
      }, AUTO_BACKUP_INTERVAL_MS);
      return;
    }

    if (now >= dueAt) {
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        pendingSince: currentStatus.pendingSince ?? dueAt,
      }));
      autoBackupTimerRef.current = window.setTimeout(() => {
        runAutoBackupCheck();
      }, Math.max(AUTO_BACKUP_IDLE_MS - idleForMs, 250));
      return;
    }

    setBackupStatus((currentStatus) =>
      currentStatus.pendingSince === null
        ? currentStatus
        : {
            ...currentStatus,
            pendingSince: null,
          },
    );
    autoBackupTimerRef.current = window.setTimeout(() => {
      runAutoBackupCheck();
    }, Math.max(dueAt - now, 250));
  });


  // Update order
  const updateOrderField = (id: string, field: keyof Order, value: unknown) => {
    const updatedOrders = updateOrder(
      orders,
      id,
      field,
      value,
      paperInventory,
      setPaperInventory,
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
      const remainingDrafts = { ...currentDrafts };
      delete remainingDrafts[order.id];
      return remainingDrafts;
    });
  };

  const createInventoryPurchaseTransactions = (
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
        `${label}: buy ${requirement.totalNeeded} ${getColorName(colorCode)} ${colorCode === ENVELOPE_CODE ? "envelopes" : "sheets"}`,
        "paper",
        colorCode,
        requirement.totalNeeded,
        undefined,
        true,
        paperDeliverySeconds * 1000,
        {
          category: "paper_purchase",
          financeBucket: "cost_of_sales",
          metricContribution: Math.abs(
            requirement.totalNeeded * getColorPrice(colorCode),
          ),
          inventoryValueDelta: 0,
        },
      ),
    );
  };

  const registerPaperRequirements = (
    requirements: RequiredPapers | undefined,
    label: string,
  ) => {
    const newTransactions = createInventoryPurchaseTransactions(requirements, label);
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
    let availablePaperByColor: Record<string, number> = { ...paperInventory };
    const allocationTransactions: Transaction[] = [];
    const nextStatusesByOrderId = new Map<
      string,
      {
        status: OrderStatus;
        progress: number;
        startTime: number;
        dueTime?: number;
        paperAllocated: boolean;
      }
    >();

    bestSuggestion.orderIds.forEach((orderId) => {
      const order = orderMap.get(orderId);
      if (!order || order.status !== "passive") {
        return;
      }

      const previewAllocation = allocatePaperForOrderIfNeeded(
        order,
        "WIP",
        availablePaperByColor,
      );
      if (previewAllocation.allocatedNow) {
        availablePaperByColor = previewAllocation.paperInventory;
        allocationTransactions.push(
          ...createOrderAllocationTransactions(
            previewAllocation.order,
            "inventory_allocation",
          ),
        );
      }

      const startTime = order.startTime ?? activationTime;
      nextStatusesByOrderId.set(orderId, {
        status: previewAllocation.allocatedNow ? "WIP" : "pending_inventory",
        progress: previewAllocation.allocatedNow ? Math.max(1, order.progress || 0) : 0,
        startTime,
        dueTime:
          order.dueTime ??
          (order.leadTime > 0 ? startTime + order.leadTime * 60 * 1000 : undefined),
        paperAllocated: previewAllocation.order.paperAllocated,
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
        paperAllocated: nextState.paperAllocated,
      };
    });

    const paperTransactions = createInventoryPurchaseTransactions(
      bestSuggestion.requiredPapers,
      "Suggested schedule stock order",
    );

    setOrders(nextOrders);
    setPaperInventory(availablePaperByColor);
    if (paperTransactions.length) {
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...allocationTransactions,
        ...paperTransactions,
      ]);
      setCash((currentCash) =>
        currentCash +
        paperTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      );
      gameState.startBuyingCooldown(buyingCooldown);
    } else if (allocationTransactions.length) {
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...allocationTransactions,
      ]);
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
    const isGuardedElement = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      Boolean(target.closest("[data-sync-guard='true']"));

    const handleFocusChange = (event: FocusEvent) => {
      if (isGuardedElement(event.target)) {
        setIsSyncGuardActive(true);
        return;
      }

      const nextFocusedElement = event.relatedTarget;
      setIsSyncGuardActive(isGuardedElement(nextFocusedElement));
    };

    window.addEventListener("focusin", handleFocusChange);
    window.addEventListener("focusout", handleFocusChange);

    return () => {
      window.removeEventListener("focusin", handleFocusChange);
      window.removeEventListener("focusout", handleFocusChange);
    };
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
    window.localStorage.setItem(
      AUTO_BACKUP_ENABLED_STORAGE_KEY,
      autoBackupEnabled ? "1" : "0",
    );
  }, [autoBackupEnabled]);

  useEffect(() => {
    const markUserActivity = () => {
      lastUserActivityAtRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "keydown",
      "mousedown",
      "pointerdown",
      "touchstart",
      "scroll",
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markUserActivity, { passive: true });
    });
    document.addEventListener("input", markUserActivity, true);
    document.addEventListener("change", markUserActivity, true);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markUserActivity);
      });
      document.removeEventListener("input", markUserActivity, true);
      document.removeEventListener("change", markUserActivity, true);
    };
  }, []);

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
    if (autoBackupTimerRef.current !== null) {
      window.clearTimeout(autoBackupTimerRef.current);
      autoBackupTimerRef.current = null;
    }

    if (!autoBackupEnabled) {
      setBackupStatus((currentStatus) => ({
        ...currentStatus,
        pendingSince: null,
      }));
      return;
    }

    lastUserActivityAtRef.current = Date.now();
    autoBackupDueAtRef.current = Date.now() + AUTO_BACKUP_INTERVAL_MS;
    setBackupStatus((currentStatus) => ({
      ...currentStatus,
      pendingSince: null,
      lastError: null,
    }));
    runAutoBackupCheck();

    return () => {
      if (autoBackupTimerRef.current !== null) {
        window.clearTimeout(autoBackupTimerRef.current);
        autoBackupTimerRef.current = null;
      }
    };
  }, [autoBackupEnabled]);

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
              return `#${orderId.slice(-6)}`;
            }

            const displayId = order.displayId || order.id.slice(-6);
            return `#${displayId}: ${order.quantity}x ${order.occasion || "Cards"} (${order.paperColor.code.toUpperCase()}) £${order.price.toFixed(2)}`;
          })
          .join(" -> ")
      : "No schedulable orders";
  const renderSchedulePriorityList = (
    schedule: RankedScheduleCandidate | null,
    tone: "green" | "gray" = "gray",
  ) => {
    if (!schedule?.orderIds.length) {
      return null;
    }

    const itemClass =
      tone === "green"
        ? "border-green-200 bg-white/70 text-green-900"
        : "border-gray-200 bg-white text-gray-700";
    const badgeClass =
      tone === "green"
        ? "bg-green-100 text-green-800"
        : "bg-gray-100 text-gray-700";

    return (
      <ol className="mt-2 space-y-1">
        {schedule.orderIds.map((orderId, index) => {
          const order = orderMap.get(orderId);
          const displayId = order?.displayId || order?.id.slice(-6) || orderId.slice(-6);
          const label = order
            ? `#${displayId}: ${order.quantity}x ${order.occasion || "Cards"} (${order.paperColor.code.toUpperCase()}) £${order.price.toFixed(2)}`
            : `#${orderId.slice(-6)}`;

          return (
            <li
              key={`${schedule.id}-${orderId}`}
              className={`flex items-center gap-2 rounded border px-2 py-1 text-[11px] ${itemClass}`}
            >
              <span className={`rounded px-1.5 py-0.5 font-bold ${badgeClass}`}>
                {index + 1}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
    );
  };
  const dismissDeliveryPrompt = (promptId: string) => {
    setDeliveryPrompts((currentPrompts) =>
      currentPrompts.filter((prompt) => prompt.id !== promptId),
    );
  };
  const queueDeliveryPrompt = (
    transaction: Transaction,
    nextInventory: PaperInventory,
  ) => {
    if (!isSchedulerInventoryTransaction(transaction.reason) || !transaction.paperColor) {
      return;
    }

    const suggestedOrders = orders.filter((order) => {
      if (
        order.status !== "pending_inventory" ||
        order.paperAllocated
      ) {
        return false;
      }

      const deliveryMatchesOrder =
        transaction.paperColor === ENVELOPE_CODE ||
        order.paperColor.code === transaction.paperColor;
      return deliveryMatchesOrder && hasInventoryForOrder(order, nextInventory);
    });

    if (!suggestedOrders.length) {
      return;
    }

    const promptId = `delivery-${transaction.id}`;
    setDeliveryPrompts((currentPrompts) => {
      if (currentPrompts.some((prompt) => prompt.id === promptId)) {
        return currentPrompts;
      }

      const prompt: DeliveryPrompt = {
        id: promptId,
        title: "Inventory delivery received",
        message:
          suggestedOrders.length === 1
            ? `Materials for ${suggestedOrders[0].quantity}x ${suggestedOrders[0].occasion || "Cards"} are now in stock. Consider changing its status from Pending.`
            : `${suggestedOrders.length} pending orders now have their materials in stock. Consider reviewing their status.`,
        orderIds: suggestedOrders.map((order) => order.id),
      };

      return [...currentPrompts, prompt];
    });
  };

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
  const isOperationsView = currentView === "operations";
  const financialMetrics = calculateFinancialMetrics(
    transactions,
    paperInventory,
    cash,
  );
  const financialHistory = buildFinancialHistory(transactions);
  const transactionsDescending = [...transactions].sort(
    (left, right) =>
      right.timestamp.getTime() - left.timestamp.getTime() ||
      right.id.localeCompare(left.id),
  );
  const backupStatusLabel = autoBackupEnabled
    ? backupStatus.pendingSince
      ? `Auto backup waiting for 10s idle since ${formatTimestamp(backupStatus.pendingSince)}`
      : `Auto backup on. Last backup ${formatTimestamp(backupStatus.lastSuccessAt)}`
    : "Auto backup off";
  const backupStatusClass = backupStatus.lastError
    ? "text-red-300"
    : autoBackupEnabled
      ? "text-green-300"
      : "text-gray-300";

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
    metadata?: TransactionMetadata,
  ) => {
    const newTransaction = gameState.createTransaction(
      amount,
      reason,
      type,
      paperColor,
      paperQuantity,
      orderId,
      pending,
      deliveryTime,
      metadata,
    );

    setTransactions((currentTransactions) => [...currentTransactions, newTransaction]);
    setCash((prev) => prev + amount);

    if (transactionAffectsTrackedInventory(newTransaction)) {
      setPaperInventory((prev) => ({
        ...prev,
        [paperColor!]: (prev[paperColor!] || 0) + (paperQuantity || 0),
      }));
    }
  };

  // Delete transaction
  const deleteTransaction = (id: string) => {
    const trans = transactions.find(t => t.id === id);
    if (!trans) return;
    if (!isManualTransaction(trans)) return;
    
    // Remove from transactions
    setTransactions(transactions.filter(t => t.id !== id));
    
    // Reverse the cash effect
    setCash((prev) => prev - trans.amount);
    
    if (transactionAffectsTrackedInventory(trans)) {
      setPaperInventory((prev) => ({
        ...prev,
        [trans.paperColor!]: (prev[trans.paperColor!] || 0) - (trans.paperQuantity || 0),
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
    setOrders([...gameState.getOrders()]);
    setPaperInventory({ ...gameState.getPaperInventory() });
    setTransactions([...gameState.getTransactions()]);
    setCash(gameState.getCash());
    setScheduleOrderIds([...gameState.getCurrentSchedule().orderIds]);
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
    setDeliveryPrompts([]);
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
    
    if (transactionAffectsTrackedInventory(updatedTrans)) {
      setPaperInventory((prev) => {
        const nextInventory = {
          ...prev,
          [trans.paperColor!]: (prev[trans.paperColor!] || 0) + trans.paperQuantity!,
        };
        queueDeliveryPrompt(trans, nextInventory);
        return nextInventory;
      });
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
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFileSelection}
      />

      {/* Cash Metrics Header Bar - Different colors for different views */}
      <div className={`text-white p-2 border-b border-gray-700 sticky top-0 z-40 ${
        currentView === "station1" ? "bg-blue-900" :
        currentView === "station2" ? "bg-green-900" :
        currentView === "station3" ? "bg-purple-900" :
        "bg-gray-900"
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 xl:grid-cols-5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Revenue:</span>
              <span className="text-sm font-bold text-green-400">
                {formatCurrency(financialMetrics.revenue)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Cost of Sales:</span>
              <span className="text-sm font-bold text-amber-300">
                {formatCurrency(financialMetrics.costOfSales)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Gross Profit:</span>
              <span
                className={`text-sm font-bold ${
                  financialMetrics.grossProfit >= 0 ? "text-blue-300" : "text-red-400"
                }`}
              >
                {formatCurrency(financialMetrics.grossProfit)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Operating Expenses:</span>
              <span className="text-sm font-bold text-orange-300">
                {formatCurrency(financialMetrics.operatingExpenses)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Net Profit:</span>
              <span
                className={`text-sm font-bold ${
                  financialMetrics.netProfit >= 0 ? "text-green-300" : "text-red-400"
                }`}
              >
                {formatCurrency(financialMetrics.netProfit)}
              </span>
            </div>
            <div className="col-span-2 flex items-center gap-2 xl:col-span-5">
              {/* Cash/Inventory info removed for cleaner header */}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-end gap-4">
            {/* Navigation Buttons */}
            <div className="flex flex-wrap gap-2">
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

            {isOperationsView ? (
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
            ) : (
              <div className="flex items-center border-l border-gray-600 pl-4">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
                    syncStatus.state === "synced"
                      ? "bg-green-500/20 text-green-300"
                      : syncStatus.state === "error"
                        ? "bg-red-500/20 text-red-300"
                        : "border-2 border-white/30 border-t-white text-transparent animate-spin"
                  }`}
                  title={syncStatus.message}
                  aria-label={syncStatus.message}
                >
                  {syncStatus.state === "synced"
                    ? "✓"
                    : syncStatus.state === "error"
                      ? "!"
                      : "."}
                </span>
              </div>
            )}
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
                <div className="mb-2 overflow-x-auto" data-sync-guard="true">
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
                      Title
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
                        <input
                          type="text"
                          value={order.displayId ?? order.id.slice(-6)}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "displayId",
                              e.target.value,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8 font-mono"
                          placeholder={order.id.slice(-6)}
                        />
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
                        <input
                          type="text"
                          value={order.title || ""}
                          onChange={(e) =>
                            updateOrderField(
                              order.id,
                              "title",
                              e.target.value,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Title..."
                        />
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
                      Title
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
              <div className="space-y-2" data-sync-guard="true">
                <div className="rounded border border-blue-200 bg-blue-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-blue-800">
                          Required Stock For Current Schedule
                        </div>
                        <div className="text-[11px] text-blue-700">
                          {currentSchedulePaperRequirements.length
                            ? "Stock needed to fulfill the current production schedule."
                            : "Current schedule can be fulfilled with stock on hand and pending deliveries."}
                        </div>
                      </div>
                    <button
                      onClick={() =>
                        registerPaperRequirements(
                          schedulerSuggestions?.currentSchedule?.requiredPapers,
                          "Current schedule stock order",
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
                          Required Stock For Suggested Schedule
                        </div>
                        <div className="text-[11px] text-emerald-700">
                          {suggestedSchedulePaperRequirements.length
                            ? "Stock needed if you import the suggested schedule."
                            : "Suggested schedule does not need additional stock."}
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

              {/* Scheduler Suggestions - Now right after Required Stock */}
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">
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
                        {renderSchedulePriorityList(
                          schedulerSuggestions?.bestSuggestion ?? null,
                          "green",
                        )}
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
                        {renderSchedulePriorityList(
                          schedulerSuggestions?.currentSchedule ?? null,
                        )}
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

                  {schedulerSuggestions?.warning && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      {schedulerSuggestions.warning}
                    </div>
                  )}
                </div>
              </div>
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
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Tracked Inventory
              </h3>
              <table className="w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="px-1 py-0.5 text-left">Item</th>
                    <th className="px-1 py-0.5 text-right">Quantity</th>
                    <th className="px-1 py-0.5 text-right">Value</th>
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
                      <td className="px-1 py-0.5 text-right font-mono">
                        {formatCurrency(quantity * getColorPrice(color))}
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
                    <td className="px-1 py-0.5 text-right font-mono">
                      {formatCurrency(financialMetrics.trackedInventoryValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-2 rounded bg-white p-2 text-xs text-gray-600">
                <div className="flex items-center justify-between">
                  <span>Other inventory value</span>
                  <span className="font-mono text-gray-800">
                    {formatCurrency(financialMetrics.otherInventoryValue)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between font-semibold text-gray-800">
                  <span>Total inventory value</span>
                  <span className="font-mono">
                    {formatCurrency(financialMetrics.totalInventoryValue)}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded p-2 xl:col-span-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Transactions Ledger
              </h3>
              <div className="mb-2 text-[11px] text-gray-500">
                Every transaction is kept in the ledger, exported, and used for the
                financial history below.
              </div>
              <div className="mb-2">
                <table className="w-full text-xs">
                  <thead className="bg-gray-200">
                    <tr>
                      <th className="px-1 py-0.5 text-left">Time</th>
                      <th className="px-1 py-0.5 text-left">Amount</th>
                      <th className="px-1 py-0.5 text-left">Category</th>
                      <th className="px-1 py-0.5 text-left">Details</th>
                      <th className="px-1 py-0.5 text-left">Status</th>
                      <th className="px-1 py-0.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionsDescending.map((trans) => {
                      const metadata = resolveTransactionMetadata(trans);

                      return (
                        <tr
                          key={`${trans.id}-${trans.arrivalTime ?? trans.timestamp.toISOString()}-${trans.reason ?? ""}`}
                          className="border-b"
                        >
                          <td className="px-1 py-0.5 font-mono text-[11px] text-gray-500">
                            {formatLedgerTime(trans.timestamp)}
                          </td>
                          <td
                            className={`px-1 py-0.5 font-mono ${
                              trans.amount > 0
                                ? "text-green-600"
                                : trans.amount < 0
                                  ? "text-red-600"
                                  : "text-gray-500"
                            }`}
                          >
                            {formatCurrency(trans.amount)}
                          </td>
                          <td className="px-1 py-0.5 text-[11px]">
                            <div className="font-medium text-gray-800">
                              {getTransactionCategoryLabel(trans)}
                            </div>
                            <div className="text-gray-500">
                              {metadata.financeBucket === "neutral"
                                ? "No direct metric impact"
                                : metadata.financeBucket.replace(/_/g, " ")}
                            </div>
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            <div className="text-gray-800">{trans.reason || ""}</div>
                            {trans.paperColor && trans.paperQuantity !== undefined && (
                              <div className="text-[11px] text-gray-500">
                                {getColorName(trans.paperColor)} {trans.paperQuantity}
                              </div>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {trans.pending ? (
                              <span 
                                onClick={() => completePendingTransaction(trans.id)}
                                className="cursor-pointer text-yellow-600 hover:text-yellow-800"
                              >
                                {getTransactionStatusLabel(trans, currentTime)}
                              </span>
                            ) : (
                              <span className="text-green-600">
                                {getTransactionStatusLabel(trans, currentTime)}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            {isManualTransaction(trans) ? (
                              <button
                                onClick={() => deleteTransaction(trans.id)}
                                className="px-1 py-0.5 text-gray-500 hover:text-gray-700 text-xs"
                              >
                                ×
                              </button>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Add Transaction Forms */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount / cost"
                    className="w-28 px-1 py-0.5 border rounded text-xs"
                    id="cashAmount"
                  />
                  <input
                    type="text"
                    placeholder="Reason"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashReason"
                  />
                  <select
                    id="manualEntryKind"
                    className="px-1 py-0.5 border rounded text-xs"
                    defaultValue="manual_cash"
                  >
                    <option value="manual_cash">Manual cash</option>
                    <option value="operating_expense">Operating expense</option>
                    <option value="inventory_purchase">Other inventory</option>
                    <option value="starting_inventory">Starting inventory</option>
                  </select>
                  <button
                    onClick={() => {
                      const rawAmount = parseFloat(
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
                        ).value || "Manual transaction";
                      const entryKind = (
                        document.getElementById(
                          "manualEntryKind",
                        ) as HTMLSelectElement
                      ).value as
                        | "manual_cash"
                        | "operating_expense"
                        | "inventory_purchase"
                        | "starting_inventory";
                      if (rawAmount) {
                        let amount = rawAmount;
                        let type: "cash" | "paper" | "inventory" = "cash";
                        let metadata: TransactionMetadata = {
                          category: "manual_cash",
                          financeBucket: "neutral",
                          metricContribution: 0,
                          inventoryValueDelta: 0,
                        };

                        if (entryKind === "operating_expense") {
                          amount = -Math.abs(rawAmount);
                          metadata = {
                            category: "operating_expense",
                            financeBucket: "operating_expense",
                            metricContribution: Math.abs(rawAmount),
                            inventoryValueDelta: 0,
                          };
                        } else if (entryKind === "inventory_purchase") {
                          amount = -Math.abs(rawAmount);
                          type = "inventory";
                          metadata = {
                            category: "inventory_purchase",
                            financeBucket: "cost_of_sales",
                            metricContribution: Math.abs(rawAmount),
                            inventoryValueDelta: Math.abs(rawAmount),
                          };
                        } else if (entryKind === "starting_inventory") {
                          amount = 0;
                          type = "inventory";
                          metadata = {
                            category: "starting_inventory",
                            financeBucket: "operating_expense",
                            metricContribution: Math.abs(rawAmount) * 0.7,
                            inventoryValueDelta: Math.abs(rawAmount),
                          };
                        }

                        addTransaction(
                          amount,
                          reason,
                          type,
                          undefined,
                          undefined,
                          undefined,
                          false,
                          undefined,
                          metadata,
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
                            "manualEntryKind",
                          ) as HTMLSelectElement
                        ).value = "manual_cash";
                      }
                    }}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs"
                  >
                    Add Entry
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">
                  Starting inventory keeps cash unchanged, adds inventory value, and
                  books 70% of the entered cost as an operating expense.
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
                      const item = gameState.getColorByName(colorName || "");
                      if (item && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * item.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Stock item"
                    className="w-24 px-1 py-0.5 border rounded text-xs"
                    id="paperColorInput"
                    list="paperColorsList"
                    onChange={(e) => {
                      const colorName = e.target.value;
                      const item = gameState.getColorByName(colorName);
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                            "paperQty",
                          ) as HTMLInputElement
                        ).value,
                      ) || 0;
                      if (item && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * item.basePrice).toFixed(2);
                      }
                    }}
                  />
                  <datalist id="paperColorsList">
                    {trackedInventoryItems.map((item) => (
                      <option key={item.code} value={item.name} />
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
                      const itemMatch = gameState.getColorByName(colorName);

                      if (!itemMatch) {
                        alert("Please select a valid stock item");
                        return;
                      }

                      // Allow any quantity including 0 (for theft) or negative (for returns)

                      const costInput = parseFloat(
                        (document.getElementById("paperCost") as HTMLInputElement).value
                      );
                      const cost = costInput ? -Math.abs(costInput) : -Math.abs(qty * itemMatch.basePrice);
                      const reason =
                        (
                          document.getElementById(
                            "paperReason",
                          ) as HTMLInputElement
                        ).value ||
                        `Bought ${qty} ${itemMatch.code === ENVELOPE_CODE ? "envelopes" : "sheets"} of ${itemMatch.name}`;
                      
                      const deliveryMs = paperDeliverySeconds * 1000;

                      addTransaction(
                        cost,
                        reason,
                        "paper",
                        itemMatch.code,
                        qty,
                        undefined,
                        true,
                        deliveryMs,
                        {
                          category: "paper_purchase",
                          financeBucket: "cost_of_sales",
                          metricContribution: Math.abs(cost),
                          inventoryValueDelta: 0,
                        },
                      );
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
                    Buy Stock
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
                  <span className="font-medium text-gray-700"> Stock Delivery (s)</span>.
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
                  <div className="mb-1 font-medium text-gray-700">Stock Delivery / Pending Time (s)</div>
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
                  <div className="mb-1 font-medium text-gray-700">Allowance (Standard Time Ratio)</div>
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
                <div className="text-gray-500">
                  Financial history is built directly from the full transactions ledger.
                </div>
              </div>

              <div className="mt-3 rounded border border-gray-200 bg-white p-3">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">
                      Financial History
                    </h3>
                    <div className="text-[11px] text-gray-500">
                      Cash, revenue, and net profit over every recorded transaction.
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Latest net profit {formatCurrency(financialMetrics.netProfit)}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <SimpleLineChart
                    title="Cash"
                    colorClass="text-cyan-600"
                    points={financialHistory}
                    valueSelector={(point) => point.cash}
                  />
                  <SimpleLineChart
                    title="Revenue"
                    colorClass="text-green-600"
                    points={financialHistory}
                    valueSelector={(point) => point.revenue}
                  />
                  <SimpleLineChart
                    title="Net Profit"
                    colorClass="text-blue-600"
                    points={financialHistory}
                    valueSelector={(point) => point.netProfit}
                  />
                </div>
              </div>

	              <div className="mt-3 flex justify-end">
	                <button
	                  onClick={resetGameState}
	                  className="rounded bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800"
	                >
	                  Reset Game
	                </button>
	              </div>

              <div className="mt-3 rounded border border-gray-200 bg-white p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">
                      Backup and Export
                    </h3>
                    <div className={`mt-1 font-medium ${backupStatusClass}`}>
                      {backupStatus.lastError || backupStatusLabel}
                    </div>
                    {backupStatus.browserPermissionHintVisible && autoBackupEnabled && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        If downloads stop appearing, allow automatic downloads for this site.
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        triggerJsonBackupDownload("manual");
                      }}
                      className="rounded bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-600"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick={triggerCsvBackupDownload}
                      className="rounded bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-600"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={openImportPicker}
                      className="rounded bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-600"
                    >
                      Import JSON
                    </button>
                    <label className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={autoBackupEnabled}
                        onChange={(event) => setAutoBackupEnabled(event.target.checked)}
                        className="h-4 w-4 rounded"
                      />
                      Auto backup every 10 min
                    </label>
                  </div>
                </div>
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
            paperInventory={paperInventory}
            setPaperInventory={setPaperInventory}
            stationSpeedMultipliers={stationSpeedMultipliers}
            updateStationSpeedMultiplier={updateStationSpeedMultiplier}
          />
        </div>
      )}

      {deliveryPrompts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-3">
          {deliveryPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className="pointer-events-auto rounded-lg border border-emerald-200 bg-white p-3 shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-emerald-800">
                    {prompt.title}
                  </div>
                  <div className="mt-1 text-xs text-gray-700">
                    {prompt.message}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">
                    Orders:{" "}
                    {prompt.orderIds.map((orderId) => orderId.slice(-6)).join(", ")}
                  </div>
                </div>
                <button
                  onClick={() => dismissDeliveryPrompt(prompt.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => {
                    setCurrentView("operations");
                    dismissDeliveryPrompt(prompt.id);
                  }}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Review in Operations
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Alternatives - Moved to bottom */}
      {currentView === "operations" && schedulerSuggestions?.suggestions && schedulerSuggestions.suggestions.length > 0 && (
        <div className="bg-white border-t border-gray-300">
          <div className="p-2">
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
                      {renderSchedulePriorityList(schedule)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-gray-500">
                  No candidate schedules available.
                </div>
              )}
            </div>
          </div>
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
