import type { 
  Transaction, 
  PaperInventory, 
  Order,
  OrderStatus 
} from './gameState';
import { 
  ENVELOPE_CODE,
  PAPER_COLORS, 
  PAPER_COLOR_MAP, 
  gameState,
} from './gameState';

const PAPER_CONSUMING_STATUSES = new Set<OrderStatus>([
  "WIP",
  "sent",
  "approved",
  "failed",
]);

export function getOrderInventoryRequirements(
  order: Pick<Order, "paperColor" | "quantity">,
): Record<string, number> {
  return {
    [order.paperColor.code]: order.quantity,
    [ENVELOPE_CODE]: order.quantity,
  };
}

export function hasInventoryForOrder(
  order: Pick<Order, "paperColor" | "quantity">,
  paperInventory: PaperInventory,
): boolean {
  return Object.entries(getOrderInventoryRequirements(order)).every(
    ([itemCode, quantity]) => (paperInventory[itemCode] || 0) >= quantity,
  );
}

export function allocatePaperForOrderIfNeeded(
  order: Order,
  nextStatus: OrderStatus,
  paperInventory: PaperInventory,
): { order: Order; paperInventory: PaperInventory; allocatedNow: boolean } {
  if (order.paperAllocated || !PAPER_CONSUMING_STATUSES.has(nextStatus)) {
    return {
      order,
      paperInventory,
      allocatedNow: false,
    };
  }

  const requirements = getOrderInventoryRequirements(order);
  if (
    Object.entries(requirements).some(
      ([itemCode, quantity]) => (paperInventory[itemCode] || 0) < quantity,
    )
  ) {
    return {
      order,
      paperInventory,
      allocatedNow: false,
    };
  }

  const nextInventory = { ...paperInventory };
  Object.entries(requirements).forEach(([itemCode, quantity]) => {
    nextInventory[itemCode] = (nextInventory[itemCode] || 0) - quantity;
  });

  return {
    order: {
      ...order,
      paperAllocated: true,
    },
    paperInventory: nextInventory,
    allocatedNow: true,
  };
}

export function releasePaperAllocationForOrder(
  order: Order,
  paperInventory: PaperInventory,
): { order: Order; paperInventory: PaperInventory; releasedNow: boolean } {
  if (!order.paperAllocated) {
    return {
      order,
      paperInventory,
      releasedNow: false,
    };
  }

  const requirements = getOrderInventoryRequirements(order);
  const nextInventory = { ...paperInventory };
  Object.entries(requirements).forEach(([itemCode, quantity]) => {
    nextInventory[itemCode] = (nextInventory[itemCode] || 0) + quantity;
  });

  return {
    order: {
      ...order,
      paperAllocated: false,
    },
    paperInventory: nextInventory,
    releasedNow: true,
  };
}

export function createOrderAllocationTransactions(
  order: Order,
  category: "inventory_allocation" | "inventory_return",
): Transaction[] {
  const quantityMultiplier = category === "inventory_allocation" ? -1 : 1;
  const actionLabel = category === "inventory_allocation" ? "Allocated" : "Returned";

  return Object.entries(getOrderInventoryRequirements(order)).map(
    ([itemCode, quantity]) =>
      gameState.createTransaction(
        0,
        `${actionLabel} ${quantity} ${gameState.getColorName(itemCode)} for order ${order.id}`,
        "paper",
        itemCode,
        quantity * quantityMultiplier,
        order.id,
        false,
        undefined,
        {
          category,
          financeBucket: "neutral",
          metricContribution: 0,
          inventoryValueDelta: 0,
        },
      ),
  );
}

// Order constants
export const OCCASIONS = [
  "Christmas",
  "New Year",
  "Wife's Birthday",
  "Father's Birthday",
  "Get Well Soon",
  "Baby Girl",
  "Baby Triplets",
  "Good Luck",
  "St David's Day",
  "Mother's Day",
  "Examination Pass",
  "Marriage",
  "Pregnancy",
  "New Job",
  "18 Birthday",
  "Driving Test Pass",
  "New Home",
  "Passover",
  "Easter",
  "Silver Wedding",
]; // Must have the ability to add new occasions

