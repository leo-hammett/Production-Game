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

// =============================================================================
// Station 1: Folding (per-card cumulative times, assuming batch of 8)
// =============================================================================

const station1FoldingRawTimes: RawStationTaskTime[] = [
  // A5 folding (1 fold cumulative)
  {
    observedTimeTaken: 7.17,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 6.0,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 5.29,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 5.16,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 5.03,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 1,
  },

  // A6 folding (2 folds cumulative)
  {
    observedTimeTaken: 13.26,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 11.87,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 10.29,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 10.04,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 9.46,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 2,
  },

  // A7 folding (3 folds cumulative)
  {
    observedTimeTaken: 20.64,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 17.82,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 15.71,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 15.23,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 14.04,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 3,
  },
];

// =============================================================================
// Station 2: Stencilling (per-card times with helper model, batch of 8)
// Helper arrives after Station 1 finishes folding.
// taskDifficulty 1=A5, 2=A6, 3=A7 (affects when helper arrives)
// =============================================================================

const station2StencillingRawTimes: RawStationTaskTime[] = [
  // A5 cards — helper arrives after A5 folding completes
  {
    observedTimeTaken: 65.82,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 57.63,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 46.7,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 49.63,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 1,
  },
  {
    observedTimeTaken: 46.47,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 1,
  },

  // A6 cards — helper arrives after A6 folding completes
  {
    observedTimeTaken: 67.16,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 54.23,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 51.43,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 48.38,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 47.02,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 2,
  },

  // A7 cards — helper arrives after A7 folding completes
  {
    observedTimeTaken: 73.61,
    numberOfItems: 1,
    employeePerformance: 0.7,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 70.3,
    numberOfItems: 1,
    employeePerformance: 0.8,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 64.01,
    numberOfItems: 1,
    employeePerformance: 0.9,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 54.33,
    numberOfItems: 1,
    employeePerformance: 0.95,
    taskDifficulty: 3,
  },
  {
    observedTimeTaken: 52.69,
    numberOfItems: 1,
    employeePerformance: 1.0,
    taskDifficulty: 3,
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
    taskDifficulty: 2,
  }, // 2-line verse
  {
    observedTimeTaken: 46.8,
    numberOfItems: 1,
    employeePerformance: 0.8718,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 45.41,
    numberOfItems: 1,
    employeePerformance: 0.9422,
    taskDifficulty: 2,
  },
  {
    observedTimeTaken: 43.76,
    numberOfItems: 1,
    employeePerformance: 0.9403,
    taskDifficulty: 2,
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
