// Order calculation utilities for Production Game

import type { PaperInventory, Order } from "./gameState";
import { gameState } from "./gameState";

/**
 * Calculate the time required to complete a single order
 * @param order - The order to calculate completion time for
 * @param workstationSpeed - Current workstation speed multiplier - actually no that should be done before maybe. we could do station.getTimeForOrder(). NB the station needs to be linked to a game object so we can do simulations later.
 * @returns Time distribuition in minutes to complete the order
 */
export function calculateOrderCompletionTime(order: Order): number {
  // TODO: Implement calculation based on quantity, size, verse size, etc.
  // Fetch the workstation speeds
  // Find the one with the highest mean (not sure how to do this _perfectly_ yet, I think the one which causes the lowest expected value is what we want, SUGGEST VIA COMMENTS, DON'T CHANGE THE CODE WITHOUT A CHAT FIRST)
  // Order completion time should be the sum of the following normal distributions:
  // The bottleneck station distribution, or the worst case production line (as this is what will hold everything up) The throughput time (or the time it takes for one item to go through all the cells, which is NOT total time for a cell to do n items as that is different.)
  // Bodge distribution, which we will implement (LATER) frontend parameters to add.

  // THIS IS WHERE IT GETS FUN
  // WE NEED TO DO FOR ALL STATIONS, FIND THE TOTAL THROUGHPUT DISTRIBUTION AND ADD THE BOTTLENECK DISTRIBUTION TOO THIS

  //NB Station 5 team writing shouldn't be included as it's in paralell. but we should sort that with a slider down by default.

  // SHUOLD INCLUDE IF INVENTORY IS NEEDED!

  // SHOULD INCLUDE IF BOTTLENECK IS OCCUPIED

  //This is actually not any harder than total throughput time, we just add the time to make the item at bottleneck * the quantity in the order..
  return 0;
}

/**
 * Calculate total production time for multiple orders
 * @param orders - Array of orders to process
 * @param workstationSpeed - Current workstation speed multiplier
 * @returns Normal distribution in seconds of time taken to complete the system. Each station should have a distribution property for each order size.
 */
export function calculateTotalThroughputTime(
  orders: Order[],
  //STATION DATA NEEDED
): number {
  // THIS SHOULD BE TOTAL THORUGHPUT DISTRIBUTION, WHICH IS SUM OF STATIONS (Ignoring station 5, done in paralell, via default slider down)
  //Thius should output a normal distribution
  return 0;
}

// Calculating inventory stuff is done on a per schedule order situation, rather than a per order situation, as in a group they would be ordered together, and it messes it up if they don't know about their requirements.

/**
 * Calculate the profit margin for an order
 * @param order - Order to calculate profit for
 * @returns Profit in currency units
 */
export function calculateOrderRevenue(order: Order): number {
  // Calculate total paper cost based on current market value
  const paperColor = order.paperColor;
  const currentPaperWorth = gameState.calculatePaperCurrentWorth(paperColor);
  const totalPaperWorth = order.quantity * currentPaperWorth;

  // Revenue is the order price minus the current worth of paper
  // (what we could sell the paper for right now, not what we paid)
  return order.price - totalPaperWorth; //The order price is the total price
}
