

// a function to derive expected profit with this strategy (overall), including forecasted plan for afterwards...

// a fucntion to derive 

make a scheduleListObject with the following things:
an ordered list of schedules, with ID's or another way for us to sort them later


make a schedule object with the following things:
order list of all orders, in order
an estimated profit 
an estimated time consumption of "bottleneck"
an estimated time margin or error
an estimated profit / time consumption
scheduleTimeDistribution - will give us time consumption at bottleneck etc..
variables above ^
requiredPapers Dict

then the following scripts:
getOrderDistributions

getRequiredInventory - updates the requried papers thing

getScheduleCompletionTime
	- must include time to complete currently accepted orders, which will have estimated progress variables.
	- will then use the distributions to make a final distribution

getScheduleEstimatedProfit
	- should sort the orders by minimum lateness risk (earliest due date first, then next)
	- then should summate the amount we win if we make it vs chance of making it plus fine if we loose plus chance of loosing for each order we take on.
	- updateEstimatedProfit and other parameters

/**
 * Estimate risk of failure for an order
 * @param order - Order to assess
 * @param currentWorkload - Current total workload in hours
 * @returns Risk percentage (0-100)
 */
export function expectedProfit(
  order: Order,
  currentWorkload: number,
): number {
	time calculations go here...
  // TODO: Calculate based on lead time vs production time
  // This is probaby on a schedule basis
  return 0;
}

/**
 * Calculate time margin (buffer time) for an order
 * @param productionSchedule - Estimated production time in hours
 * @returns Time margin in hours (can be negative if behind schedule)
 */
export function calculateTimeMargin(
): number {
  // TODO: Calculate lead time minus production time
	// This is on a schedule basis too...
  return 0;
}

/**
 * Determine optimal order sequence for production
 * @param orders - Array of orders to sequence
 * @returns Reordered array for optimal production
 */
export function optimizeOrderSequence(orders: Order[]): Order[] {
  // TODO: Sort by priority, deadline, paper color batching, etc.
  return orders;
}

/**
 * Calculate cost of failure for an order
 * @param order - Order that might fail
 * @returns Cost in currency units
 */
export function calculateCostOfFailure(order: Order): number {
  // TODO: late cost = failed order cost = 
  return 0;
}

/**
 * Calculate reward/risk ratio
 * @param profit - Expected profit
 * @param riskPercentage - Risk of failure (0-100)
 * @param costOfFailure - Cost if order fails
 * @returns Reward/risk ratio
 */
export function calculateRewardRiskRatio(
  profit: number,
  riskPercentage: number,
  costOfFailure: number,
): number {
  // TODO: Calculate expected value considering risk
  return 0;
}


/**
 * Calculate paper sheets needed for an order
 * Schedule to calculate for...
 * @param parameter
 * @returns Number of sheets needed
 */
export function calculatePaperNeededInSchedule( SCHEDULE): number {
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

export function calculatePaperNeededInOrder(order: Order): number {
    const colorCode = order.paperColor.code;
    const currentInventory = gameState.getPaperInventory()[colorCode] || 0; //The colourCode is used as an index.
    const safetyStock = gameState.getParameters().safetyStock;

    // Pending orders will consume colours upon being accepted. 
    const pendingOrders = gameState.getPendingOrders();
    const pendingConsumption = pendingOrders
      .filter(o => o.id !== order.id && o.paperColor.code === colorCode)
      .reduce((sum, o) => sum + o.quantity, 0);

    // Available inventory after pending orders
    const availableInventory = currentInventory - pendingConsumption;

    // Paper needed for this specific order
    const orderRequirement = order.quantity;

    // Calculate total needed including safety stock replenishment
    const afterOrderInventory = availableInventory - orderRequirement;
    const safetyStockGap = Math.max(0, safetyStock - afterOrderInventory);

    // If we already have enough, return 0
    if (availableInventory >= orderRequirement + safetyStock) {
      return 0;
    }

    // Return what we need to order (including safety stock top-up)
    return Math.max(0, orderRequirement - availableInventory + safetyStockGap);
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

export function calculatePaperNeededInOrder(order: Order): number {
    const colorCode = order.paperColor.code;
    const currentInventory = gameState.getPaperInventory()[colorCode] || 0; //The colourCode is used as an index.
    const safetyStock = gameState.getParameters().safetyStock;

    // Pending orders will consume colours upon being accepted. 
    const pendingOrders = gameState.getPendingOrders();
    const pendingConsumption = pendingOrders
      .filter(o => o.id !== order.id && o.paperColor.code === colorCode)
      .reduce((sum, o) => sum + o.quantity, 0);

    // Available inventory after pending orders
    const availableInventory = currentInventory - pendingConsumption;

    // Paper needed for this specific order
    const orderRequirement = order.quantity;

    // Calculate total needed including safety stock replenishment
    const afterOrderInventory = availableInventory - orderRequirement;
    const safetyStockGap = Math.max(0, safetyStock - afterOrderInventory);

    // If we already have enough, return 0
    if (availableInventory >= orderRequirement + safetyStock) {
      return 0;
    }

    // Return what we need to order (including safety stock top-up)
    return Math.max(0, orderRequirement - availableInventory + safetyStockGap);
  }