export const PRODUCTION_PIPELINE_STATUSES: OrderStatus[] = [
  "ordered",
  "pending_inventory",
  "WIP",
  "sent",
  "approved",
  "failed",
];

export const getProductionScheduleOrderIds = (orders: Order[]): string[] =>
  orders
    .filter((order) => PRODUCTION_PIPELINE_STATUSES.includes(order.status))
    .map((order) => order.id);

export const normalizeScheduleOrderIds = (
  orders: Order[],
  scheduleOrderIds: string[],
): string[] => {
  const activeOrderIds = getProductionScheduleOrderIds(orders);
  const activeOrderIdSet = new Set(activeOrderIds);
  const normalized = scheduleOrderIds.filter((orderId) =>
    activeOrderIdSet.has(orderId),
  );

  activeOrderIds.forEach((orderId) => {
    if (!normalized.includes(orderId)) {
      normalized.push(orderId);
    }
  });

  return normalized;
};

export const getScheduledProductionOrders = (
  orders: Order[],
  scheduleOrderIds: string[],
): Order[] => {
  const orderMap = new Map(orders.map((order) => [order.id, order]));

  return normalizeScheduleOrderIds(orders, scheduleOrderIds)
    .map((orderId) => orderMap.get(orderId))
    .filter((order): order is Order => order !== undefined);
};

export const reorderScheduleOrderIds = (
  scheduleOrderIds: string[],
  draggedOrderId: string,
  targetOrderId: string,
  position: "before" | "after",
): string[] => {
  if (draggedOrderId === targetOrderId) {
    return scheduleOrderIds;
  }

  const draggedIndex = scheduleOrderIds.indexOf(draggedOrderId);
  const targetIndex = scheduleOrderIds.indexOf(targetOrderId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return scheduleOrderIds;
  }

  const nextOrderIds = [...scheduleOrderIds];
  nextOrderIds.splice(draggedIndex, 1);

  let insertIndex = targetIndex + (position === "after" ? 1 : 0);
  if (draggedIndex < insertIndex) {
    insertIndex -= 1;
  }

  nextOrderIds.splice(insertIndex, 0, draggedOrderId);
  return nextOrderIds;
};

export const reorderOrders = (
  orders: Order[],
  draggedOrderId: string,
  targetOrderId: string,
  position: "before" | "after",
): Order[] => {
  if (draggedOrderId === targetOrderId) {
    return orders;
  }

  const draggedIndex = orders.findIndex((order) => order.id === draggedOrderId);
  const targetIndex = orders.findIndex((order) => order.id === targetOrderId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return orders;
  }

  const nextOrders = [...orders];
  const [draggedOrder] = nextOrders.splice(draggedIndex, 1);

  let insertIndex = targetIndex + (position === "after" ? 1 : 0);
  if (draggedIndex < insertIndex) {
    insertIndex -= 1;
  }

  nextOrders.splice(insertIndex, 0, draggedOrder);
  return nextOrders;
};

// Add new order
export const addOrder = (): Order => {
  // Default to white paper
  const defaultColor = PAPER_COLOR_MAP.get("w") || PAPER_COLORS[0];
  
  const newOrder: Order = {
    id: Date.now().toString(),
    orderTime: Date.now(),
    quantity: 50,
    leadTime: 7,
    paperColor: defaultColor,
    size: "A5",
    verseSize: 4,
    occasion: "",
    title: "",
    price: 2.0,
    available: true,
    status: "passive",
    progress: 0,
    paperAllocated: false,
  };
  return newOrder;
};

