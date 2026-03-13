// Production station definitions and utilities
import { createDefaultStations } from "../data/defaultStationData";
import { STANDARD_TIME_RATIO } from "./gameConstants";

// Define a minimal Order interface to avoid circular dependency
// This matches the Order type in gameState.ts but only includes fields needed here
interface Order {
  quantity: number;
  size: string;
  verseSize: number;
}

export const STATION_IDS = {
  1: "station1_folding",
  2: "station2_stencilling",
  3: "station3_writing",
} as const;

// Normal distribution type for statistical calculations
export interface NormalDistribution {
  mean: number;
  stdDev: number;
  // variance?: number; should be a function, otherwise it might unsync...
}

export interface RawStationTaskTime {
  observedTimeTaken: number;
  numberOfItems: number;
  employeePerformance: number; // < 1 means slower than normal during observation.
  taskDifficulty: number; // Writing/folding difficulty bucket, e.g. 1/2/3.
}

// Station type representing a production workstation/cell
export interface Station {
  id: string;
  name: string;
  // Processing time parameters (in SECONDS per unit)
  rawStationTaskTimes: RawStationTaskTime[];
  itemProcesingTime: NormalDistribution; // Default/fallback distribution
  // Store distributions for different task sizes (e.g., "2": distribution for 2-line verse), right now this is not important given the lack of inputs for varying tasks.
  sizeDistributions: Map<number, NormalDistribution>;
  speedMultiplier: number; // Speed override factor (default 1.0)

  // Method to generate distributions from raw times
  generateProcessingTimes: () => Map<number, NormalDistribution>;
}

export interface StationSpeedMultipliers {
  station1: number;
  station2: number;
  station3: number;
}

export const DEFAULT_STATION_SPEED_MULTIPLIERS: StationSpeedMultipliers = {
  station1: 1,
  station2: 1,
  station3: 1,
};

const STATION_SIZE_TO_DIFFICULTY: Record<string, number> = {
  A5: 1,
  A6: 2,
  A7: 3,
};

const STATION3_FIXED_TASK_DIFFICULTY = 2;

// Station configuration for different product sizes, based on the station this will vary.
// Paper will have sizes 1,2,3 based on fold count.
// Verses will have 2,4,6 based on number of verses etc etc. WE MAY CHANGE THIS IF 4 lines not double 2?
export interface StationSizeConfig {
  sizeMultipliers: {
    A5: number;
    A6: number;
    A7: number;
    [key: string]: number;
  };
}

/**
 * Generate processing time distributions from raw observed times
 * @param rawTimes - Array of observed task times
 * @param standardTimeRatio - Ratio from gameState for normalizing times
 * @returns Map of per-item distributions by task difficulty
 */
export function generateStationProcessingTimes(
  rawTimes: RawStationTaskTime[],
  standardTimeRatio: number = STANDARD_TIME_RATIO,
): Map<number, NormalDistribution> {
  const distributions = new Map<number, NormalDistribution>();
  const timesByDifficulty = new Map<number, RawStationTaskTime[]>();

  for (const rawTime of rawTimes) {
    const samples = timesByDifficulty.get(rawTime.taskDifficulty);
    if (samples) {
      samples.push(rawTime);
    } else {
      timesByDifficulty.set(rawTime.taskDifficulty, [rawTime]);
    }
  }

  for (const [taskDifficulty, samples] of timesByDifficulty) {
    if (!samples.length) {
      continue;
    }

    const normalizedSamples = samples.map((sample) => {
      const itemCount = Math.max(1, sample.numberOfItems);
      const normalTime = sample.observedTimeTaken * sample.employeePerformance;

      return {
        itemCount,
        perItemMean: (normalTime * standardTimeRatio) / itemCount,
      };
    });

    const totalItems = normalizedSamples.reduce(
      (sum, sample) => sum + sample.itemCount,
      0,
    );

    if (!totalItems) {
      continue;
    }

    const mean =
      normalizedSamples.reduce(
        (sum, sample) => sum + sample.perItemMean * sample.itemCount,
        0,
      ) / totalItems;

    // Batch observations are means over multiple items. Multiply the squared
    // deviation by batch size to infer the underlying single-item variance.
    const variance =
      normalizedSamples.length > 1
        ? normalizedSamples.reduce(
            (sum, sample) =>
              sum +
              sample.itemCount * Math.pow(sample.perItemMean - mean, 2),
            0,
          ) / normalizedSamples.length
        : 0;

    distributions.set(taskDifficulty, {
      mean,
      stdDev: Math.sqrt(Math.max(variance, 0)),
    });
  }

  return distributions;
}

// Station collection/manager class
export class StationManager {
  private stations: Map<string, Station>;

  constructor() {
    this.stations = new Map();
    this.initializeDefaultStations();
  }

