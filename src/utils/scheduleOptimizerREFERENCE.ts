import type { Order } from "./gameState";
import { gameState } from "./gameState";
import { Schedule, ScheduleList, type NormalDistribution } from "./strategyPlanner";
import type { Station } from "./station";

/**
 * Generate random combinations of orders for schedule evaluation
 * @param availableOrders - Orders that can be scheduled
 * @param numCombinations - Number of random combinations to generate
 * @param maxOrdersPerSchedule - Maximum orders in a single schedule
 * @returns Array of schedules with different order combinations
 */
export function generateRandomScheduleCombinations(
  availableOrders: Order[],
  numCombinations: number = 20,
  maxOrdersPerSchedule: number = 10
): Schedule[] {
  const schedules: Schedule[] = [];
  
  // Always include the empty schedule (do nothing)
  schedules.push(new Schedule("schedule-empty", []));
  
  // Always include each single order as its own schedule
  availableOrders.forEach((order, index) => {
    schedules.push(new Schedule(`schedule-single-${index}`, [order.id]));
  });
  
  // Generate random combinations
  for (let i = 0; i < numCombinations; i++) {
    // Random number of orders to include (1 to min of available or max)
    const numOrders = Math.floor(Math.random() * 
      Math.min(availableOrders.length, maxOrdersPerSchedule)) + 1;
    
    // Randomly select orders
    const shuffled = [...availableOrders].sort(() => Math.random() - 0.5);
    const selectedOrders = shuffled.slice(0, numOrders);
    const orderIds = selectedOrders.map(o => o.id);
    
    // Create schedule with this combination
    const schedule = new Schedule(`schedule-combo-${i}`, orderIds);
    schedules.push(schedule);
  }
  
  // Add the "all orders" schedule if reasonable
  if (availableOrders.length <= maxOrdersPerSchedule) {
    schedules.push(new Schedule(
      "schedule-all", 
      availableOrders.map(o => o.id)
    ));
  }
  
  return schedules;
}

/**
 * Identify the bottleneck station for a set of orders
 * Bottleneck = station with highest total processing time
 * @param orders - Orders to analyze
 * @returns The bottleneck station and its time distribution
 */
export function identifyBottleneck(orders: Order[]): {
  station: Station | null;
  timeDistribution: NormalDistribution;
  totalProcessingTime: number;
} {
  const stationManager = gameState.getStationManager();
  const stations = stationManager.getAllStations();
  
  if (stations.length === 0 || orders.length === 0) {
    return {
      station: null,
      timeDistribution: { mean: 0, stdDev: 0 },
      totalProcessingTime: 0
    };
  }
  
  // Calculate total processing time for each station
  const stationTimes = stations.map(station => {
    // Sum up processing time for all orders at this station
    let totalMean = 0;
    let totalVariance = 0;
    
    orders.forEach(order => {
      // Get the appropriate distribution for this order's task size
      let taskSize = 1; // Default
      
      // Determine task size based on station type and order
      if (station.id.includes("fold")) {
        // Map paper sizes to fold complexity
        const sizeMap: { [key: string]: number } = {
          "A5": 1,
          "A6": 2, 
          "A7": 3
        };
        taskSize = sizeMap[order.size] || 1;
      } else if (station.id.includes("writing")) {
        taskSize = order.verseSize; // 2, 4, or 6 lines
      }
      
      // Get distribution for this task size
      const distribution = station.sizeDistributions.get(taskSize) || 
                          station.itemProcesingTime;
      
      // Add to totals (assuming independent processing)
      totalMean += order.quantity * distribution.mean;
      totalVariance += order.quantity * distribution.stdDev * distribution.stdDev;
    });
    
    return {
      station,
      timeDistribution: {
        mean: totalMean,
        stdDev: Math.sqrt(totalVariance)
      },
      totalProcessingTime: totalMean
    };
  });
  
  // Find the station with highest mean processing time (bottleneck)
  const bottleneck = stationTimes.reduce((max, current) => 
    current.totalProcessingTime > max.totalProcessingTime ? current : max
  );
  
  return bottleneck;
}

/**
 * Calculate profit per bottleneck time for ranking schedules
 * @param schedule - Schedule to evaluate
 * @returns Profit per time unit at the bottleneck
 */
export function calculateProfitPerBottleneckTime(schedule: Schedule): number {
  const orders = schedule.getOrders();
  
  if (orders.length === 0) {
    return 0; // Empty schedule
  }
  
  // Get bottleneck for these orders
  const bottleneck = identifyBottleneck(orders);
  
  if (!bottleneck.station || bottleneck.totalProcessingTime === 0) {
    return 0;
  }
  
  // Calculate schedule profit (need to run this first)
  schedule.calculateAll();
  
  // Profit per time at bottleneck (convert time to hours)
  const bottleneckTimeHours = bottleneck.totalProcessingTime / 3600; // Assuming time is in seconds
  const profitPerBottleneckHour = schedule.expectedProfit / bottleneckTimeHours;
  
  return profitPerBottleneckHour;
}

/**
 * Generate and rank schedule combinations
 * @param availableOrders - Orders that can be scheduled
 * @param numCombinations - Number of combinations to generate
 * @returns ScheduleList with ranked schedules
 */