// Delete most recent passive order
export const deleteRecentOrder = (orders: Order[]): Order[] => {
  // Find the most recent (last in array) order with passive status
  let recentPassiveIndex = -1;
  for (let i = orders.length - 1; i >= 0; i--) {
    if (orders[i].status === "passive") {
      recentPassiveIndex = i;
      break;
    }
  }
  if (recentPassiveIndex !== -1) {
    return orders.map((order, index) =>
      index === recentPassiveIndex
        ? { ...order, status: "deleted" as OrderStatus }
        : order,
    );
  }
  return orders;
};

// Update order
export const updateOrder = (
  orders: Order[],
  id: string,
  field: keyof Order,
  value: unknown,
  paperInventory: PaperInventory,
  setPaperInventory: React.Dispatch<React.SetStateAction<PaperInventory>>,
  transactions: Transaction[],
  cash: number,
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>,
  setCash: React.Dispatch<React.SetStateAction<number>>
) => {
  const order = orders.find(o => o.id === id);
  if (!order) return orders;
  const appendTransactions = (newTransactions: Transaction[]) => {
    if (!newTransactions.length) {
      return;
    }

    setTransactions(prev => [...prev, ...newTransactions]);
  };

  // Handle status changes that affect cash
  if (field === "status") {
    const oldStatus = order.status;
    const newStatus = value as OrderStatus;
    const failureFineRatio = gameState.getParameters().failureFineRatio;
    
    // `order.price` is the total order value, not a per-unit amount.
    const orderRevenue = order.price;
    const materialWorth = gameState.calculateOrderConsumableCurrentWorth(order.paperColor);
    const failureFine = orderRevenue * failureFineRatio + materialWorth * order.quantity;
    
    // If changing to failed status, add a fine transaction
    if (newStatus === "failed" && oldStatus !== "failed") {
      const fineTransaction = gameState.createTransaction(
        -failureFine,
        `Order failure fine (${failureFineRatio * 100}% of £${orderRevenue.toFixed(2)} total plus materials): ${order.quantity}x ${order.occasion || 'cards'}`,
        "cash",
        undefined,
        undefined,
        order.id,
        false,
        undefined,
        {
          category: "fine",
          financeBucket: "operating_expense",
          metricContribution: failureFine,
          inventoryValueDelta: 0,
        },
      );
      appendTransactions([fineTransaction]);
      setCash(prev => prev - failureFine);
    }
    
    // If changing from failed to another status, remove the fine (add credit)
    if (oldStatus === "failed" && newStatus !== "failed" && newStatus !== "deleted") {
      // Find and reverse the fine transaction
      const fineTransaction = transactions.find(t => t.orderId === order.id && t.amount < 0 && t.reason?.includes('failure fine'));
      if (fineTransaction) {
        const refundAmount = Math.abs(fineTransaction.amount);
        const refundTransaction = gameState.createTransaction(
          refundAmount,
          `Order failure fine reversed: ${order.quantity}x ${order.occasion || 'cards'}`,
          "cash",
          undefined,
          undefined,
          order.id,
          false,
          undefined,
          {
            category: "fine",
            financeBucket: "operating_expense",
            metricContribution: -refundAmount,
            inventoryValueDelta: 0,
          },
        );
        appendTransactions([refundTransaction]);
        setCash(prev => prev + Math.abs(fineTransaction.amount));
      }
    }
    
    // If changing to approved status, collect payment
    if (newStatus === "approved" && oldStatus !== "approved") {
      const paymentTransaction = gameState.createTransaction(
        orderRevenue,
        `Order payment received: ${order.quantity}x ${order.occasion || 'cards'} for £${orderRevenue.toFixed(2)} total`,
        "cash",
        undefined,
        undefined,
        order.id,
        false,
        undefined,
        {
          category: "order_income",
          financeBucket: "revenue",
          metricContribution: orderRevenue,
          inventoryValueDelta: 0,
        },
      );
      appendTransactions([paymentTransaction]);
      setCash(prev => prev + orderRevenue);
    }
    
    // If changing from approved to another status (except failed/deleted), reverse the payment
    if (oldStatus === "approved" && newStatus !== "approved" && newStatus !== "failed" && newStatus !== "deleted") {
      // Find and reverse the payment transaction
      const paymentTransaction = transactions.find(t => t.orderId === order.id && t.amount > 0 && t.reason?.includes('payment received'));
      if (paymentTransaction) {
        const reversalAmount = paymentTransaction.amount;
        const reversalTransaction = gameState.createTransaction(
          -reversalAmount,
          `Order payment reversed: ${order.quantity}x ${order.occasion || 'cards'}`,
          "cash",
          undefined,
          undefined,
          order.id,
          false,
          undefined,
          {
            category: "order_income",
            financeBucket: "revenue",
            metricContribution: -reversalAmount,
            inventoryValueDelta: 0,
          },
        );
        appendTransactions([reversalTransaction]);
        setCash(prev => prev - paymentTransaction.amount);
      }
    }
  }
  
  // Handle setting startTime and dueTime when order moves to active status
  if (field === "status") {
    const activeStatuses = ["ordered", "pending_inventory", "WIP", "sent", "approved"];
    const inactiveStatuses = ["passive", "failed", "deleted", "other"];
    
    const nextStatus = value as OrderStatus;
    const updatedOrder: Order = {
      ...order,
      status: nextStatus,
    };
    let nextInventory = paperInventory;
    let nextOrder = updatedOrder;
    const lifecycleTransactions: Transaction[] = [];

    if (
      order.paperAllocated &&
      PAPER_CONSUMING_STATUSES.has(order.status) &&
      !PAPER_CONSUMING_STATUSES.has(nextStatus)
    ) {
      const releaseResult = releasePaperAllocationForOrder(order, nextInventory);
      nextInventory = releaseResult.paperInventory;
      nextOrder = releaseResult.order;
      if (releaseResult.releasedNow) {
        lifecycleTransactions.push(
          ...createOrderAllocationTransactions(order, "inventory_return"),
        );
      }
    }

    const allocationResult = allocatePaperForOrderIfNeeded(
      nextOrder,
      nextStatus,
      nextInventory,
    );
    nextOrder = allocationResult.order;
    nextInventory = allocationResult.paperInventory;
    if (allocationResult.allocatedNow) {
      lifecycleTransactions.push(
        ...createOrderAllocationTransactions(nextOrder, "inventory_allocation"),
      );
    }

    if (
      lifecycleTransactions.length ||
      nextInventory !== paperInventory
    ) {
      setPaperInventory(nextInventory);
    }
    if (lifecycleTransactions.length) {
      appendTransactions(lifecycleTransactions);
    }

    if (nextStatus === "pending_inventory") {
      nextOrder.progress = 0;
    } else if (
      (nextStatus === "ordered" || nextStatus === "WIP") &&
      nextOrder.progress === 0
    ) {
      nextOrder.progress = 1;
    } else if (nextStatus === "sent" || nextStatus === "approved") {
      nextOrder.progress = 3;
    }
    
    // If moving from inactive to active status, set startTime and dueTime
    if (inactiveStatuses.includes(order.status) && activeStatuses.includes(value as string)) {
      if (!nextOrder.startTime) {
        nextOrder.startTime = Date.now();
      }
      if (!nextOrder.dueTime && nextOrder.leadTime > 0) {
        nextOrder.dueTime = nextOrder.startTime + (nextOrder.leadTime * 60 * 1000); // leadTime is in minutes
      }
    }
    
    // If moving from active to inactive status, clear startTime and dueTime
    if (activeStatuses.includes(order.status) && inactiveStatuses.includes(value as string)) {
      delete nextOrder.startTime;
      delete nextOrder.dueTime;
    }
    
    return orders.map((o) =>
      o.id === id ? nextOrder : o,
    );
  }
  
  return orders.map((o) =>
    o.id === id ? { ...o, [field]: value } : o,
  );
};
