/**
 * Game Constants
 * 
 * Shared constants that need to be accessible across multiple modules
 * without creating circular dependencies.
 * 
 * This file should only contain simple constants and no imports from
 * other game modules to maintain its role as a dependency-free source.
 */

// Standard time ratio for workstation calculations
// This accounts for contingencies like worker breaks, fatigue, etc.
// Normal time = Observed time * Standard time ratio
export const STANDARD_TIME_RATIO = 1.23;

// Other game constants can be added here as needed
// Examples might include:
// - Maximum batch sizes
// - Time conversion factors
// - Default multipliers
// - System limits