  private initializeDefaultStations(): void {
    // Initialize the default stations with our abstracted model
    // These stations use effective processing times to handle the complexity
    // of Station 1 workers helping Station 2 after finishing folding
    const defaultStations = createDefaultStations();
    defaultStations.forEach((station) => {
      this.stations.set(station.id, station);
    });
  }

  getStation(id: string): Station | undefined {
    return this.stations.get(id);
  }

  getAllStations(): Station[] {
    return Array.from(this.stations.values());
  }

  addStation(station: Station): void {
    this.stations.set(station.id, station);
  }

  setStationSpeedMultiplier(stationId: string, speedMultiplier: number): void {
    const station = this.stations.get(stationId);
    if (!station) {
      return;
    }

    station.speedMultiplier = speedMultiplier;
  }

  getStationSpeedMultipliers(): StationSpeedMultipliers {
    return {
      station1: this.stations.get("station1_folding")?.speedMultiplier ?? 1,
      station2: this.stations.get("station2_stencilling")?.speedMultiplier ?? 1,
      station3: this.stations.get("station3_writing")?.speedMultiplier ?? 1,
    };
  }

  applyStationSpeedMultipliers(
    speedMultipliers: Partial<StationSpeedMultipliers>,
  ): void {
    if (speedMultipliers.station1 !== undefined) {
      this.setStationSpeedMultiplier(
        "station1_folding",
        speedMultipliers.station1,
      );
    }
    if (speedMultipliers.station2 !== undefined) {
      this.setStationSpeedMultiplier(
        "station2_stencilling",
        speedMultipliers.station2,
      );
    }
    if (speedMultipliers.station3 !== undefined) {
      this.setStationSpeedMultiplier(
        "station3_writing",
        speedMultipliers.station3,
      );
    }
  }
}

// Use gameState.getStationManager() instead of this duplicate
// import { gameState } from "./gameState";

export function calculateStationOccupationTimePerOrder(
  station: Station,
  order: Order,
): NormalDistribution {
  return calculateStationOrderTimeDistribution(station, order);
}

export function getNearestDistribution(
  distributions: Map<number, NormalDistribution>,
  taskDifficulty: number,
): NormalDistribution | null {
  const exactMatch = distributions.get(taskDifficulty);
  if (exactMatch) {
    return exactMatch;
  }

  const availableDifficulties = Array.from(distributions.keys());
  if (!availableDifficulties.length) {
    return null;
  }

  const closestDifficulty = availableDifficulties.reduce((closest, current) => {
    const currentDistance = Math.abs(current - taskDifficulty);
    const closestDistance = Math.abs(closest - taskDifficulty);
    if (currentDistance !== closestDistance) {
      return currentDistance < closestDistance ? current : closest;
    }

    return current < closest ? current : closest;
  });

  return distributions.get(closestDifficulty) ?? null;
}

export function scaleDistributionByItemCount(
  distribution: NormalDistribution,
  itemCount: number,
): NormalDistribution {
  const safeItemCount = Math.max(1, itemCount);
  return {
    mean: distribution.mean * safeItemCount,
    stdDev: distribution.stdDev * Math.sqrt(safeItemCount),
  };
}

export function calculateStationItemTimeDistribution(
  station: Station,
  order: Order,
): NormalDistribution {
  const taskDifficulty = getStationTaskDifficulty(station.id, order);
  const distribution =
    getNearestDistribution(station.sizeDistributions, taskDifficulty) ||
    station.itemProcesingTime;

  // Apply station's speed multiplier
  return {
    mean: distribution.mean / station.speedMultiplier,
    stdDev: distribution.stdDev / station.speedMultiplier,
  };
}

export function calculateStationOrderTimeDistribution(
  station: Station,
  order: Order,
): NormalDistribution {
  return scaleDistributionByItemCount(
    calculateStationItemTimeDistribution(station, order),
    order.quantity,
  );
}

export function getStationTaskDifficulty(
  stationId: string,
  order: Pick<Order, "size" | "verseSize">,
): number {
  if (stationId.includes("verse") || stationId.includes("writing")) {
    return STATION3_FIXED_TASK_DIFFICULTY;
  }

  if (
    stationId.includes("fold") ||
    stationId.includes("cut") ||
    stationId.includes("stencil")
  ) {
    return STATION_SIZE_TO_DIFFICULTY[order.size] || 1;
  }

  return 1;
}

export const getStationTaskSize = getStationTaskDifficulty;

// Calculate handover time between stations
export function calculateHandoverDistribution(
  _fromStation: Station,
  _toStation: Station,
): NormalDistribution {
  void _fromStation;
  void _toStation;
  // TODO: Add handover time distribution between stations
  return {
    mean: 0,
    stdDev: 0,
  };
}
