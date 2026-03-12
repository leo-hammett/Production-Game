// Production station definitions and utilities

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
  rawStationTaskTimes: RawStationTaskTime[]; //Is this how we do a varying list length in typescript?
  itemProcesingTime: NormalDistribution;
  // Capacity and constraints
  batchCapacity: number; // Max units that can be processed simultaneously
  setupTime: number; // Fixed setup time in SECONDS (probably redundant)
  // Current state
  itemsLeftToProcessUntilIdle: number; //Estimate of course...
  speedMultiplier: number; // Speed override factor (default 1.0)

  generateStationProcessingTimes CLAUDE PLS MAKER THIS INTO A FUCNTION, INPUT IS RAW TASK TIMES AND GAMESTATE needs to have the standardTimeRatio which we must fetch, then for each size we have RawStationTaskTimes for we should make a distribution for and add it to a dictionary for future fetching, generateStationProcessingTimes should also return the distribution
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

// Station collection/manager class
export class StationManager {
  private stations: Map<string, Station>;

  constructor() {
    this.stations = new Map();
    this.initializeDefaultStations();
  }

  private initializeDefaultStations(): void {
    // TODO: Add your default station configurations here
    // Example (times in SECONDS):
    // this.stations.set("cutting", {
    // PUT IN DEFAULT VALUES FOR EACH STATION
    // });
    // can we populate these stations...
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
  speedMultiplier: number,
): NormalDistribution {
  // This function is for a single item in an order
  // TODO: Calculate processing time distribution for one item
  // Include handover time distribution

  return {
    mean: 0,
    stdDev: 0,
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
