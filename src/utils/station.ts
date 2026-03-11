// Production station definitions and utilities

import type { Order } from "../App";

// Normal distribution type for statistical calculations
export interface NormalDistribution {
  mean: number;
  stdDev: number;
  // variance?: number; should be a function, otherwise it might unsync...
}

export interface RawStationTaskTimes {
  timeTaken: number;
  numberOfItems: number; // if many are done at once we need to know this as it'll need to be weighted differently when merging distributuions
  employeeLockedInNess: number;
  standardTime: number;
}

// Station type representing a production workstation/cell
export interface Station {
  id: string;
  name: string;
  type: StationType;
  // Processing time parameters (in SECONDS per unit)
  meanProcessingTime: number;
  stdDevProcessingTime: number;
  // Capacity and constraints
  batchCapacity: number; // Max units that can be processed simultaneously
  setupTime: number; // Fixed setup time in SECONDS (probably redundant)
  // Current state
  isActive: boolean;
  speedMultiplier: number; // Speed override factor (default 1.0)
}

//Likely just grouped numerically
export type StationType =
  | "cutting"
  | "folding"
  | "printing"
  | "assembly"
  | "packaging"
  | "quality_control"
  | "other";

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
    //   id: "cutting",
    //   name: "Cutting Station",
    //   type: "cutting",
    //   meanProcessingTime: 120,  // 2 minutes per unit
    //   stdDevProcessingTime: 30, // 30 seconds std dev
    //   batchCapacity: 10,
    //   setupTime: 300,  // 5 minutes setup
    //   isActive: true,
    //   speedMultiplier: 1.0
    // });
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

// Global station manager instance (or you can instantiate per component)
export const stationManager = new StationManager();

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
