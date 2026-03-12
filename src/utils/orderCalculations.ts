// Order calculation utilities for Production Game

import type { PaperInventory, Order } from "./gameState";
import { gameState } from "./gameState";

/**
 * Calculate the time required to complete a single order
 * @param order - The order to calculate completion time for
 * @param workstationSpeed - Current workstation speed multiplier
 * @returns Time in hours to complete the order
 */
export function calculateOrderCompletionTime(
  order: Order,
): number {
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
  return 0;
}

/**
 * Calculate total production time for multiple orders
 * @param orders - Array of orders to process
 * @param workstationSpeed - Current workstation speed multiplier
 * @returns Total time in hours
 */
export function calculateTotalThroughputTime(
  orders: Order[],
	//STATION DATA NEEDED
): number {
	// THIS SHOULD BE TOTAL THORUGHPUT DISTRIBUTION, WHICH IS SUM OF STATIONS (Ignoring station 5, done in paralell, via default slider down)
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
	// This can include safety stock
	// THIS MUST NOT INCLUDE PAPER DIBSED BY ORDERS - ORDERS SHOULD REMOVE PAPER FROM INVENTORY WHEN APPROVED
  return true;
}

/**
 * Calculate paper sheets needed for an order
 * @param order - Order to calculate for
 * @returns Number of sheets needed
 */
export function calculatePaperNeededInOrder(order: Order): number {
  // TODO: Calculate based on quantity
	we need to fetch inventory and check what we have
	we also need to see if we need to reorder paper to top up safety stock, this will NOT slow us down so we should bear in mind. 
		order.quantity order.papercolor.name inventory <- is inventory an object?
		WAIT THIS SHOULD RETURN TOTAL AMOUNT INCLUDING SAFETY STOCK REPLENISHMENT <- but should know about pending orders too.

		When we display what needs to be ordered we should show:
			how much this order needs
			desired safety stock
			current orders
			current inventory

			so the user can see it all properly
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
  let number totalPaperCost =  order.paperColor * quantity
  return order.price;
}

