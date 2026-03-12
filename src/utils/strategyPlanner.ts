import type { Order } from "./gameState";
import { gameState, FAILURE_FINE_RATIO } from "./gameState";
import type { NormalDistribution } from "./station";

// Re-export NormalDistribution for other modules
export type { NormalDistribution } from "./station";

// ============ DISTRIBUTION UTILITIES ============

/**
 * Add two normal distributions
 */
export function addDistributions(
  a: NormalDistribution,
  b: NormalDistribution,
): NormalDistribution {
  return {
    mean: a.mean + b.mean,
    stdDev: Math.sqrt(a.stdDev * a.stdDev + b.stdDev * b.stdDev),
  };
}

/**
 * Sum multiple normal distributions
 */
export function sumDistributions(
  distributions: NormalDistribution[],
): NormalDistribution {
  return distributions.reduce((sum, dist) => addDistributions(sum, dist), {
    mean: 0,
    stdDev: 0,
  });
}

/**
 * Calculate probability that value from distribution is less than threshold
 * Using normal CDF approximation
 * is there really no library to do these three functions more effectively?
 */
export function probabilityLessThan(
  distribution: NormalDistribution,
  threshold: number,
): number {
  const z = (threshold - distribution.mean) / distribution.stdDev;
  // Approximation of normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const probability =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - probability : probability;
}

// ============ SCHEDULE OBJECTS ============

/**
 * Represents required paper quantities for a schedule
 */
export interface RequiredPapers {
  [colorCode: string]: {
    orderRequirement: number; // Amount needed for orders
    safetyStockGap: number; // Amount to top up safety stock
    totalNeeded: number; // Total to purchase
    currentInventory: number; // What we have now
    pendingDelivery: number; // What is on its way..
  };
}

/**
 * Production schedule with orders and calculations
 */
export class Schedule {
  id: string;
  orderIds: string[]; // Order IDs in execution sequence (references to actual orders)
  scheduleTimeDistribution: NormalDistribution; // Time distribution for completion
  timeMarginDistribution: NormalDistribution; // Buffer time distribution - time we will be unable to do work
  profitDistribution: NormalDistribution; // Profit distribution accounting for risk
  requiredPapers: RequiredPapers; // Paper inventory needed
  expectedProfit: number; // Mean of profit distribution (calculated at end)
  expectedCompletionTime: number; // Mean of time distribution (calculated at end)
  profitPerHour: number; // Expected profit / expected time

  constructor(id: string, orderIds: string[] = []) {
    this.id = id;
    this.orderIds = orderIds;
    this.scheduleTimeDistribution = { mean: 0, stdDev: 0 };
    this.timeMarginDistribution = { mean: 0, stdDev: 0 };
    this.profitDistribution = { mean: 0, stdDev: 0 };
    this.requiredPapers = {};
    this.expectedProfit = 0;
    this.expectedCompletionTime = 0;
    this.profitPerHour = 0;
  }

  /**
   * Get the actual Order objects from gameState based on orderIds
   */
  getOrders(): Order[] {
    const allOrders = gameState.getOrders();
    return this.orderIds
      .map(id => allOrders.find(order => order.id === id))
      .filter(order => order !== undefined) as Order[];
  }

  /**
   * Get time distributions for each order in schedule
   */
  getOrderDistributions(): NormalDistribution[] {
    // TODO: Get from station calculations
    //TODO: MAKE THE GETTING FROM STATION CALCULATIONS
    // For now, placeholder distributions (in milliseconds)
    const orders = this.getOrders();
    return orders.map((order) => ({
      mean: order.quantity * 2 * 60 * 1000, // 2 min per item converted to ms
      stdDev: order.quantity * 0.5 * 60 * 1000, // converted to ms
    }));
  }

  /**
   * Calculate paper requirements for this schedule
   */
  getRequiredInventory(): RequiredPapers {
    const required: RequiredPapers = {};
    const inventory = gameState.getPaperInventory();
    const safetyStock = gameState.getParameters().safetyStock;
    const pendingOrders = gameState.getPendingOrders();

    // Calculate requirements by color
    const orders = this.getOrders();
    for (const order of orders) {
      const colorCode = order.paperColor.code;

      if (!required[colorCode]) {
        const currentInventory = inventory[colorCode] || 0;
        const pendingConsumption = pendingOrders
          .filter((o) => o.paperColor.code === colorCode)
          .reduce((sum, o) => sum + o.quantity, 0);

        required[colorCode] = {
          orderRequirement: 0,
          safetyStockGap: 0,
          totalNeeded: 0,
          currentInventory,
          pendingDelivery: 0, // TODO: Calculate from pending transactions
        };
      }

      required[colorCode].orderRequirement += order.quantity;
    }

    // Calculate totals including safety stock
    for (const colorCode in required) {
      const req = required[colorCode];
      const availableInventory = req.currentInventory - req.orderRequirement;
      const afterOrderInventory = availableInventory - req.orderRequirement;

      req.safetyStockGap = Math.max(0, safetyStock - afterOrderInventory);
      req.totalNeeded = Math.max(
        0,
        req.orderRequirement - availableInventory + req.safetyStockGap,
      );
    }

    this.requiredPapers = required;
    return required;
  }

  /**
   * Calculate completion time distribution for this schedule
   */
  getScheduleCompletionTime(): NormalDistribution {
    // Get time distributions for all orders
    const orderDistributions = this.getOrderDistributions();

    // TODO: Add current WIP order distributions
    // TODO: Account for bottleneck station properly

    // Sum all distributions (simplified - should consider bottleneck)
    const totalDistribution = sumDistributions(orderDistributions);

    this.scheduleTimeDistribution = totalDistribution;
    return totalDistribution;
  }

