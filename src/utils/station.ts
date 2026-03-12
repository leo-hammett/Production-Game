// Production station definitions and utilities
import { createDefaultStations } from '../data/defaultStationData';

// Define a minimal Order interface to avoid circular dependency
// This matches the Order type in gameState.ts but only includes fields needed here
interface Order {
  quantity: number;
  size: string;
  verseSize: number;
}

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
  // Capacity and constraints
  batchCapacity: number; // Max units that can be processed simultaneously
  setupTime: number; // Fixed setup time in SECONDS
  // Current state
  itemsLeftToProcessUntilIdle: number; // Estimate of items in progress
  speedMultiplier: number; // Speed override factor (default 1.0)

  // Method to generate distributions from raw times
  generateProcessingTimes: () => Map<number, NormalDistribution>;
}

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

    // Normalize times to per-item basis accounting for employee performance
    const normalizedTimes = times.map((t) => {
      // Adjust for employee performance (they're faster during timing)
      const adjustedTime = t.observedTimeTaken / t.employeePerformance;
      // Convert to per-item time
      const perItemTime = adjustedTime / t.numberOfItems;
      // Apply standard time ratio from game state
      return perItemTime * standardTimeRatio;
    });

    // Calculate mean
    const mean =
      normalizedTimes.reduce((sum, t) => sum + t, 0) / normalizedTimes.length;

    // Calculate standard deviation
    const variance =
      normalizedTimes.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) /
      normalizedTimes.length;
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
    variance: 0,
  };
}

export function calculateStationItemTimeDistribution(
  station: Station,
  order: Order,
): NormalDistribution {
  // Determine the task size based on order properties and station type
  let taskSize: number;

  // Different stations care about different sizes
  if (station.id.includes("verse") || station.id.includes("writing")) {
    taskSize = order.verseSize; // 2, 4, or 6 lines
  } else if (station.id.includes("fold") || station.id.includes("cut")) {
    // Map paper sizes to complexity/fold counts
    const sizeMap: { [key: string]: number } = {
      A5: 1,
      A6: 2,
      A7: 3,
    };
    taskSize = sizeMap[order.size] || 1;
  } else {
    // Default task size
    taskSize = 1;
  }

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
