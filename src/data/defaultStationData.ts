import type { Station, RawStationTaskTime } from "../utils/station";
import { generateStationProcessingTimes } from "../utils/station";
import { STANDARD_TIME_RATIO } from "../utils/gameConstants";

/**
 * DEFAULT STATION DATA
 *
 * IMPORTANT ABSTRACTION DECISION (Option 1 - Effective Processing Time):
 * =====================================================================
 * Station 1 (Folding) is so fast that workers finish folding and help Station 2 (Stencilling).
 * Rather than modeling complex worker movement and dynamic capacity changes, we've chosen to:
 *
 * 1. Model Station 1 with its actual fast folding times
 * 2. Model Station 2 with an "effective processing time" that accounts for help from Station 1
 * 3. Abstract away the worker movement complexity
 *
 * This means Station 2's times represent the COMBINED throughput of:
 * - Rick and Gauthami working in parallel at Station 2
 * - Plus help from Station 1's worker when they're done folding
 *
 * This simplification allows for accurate time estimates without complex station interdependencies.
 * If we need more granular control in the future, we can implement dynamic worker assignment.
 */

// Station 1: Folding Station
// Fast operation - worker completes folding then helps Station 2
const station1FoldingRawTimes: RawStationTaskTime[] = [
  // A5 folding (1 fold - simplest)
  {
    observedTimeTaken: 6.98,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskSize: 1,
  },
  {
    observedTimeTaken: 5.35,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 5.48,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 5.5,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskSize: 1,
  },
  {
    observedTimeTaken: 4.83,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskSize: 1,
  },

  // A6 folding (2 folds - medium complexity)
  {
    observedTimeTaken: 6.4,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskSize: 2,
  },
  {
    observedTimeTaken: 5.57,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskSize: 2,
  },
  {
    observedTimeTaken: 4.8,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskSize: 2,
  },
  {
    observedTimeTaken: 4.33,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskSize: 2,
  },
  {
    observedTimeTaken: 3.98,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskSize: 2,
  },

  // A7 folding (3 folds - most complex)
  {
    observedTimeTaken: 8.03,
    numberOfItems: 1,
    employeePerformance: 0.6,
    taskSize: 3,
  },
  {
    observedTimeTaken: 6.53,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskSize: 3,
  },
  {
    observedTimeTaken: 5.14,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskSize: 3,
  },
  {
    observedTimeTaken: 4.36,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskSize: 3,
  },
  {
    observedTimeTaken: 4.7,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskSize: 3,
  },
];

// Station 2: Stencilling Station
// EFFECTIVE TIMES - includes help from Station 1 worker
// These times represent the combined throughput of Rick, Gauthami, and help from Station 1
const station2StencillingRawTimes: RawStationTaskTime[] = [
  // Combined effective times for stencilling (treating as single task size for now)
  // These are abstracted times that account for parallel work and Station 1 help
  {
    observedTimeTaken: 119.24,
    numberOfItems: 5,
    employeePerformance: 0.5,
    taskSize: 1,
  },
  {
    observedTimeTaken: 93.57,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 87.97,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 85.25,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 92.22,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },

  // Additional observations (second set)
  {
    observedTimeTaken: 93.0,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 84.0,
    numberOfItems: 5,
    employeePerformance: 0.9,
    taskSize: 1,
  },
  {
    observedTimeTaken: 73.0,
    numberOfItems: 5,
    employeePerformance: 0.8,
    taskSize: 1,
  },
  {
    observedTimeTaken: 75.0,
    numberOfItems: 5,
    employeePerformance: 1.0,
    taskSize: 1,
  },
  {
    observedTimeTaken: 68.0,
    numberOfItems: 5,
    employeePerformance: 1.0,
    taskSize: 1,
  },
];

// Station 3: Writing Station
// Handles verse writing, delivery writing, team identity writing
const station3WritingRawTimes: RawStationTaskTime[] = [
  // These appear to be for writing tasks (incomplete data in original)
  {
    observedTimeTaken: 51.7,
    numberOfItems: 1,
    employeePerformance: 0.8311,
    taskSize: 2,
  }, // 2-line verse
  {
    observedTimeTaken: 46.8,
    numberOfItems: 1,
    employeePerformance: 0.8718,
    taskSize: 2,
  },
  {
    observedTimeTaken: 45.41,
    numberOfItems: 1,
    employeePerformance: 0.9422,
    taskSize: 2,
  },
  {
    observedTimeTaken: 43.76,
    numberOfItems: 1,
    employeePerformance: 0.9403,
    taskSize: 2,
  },
  // Note: Last entry was incomplete in original data
];

// Create the station objects with the abstracted model
export function createDefaultStations(): Station[] {
  const stations: Station[] = [
    {
      id: "station1_folding",
      name: "Folding Station",
      rawStationTaskTimes: station1FoldingRawTimes,
      itemProcesingTime: { mean: 6, stdDev: 1.5 }, // Fallback
      sizeDistributions: new Map(),
      speedMultiplier: 1.0,
      generateProcessingTimes: function () {
        this.sizeDistributions = generateStationProcessingTimes(
          this.rawStationTaskTimes,
          STANDARD_TIME_RATIO,
        );
        return this.sizeDistributions;
      },
    },
    {
      id: "station2_stencilling",
      name: "Stencilling Station (Effective)",
      rawStationTaskTimes: station2StencillingRawTimes,
      itemProcesingTime: { mean: 40, stdDev: 10 }, // Fallback
      sizeDistributions: new Map(),
      speedMultiplier: 1.0,
      generateProcessingTimes: function () {
        this.sizeDistributions = generateStationProcessingTimes(
          this.rawStationTaskTimes,
          STANDARD_TIME_RATIO,
        );
        return this.sizeDistributions;
      },
    },
    {
      id: "station3_writing",
      name: "Writing Station",
      rawStationTaskTimes: station3WritingRawTimes,
      itemProcesingTime: { mean: 47, stdDev: 3.5 }, // Fallback
      sizeDistributions: new Map(),
      speedMultiplier: 1.0,
      generateProcessingTimes: function () {
        this.sizeDistributions = generateStationProcessingTimes(
          this.rawStationTaskTimes,
          STANDARD_TIME_RATIO,
        );
        return this.sizeDistributions;
      },
    },
  ];

  // Generate the processing time distributions for each station
  stations.forEach((station) => {
    station.generateProcessingTimes();
  });

  return stations;
}

/**
 * Notes on future improvements:
 * - If we need more accurate modeling, we could implement:
 *   1. Dynamic worker assignment based on Station 1 idle time
 *   2. Station groups that model multiple stations as one unit
 *   3. Time-based capacity changes (e.g., Station 2 gets faster after Station 1 is done)
 * - For now, the effective processing time abstraction provides good enough estimates
 *   while keeping the code simple and maintainable.
 */

