import type { 
  Transaction, 
  PaperInventory, 
  Order,
  OrderStatus 
} from './gameState';
import { 
  PaperColor, 
  PAPER_COLORS, 
  PAPER_COLOR_MAP, 
  gameState,
} from './gameState';

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
    price: 2.0,
    available: true,
    status: "passive",
    progress: 0,
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
  value: any,
  transactions: Transaction[],
  cash: number,
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>,
  setCash: React.Dispatch<React.SetStateAction<number>>
) => {
  const order = orders.find(o => o.id === id);
  if (!order) return orders;

  // Handle status changes that affect cash
  if (field === "status") {
    const oldStatus = order.status;
    const newStatus = value as OrderStatus;
    const failureFineRatio = gameState.getParameters().failureFineRatio;
    
    // `order.price` is the total order value, not a per-unit amount.
    const orderRevenue = order.price;
    const failureFine = orderRevenue * failureFineRatio;
    
    // If changing to failed status, add a fine transaction
    if (newStatus === "failed" && oldStatus !== "failed") {
      const fineTransaction: Transaction = {
        id: `fine-${order.id}-${Date.now()}`,
        timestamp: new Date(),
        amount: -failureFine,
        type: "cash",
        reason: `Order failure fine (${failureFineRatio * 100}% of £${orderRevenue.toFixed(2)} total): ${order.quantity}x ${order.occasion || 'cards'}`,
        orderId: order.id,
      };
      setTransactions(prev => [...prev, fineTransaction]);
      setCash(prev => prev - failureFine);
    }
    
    // If changing from failed to another status, remove the fine (add credit)
    if (oldStatus === "failed" && newStatus !== "failed" && newStatus !== "deleted") {
      // Find and reverse the fine transaction
      const fineTransaction = transactions.find(t => t.orderId === order.id && t.amount < 0 && t.reason?.includes('failure fine'));
      if (fineTransaction) {
        const refundTransaction: Transaction = {
          id: `refund-${order.id}-${Date.now()}`,
          timestamp: new Date(),
          amount: Math.abs(fineTransaction.amount),
          type: "cash",
          reason: `Order failure fine reversed: ${order.quantity}x ${order.occasion || 'cards'}`,
          orderId: order.id,
        };
        setTransactions(prev => [...prev, refundTransaction]);
        setCash(prev => prev + Math.abs(fineTransaction.amount));
      }
    }
    
    // If changing to approved status, collect payment
    if (newStatus === "approved" && oldStatus !== "approved") {
      const paymentTransaction: Transaction = {
        id: `payment-${order.id}-${Date.now()}`,
        timestamp: new Date(),
        amount: orderRevenue,
        type: "cash",
        reason: `Order payment received: ${order.quantity}x ${order.occasion || 'cards'} for £${orderRevenue.toFixed(2)} total`,
        orderId: order.id,
      };
      setTransactions(prev => [...prev, paymentTransaction]);
      setCash(prev => prev + orderRevenue);
    }
    
    // If changing from approved to another status (except failed/deleted), reverse the payment
    if (oldStatus === "approved" && newStatus !== "approved" && newStatus !== "failed" && newStatus !== "deleted") {
      // Find and reverse the payment transaction
      const paymentTransaction = transactions.find(t => t.orderId === order.id && t.amount > 0 && t.reason?.includes('payment received'));
      if (paymentTransaction) {
        const reversalTransaction: Transaction = {
          id: `reversal-${order.id}-${Date.now()}`,
          timestamp: new Date(),
          amount: -paymentTransaction.amount,
          type: "cash",
          reason: `Order payment reversed: ${order.quantity}x ${order.occasion || 'cards'}`,
          orderId: order.id,
        };
        setTransactions(prev => [...prev, reversalTransaction]);
        setCash(prev => prev - paymentTransaction.amount);
      }
    }
  }
  
  // Handle setting startTime and dueTime when order moves to active status
  if (field === "status") {
    const activeStatuses = ["ordered", "pending_inventory", "WIP", "sent", "approved"];
    const inactiveStatuses = ["passive", "failed", "deleted", "other"];
    
    const updatedOrder = { ...order, [field]: value };
    const nextStatus = value as OrderStatus;

    if (nextStatus === "pending_inventory") {
      updatedOrder.progress = 0;
    } else if (
      (nextStatus === "ordered" || nextStatus === "WIP") &&
      updatedOrder.progress === 0
    ) {
      updatedOrder.progress = 1;
    } else if (nextStatus === "sent" || nextStatus === "approved") {
      updatedOrder.progress = 3;
    }
    
    // If moving from inactive to active status, set startTime and dueTime
    if (inactiveStatuses.includes(order.status) && activeStatuses.includes(value as string)) {
      if (!updatedOrder.startTime) {
        updatedOrder.startTime = Date.now();
      }
      if (!updatedOrder.dueTime && updatedOrder.leadTime > 0) {
        updatedOrder.dueTime = updatedOrder.startTime + (updatedOrder.leadTime * 60 * 1000); // leadTime is in minutes
      }
    }
    
    // If moving from active to inactive status, clear startTime and dueTime
    if (activeStatuses.includes(order.status) && inactiveStatuses.includes(value as string)) {
      delete updatedOrder.startTime;
      delete updatedOrder.dueTime;
    }
    
    return orders.map((o) =>
      o.id === id ? updatedOrder : o,
    );
  }
  
  return orders.map((o) =>
    o.id === id ? { ...o, [field]: value } : o,
  );
};
