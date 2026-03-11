// Order calculation utilities for Production Game

import type { Order } from "./orders";
import type { PaperInventory } from "./assets";

/**
 * Calculate the time required to complete a single order
 * @param order - The order to calculate completion time for
 * @param workstationSpeed - Current workstation speed multiplier
 * @returns Time in hours to complete the order
 */
export function calculateOrderCompletionTime(
  order: Order,
  workstationSpeed: number = 1.0,
): number {
  // TODO: Implement calculation based on quantity, size, verse size, etc.
  // Fetch the workstation speeds
  // Find the one with the highest mean (not sure how to do this _perfectly_ yet, I think the one which causes the lowest expected value is what we want, SUGGEST VIA COMMENTS, DON'T CHANGE THE CODE WITHOUT A CHAT FIRST)
  // Order completion time should be the sum of the following normal distributions:
  // The bottleneck station distribution, or the worst case production line (as this is what will hold everything up)
  // The throughput time (or the time it takes for one item to go through all the cells, which is NOT total time for a cell to do n items as that is different.)
  // Bodge distribution, which we will implement (LATER) frontend parameters to add.
  return 0;
}

/**
 * Calculate total production time for multiple orders
 * @param orders - Array of orders to process
 * @param workstationSpeed - Current workstation speed multiplier
 * @returns Total time in hours
 */
export function calculateTotalProductionTime(
  orders: Order[],
  workstationSpeed: number = 1.0,
): number {
  // TODO: Sum up time for all orders, considering batching possibilities
  return 0;
}

/**
 * Check if inventory is sufficient for an order
 * @param order - Order to check
 * @param inventory - Current paper inventory
 * @returns True if inventory is sufficient, false otherwise
 */
export function checkInventoryAvailability(
  order: Order,
  inventory: PaperInventory,
): boolean {
  // TODO: Check if we have enough paper of the right color
  return true;
}

/**
 * Calculate paper sheets needed for an order
 * @param order - Order to calculate for
 * @returns Number of sheets needed
 */
export function calculatePaperNeeded(order: Order): number {
  // TODO: Calculate based on quantity and size
  return 0;
}

/**
 * Calculate the profit margin for an order
 * @param order - Order to calculate profit for
 * @param paperCostPerSheet - Cost per sheet of paper
 * @returns Profit in currency units
 */
export function calculateOrderRevenue(
  order: Order,
  paperCostPerSheet: number = 0.1,
): number {
  // TODO: Calculate revenue minus paper costs
  // THIS NEEDS TO BE MINUS CURRENT PAPER WORTH, COLOURED PAPER GETS WORTH LESS PER OUR DEMAND THROUGHOUT THE GAME, I WILL IMPLEMENT THIS MYSELF DON'T DO FOR ME TODO
  //TODO:
  return 0;
}

