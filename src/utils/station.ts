// Production station definitions and utilities
import { createDefaultStations } from '../data/defaultStationData';

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
  numberOfItems: number; // if many are done at once we need to know this as it'll need to be weighted differently when merging distributuions
  employeePerformance: number; // Employee will be faster during timing.
  taskSize: number; //Weather writing 2,4,6 lines or folding 2,4,6 times etc.
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
 * @returns Map of distributions by task size
 */
export function generateStationProcessingTimes(
  rawTimes: RawStationTaskTime[],
  standardTimeRatio: number = 1.23, //TODO: Make this an adjustable parameter //The standard time is like contingency for workers breaks and so on..
): Map<number, NormalDistribution> {
  const distributions = new Map<number, NormalDistribution>();

  // Group raw times by task size. What we are meant to do is widen the variance down if there's a lot of items processed in one recording, and divide the mean time. Like un-central limit theorem.
  const timesBySize = new Map<number, RawStationTaskTime[]>();

  for (const rawTime of rawTimes) {
    const size = rawTime.taskSize;
    if (!timesBySize.has(size)) {
      timesBySize.set(size, []);
    }
    timesBySize.get(size)!.push(rawTime);
  }

  // Calculate distribution for each size
  for (const [size, times] of timesBySize) {
    if (times.length === 0) continue;

    // Normalize times to per-item basis accounting for employee performance.
    // Batch recordings are averages over multiple items, so weight them by
    // `numberOfItems` when reconstructing the single-item distribution.
    const normalizedTimes = times.map((t) => {
      // Adjust for employee performance (they're faster during timing)
      const adjustedTime = t.observedTimeTaken / t.employeePerformance;
      // Convert to per-item time
      const perItemTime = adjustedTime / t.numberOfItems;
      // Apply standard time ratio from game state
      return {
        perItemTime: perItemTime * standardTimeRatio,
        weight: Math.max(t.numberOfItems, 1),
      };
    });

    const totalWeight = normalizedTimes.reduce(
      (sum, sample) => sum + sample.weight,
      0,
    );

    // Calculate weighted mean
    const mean =
      normalizedTimes.reduce(
        (sum, sample) => sum + sample.perItemTime * sample.weight,
        0,
      ) / totalWeight;

    // Convert batch-average variance back toward a one-item variance estimate by
    // weighting each observation by its batch size.
    const variance =
      normalizedTimes.reduce(
        (sum, sample) =>
          sum + sample.weight * Math.pow(sample.perItemTime - mean, 2),
        0,
      ) / totalWeight;
    const stdDev = Math.sqrt(variance);

    distributions.set(size, {
      mean,
      stdDev,
    });
  }

  // Interpolate missing sizes if we have neighbors
  // For example, if we have size 2 and 6 but not 4:
  if (!distributions.has(4) && distributions.has(2) && distributions.has(6)) {
    const dist2 = distributions.get(2)!;
    const dist6 = distributions.get(6)!;
    distributions.set(4, {
      mean: (dist2.mean + dist6.mean) / 2,
      stdDev: (dist2.stdDev + dist6.stdDev) / 2,
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
    defaultStations.forEach(station => {
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
      this.setStationSpeedMultiplier("station1_folding", speedMultipliers.station1);
    }
    if (speedMultipliers.station2 !== undefined) {
      this.setStationSpeedMultiplier(
        "station2_stencilling",
        speedMultipliers.station2,
      );
    }
    if (speedMultipliers.station3 !== undefined) {
      this.setStationSpeedMultiplier("station3_writing", speedMultipliers.station3);
    }
  }
}

// Use gameState.getStationManager() instead of this duplicate
// import { gameState } from "./gameState";

export function calculateStationOccupationTimePerOrder(
  station: Station,
  order: Order,
): NormalDistribution {
  // TODO: Your implementation here
  // You can access station properties directly from the station parameter
  // The station object is passed in, or you can get it from stationManager:
  // const station = stationManager.getStation(stationId);

  return {
    mean: 0,
    stdDev: 0,
  };
}

export function calculateStationItemTimeDistribution(
  station: Station,
  order: Order,
): NormalDistribution {
  // Determine the task size based on order properties and station type
  const taskSize = getStationTaskSize(station.id, order);

  // Get the distribution for this task size
  let distribution: NormalDistribution;
  if (station.sizeDistributions?.has(taskSize)) {
    distribution = station.sizeDistributions.get(taskSize)!;
  } else {
    // Fallback to base distribution
    distribution = station.itemProcesingTime;
  }

  // Apply station's speed multiplier
  return {
    mean: distribution.mean / station.speedMultiplier,
    stdDev: distribution.stdDev / station.speedMultiplier,
  };
}

export function getStationTaskSize(
  stationId: string,
  order: Pick<Order, "size" | "verseSize">,
): number {
  if (stationId.includes("verse") || stationId.includes("writing")) {
    return order.verseSize;
  }

  if (stationId.includes("fold") || stationId.includes("cut")) {
    const sizeMap: Record<string, number> = {
      A5: 1,
      A6: 2,
      A7: 3,
    };
    return sizeMap[order.size] || 1;
  }

  return 1;
}

// Calculate handover time between stations
export function calculateHandoverDistribution(
  fromStation: Station,
  toStation: Station,
): NormalDistribution {
  // TODO: Add handover time distribution between stations
  return {
    mean: 0,
    stdDev: 0,
  };
}