export function generateAndRankSchedules(
  availableOrders: Order[],
  numCombinations: number = 20
): ScheduleList {
  // Generate random combinations
  const schedules = generateRandomScheduleCombinations(
    availableOrders,
    numCombinations
  );
  
  // Calculate metrics for each schedule
  schedules.forEach(schedule => {
    schedule.calculateAll();
    
    // Add bottleneck-based profit per hour
    const profitPerBottleneck = calculateProfitPerBottleneckTime(schedule);
    // Store in profitPerHour for ranking (override the simple calculation)
    schedule.profitPerHour = profitPerBottleneck;
  });
  
  // Sort by profit per bottleneck time (descending)
  schedules.sort((a, b) => b.profitPerHour - a.profitPerHour);
  
  // Create ScheduleList and add sorted schedules
  const scheduleList = new ScheduleList();
  schedules.forEach(schedule => {
    scheduleList.addSchedule(schedule);
  });
  
  // Override the updateBest to use profitPerHour instead of expectedProfit
  scheduleList.updateBest = function() {
    if (this.schedules.length === 0) {
      this.currentBest = null;
      return;
    }
    
    let bestSchedule = this.schedules[0];
    for (const schedule of this.schedules) {
      if (schedule.profitPerHour > bestSchedule.profitPerHour) {
        bestSchedule = schedule;
      }
    }
    this.currentBest = bestSchedule.id;
  };
  
  scheduleList.updateBest();
  
  return scheduleList;
}

/**
 * Compare new schedule with current and suggest if better
 * @param newSchedules - New schedule options to evaluate
 * @returns Best schedule and whether it's better than current
 */
export function suggestBestSchedule(newSchedules: ScheduleList): {
  suggested: Schedule | null;
  isBetterThanCurrent: boolean;
  improvementRatio: number;
  reason: string;
} {
  const currentSchedule = gameState.getCurrentSchedule();
  const bestNew = newSchedules.getBest();
  
  if (!bestNew) {
    return {
      suggested: null,
      isBetterThanCurrent: false,
      improvementRatio: 0,
      reason: "No valid schedules found"
    };
  }
  
  // Calculate current schedule's profit per bottleneck time
  currentSchedule.calculateAll();
  const currentProfitPerHour = calculateProfitPerBottleneckTime(currentSchedule);
  
  // Compare
  const isBetter = bestNew.profitPerHour > currentProfitPerHour;
  const improvement = currentProfitPerHour > 0 
    ? (bestNew.profitPerHour - currentProfitPerHour) / currentProfitPerHour
    : bestNew.profitPerHour > 0 ? 1 : 0;
  
  let reason = "";
  if (isBetter) {
    if (improvement > 0.5) {
      reason = `Significantly better: ${(improvement * 100).toFixed(0)}% more profit per bottleneck hour`;
    } else if (improvement > 0.1) {
      reason = `Moderately better: ${(improvement * 100).toFixed(0)}% more profit per bottleneck hour`;
    } else {
      reason = `Slightly better: ${(improvement * 100).toFixed(0)}% more profit per bottleneck hour`;
    }
  } else {
    reason = currentProfitPerHour === 0 
      ? "Current schedule is empty, any orders would be better"
      : "Current schedule is more profitable";
  }
  
  return {
    suggested: bestNew,
    isBetterThanCurrent: isBetter,
    improvementRatio: improvement,
    reason
  };
}

/**
 * Main function to optimize order selection
 * @param availableOrders - New orders to consider
 * @param includeCurrentOrders - Whether to include orders already in production
 * @returns Optimization result with suggestion
 */
export function optimizeOrderSelection(
  availableOrders: Order[],
  includeCurrentOrders: boolean = false
): {
  scheduleList: ScheduleList;
  suggestion: ReturnType<typeof suggestBestSchedule>;
  bottleneckAnalysis: ReturnType<typeof identifyBottleneck>;
} {
  // Get orders to consider
  let ordersToConsider = availableOrders;
  if (includeCurrentOrders) {
    const currentOrders = gameState.getCurrentSchedule().getOrders();
    ordersToConsider = [...currentOrders, ...availableOrders];
  }
  
  // Generate and rank schedules
  const scheduleList = generateAndRankSchedules(ordersToConsider);
  
  // Get suggestion
  const suggestion = suggestBestSchedule(scheduleList);
  
  // Get bottleneck analysis for best schedule
  const bottleneckAnalysis = suggestion.suggested 
    ? identifyBottleneck(suggestion.suggested.getOrders())
    : identifyBottleneck([]);
  
  return {
    scheduleList,
    suggestion,
    bottleneckAnalysis
  };
}

// Example usage:
/*
const availableOrders = gameState.getAvailableOrders();
const result = optimizeOrderSelection(availableOrders);

console.log("Best schedule:", result.suggestion.suggested);
console.log("Is better than current?", result.suggestion.isBetterThanCurrent);
console.log("Reason:", result.suggestion.reason);
console.log("Bottleneck station:", result.bottleneckAnalysis.station?.name);
console.log("All ranked schedules:", result.scheduleList.schedules);
*/