  /**
   * Calculate profit distribution accounting for risk
   */
  getScheduleEstimatedProfit(): NormalDistribution {
    // Sort orders by due date (minimize lateness)
    const orders = this.getOrders();
    const sortedOrders = [...orders].sort((a, b) => {
      const aDue = a.orderTime + a.leadTime * 60 * 1000; // Convert minutes to ms
      const bDue = b.orderTime + b.leadTime * 60 * 1000;
      return aDue - bDue;
    });

    // Get time distributions
    const orderDistributions = this.getOrderDistributions();

    // Build cumulative time distributions
    let cumulativeTimeDistribution: NormalDistribution = { mean: 0, stdDev: 0 };
    let profitComponents: { profit: number; probability: number }[] = [];

    for (let i = 0; i < sortedOrders.length; i++) {
      const order = sortedOrders[i];

      // Add this order's time to cumulative
      cumulativeTimeDistribution = addDistributions(
        cumulativeTimeDistribution,
        orderDistributions[i],
      );

      // Calculate profit/loss for this order
      const revenue = order.price;
      const paperCost =
        order.quantity * gameState.calculatePaperCurrentWorth(order.paperColor);
      const baseProfit = revenue - paperCost;
      const fine = revenue * FAILURE_FINE_RATIO;

      // Calculate probability of success (completing before deadline)
      // Deadline is the time remaining from now until the order is due
      const now = Date.now();
      const dueTime = order.orderTime + (order.leadTime * 60 * 1000); // leadTime in minutes to ms
      const timeRemaining = Math.max(0, dueTime - now); // Time remaining in ms
      
      const successProbability = probabilityLessThan(
        cumulativeTimeDistribution,
        timeRemaining,
      );

      // Expected value for this order
      const expectedValue =
        baseProfit * successProbability - fine * (1 - successProbability);

      profitComponents.push({
        profit: expectedValue,
        probability: 1, // All orders contribute to total
      });
    }

    // Create profit distribution
    // Mean is sum of expected values
    const totalExpectedProfit = profitComponents.reduce(
      (sum, c) => sum + c.profit,
      0,
    );

    // Std dev accounts for uncertainty in completion times affecting profit
    // Simplified - should use Monte Carlo for accurate distribution
    const profitStdDev = Math.abs(totalExpectedProfit) * 0.2; // 20% uncertainty

    const profitDistribution: NormalDistribution = {
      mean: totalExpectedProfit,
      stdDev: profitStdDev,
    };

    // Update orderIds to match the sorted order
    this.orderIds = sortedOrders.map(order => order.id);
    this.profitDistribution = profitDistribution;

    // Only calculate expected values at the end
    this.expectedProfit = profitDistribution.mean;
    this.expectedCompletionTime = this.scheduleTimeDistribution.mean;
    this.profitPerHour =
      this.expectedCompletionTime > 0
        ? this.expectedProfit / (this.expectedCompletionTime / 60)
        : 0;

    return profitDistribution;
  }

  /**
   * Optimize order sequence for production
   */
  optimizeOrderSequence(): void {
    // Sort by: 1) Due date, 2) Paper color batching, 3) Size
    const orders = this.getOrders();
    orders.sort((a: Order, b: Order) => {
      // First by due date
      const aDue = a.orderTime + a.leadTime * 3600000;
      const bDue = b.orderTime + b.leadTime * 3600000;
      if (aDue !== bDue) return aDue - bDue;

      // Then batch by color
      if (a.paperColor.code !== b.paperColor.code) {
        return a.paperColor.code.localeCompare(b.paperColor.code);
      }

      // Then by size
      return a.size.localeCompare(b.size);
    });
  }

  /**
   * Calculate and update all schedule metrics
   */
  calculateAll(): void {
    this.optimizeOrderSequence();
    this.getRequiredInventory();
    this.getScheduleCompletionTime();
    this.getScheduleEstimatedProfit();
  }
}

/**
 * Collection of schedules for comparison
 */
export class ScheduleList {
  schedules: Schedule[];
  currentBest: string | null; // ID of best schedule by expected profit

  constructor() {
    this.schedules = [];
    this.currentBest = null;
  }

  /**
   * Add a schedule and recalculate best
   */
  addSchedule(schedule: Schedule): void {
    this.schedules.push(schedule);
    this.updateBest();
  }

  /**
   * Update which schedule is best based on expected profit
   */
  updateBest(): void {
    if (this.schedules.length === 0) {
      this.currentBest = null;
      return;
    }

    let bestSchedule = this.schedules[0];
    for (const schedule of this.schedules) {
      if (schedule.expectedProfit > bestSchedule.expectedProfit) {
        bestSchedule = schedule;
      }
    }
    this.currentBest = bestSchedule.id;
  }

  /**
   * Get the best schedule
   */
  getBest(): Schedule | null {
    if (!this.currentBest) return null;
    return this.schedules.find(s => s.id === this.currentBest) || null;
  }
}

// ============ UTILITY FUNCTIONS ============

/**
 * Calculate cost of failure for an order
 */
export function calculateCostOfFailure(order: Order): number {
  return order.price * FAILURE_FINE_RATIO;
}

// ============ EXAMPLE USAGE ============
/*
const schedule = new Schedule("schedule-1", passiveOrders);
schedule.calculateAll(); // Runs all calculations
console.log("Expected profit:", schedule.expectedProfit);
console.log("Time distribution:", schedule.scheduleTimeDistribution);

const scheduleList = new ScheduleList();
scheduleList.addSchedule(schedule);
const best = scheduleList.getBest();
*/
