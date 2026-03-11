import { Order, OrderStatus } from './orders';
import { PaperColor, PAPER_COLORS } from './assets';

// Fuzzy search for occasions
export const fuzzySearch = (query: string, items: string[]) => {
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  return items
    .filter((item) => {
      const lowerItem = item.toLowerCase();
      return (
        lowerItem.includes(lowerQuery) ||
        lowerQuery.split("").every((char) => lowerItem.includes(char))
      );
    })
    .sort((a, b) => {
      const aStart = a.toLowerCase().startsWith(lowerQuery);
      const bStart = b.toLowerCase().startsWith(lowerQuery);
      if (aStart && !bStart) return -1;
      if (!aStart && bStart) return 1;
      return 0;
    });
};

// Color mapping for paper colors
export const getColorClass = (color: PaperColor) => {
  const colorDef = PAPER_COLORS.find(
    (c) => c.code === color || c.name === color,
  );
  return colorDef?.class || "bg-gray-100";
};

// Get row color based on availability and status
export const getRowColorClass = (order: Order) => {
  if (order.status === "deleted") {
    return "opacity-30";
  }
  if (order.status === "failed") {
    return "opacity-50 bg-red-50";
  }
  if (!order.available) {
    return "opacity-40";
  }
  if (order.status === "approved" || order.status === "sent") {
    return "opacity-60";
  }
  return "";
};

// Format order time
export const formatOrderTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Status color coding
export const getStatusColor = (status: OrderStatus) => {
  const statusColors: { [key: string]: string } = {
    passive: "text-gray-600 bg-gray-50",
    ordered: "text-blue-600 bg-blue-50",
    pending_inventory: "text-yellow-600 bg-yellow-50",
    WIP: "text-purple-600 bg-purple-50",
    sent: "text-green-600 bg-green-50",
    approved: "text-teal-600 bg-teal-50",
    failed: "text-red-600 bg-red-100 font-bold",
    deleted: "text-red-600 line-through bg-red-50",
    other: "text-gray-600 bg-gray-50",
  };
  return statusColors[status];
};

// Timer formatting
export const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

// Timer management functions
export const startCooldownTimer = (
  cooldownTimer: NodeJS.Timeout | null,
  buyingCooldown: number,
  setBuyingCooldown: React.Dispatch<React.SetStateAction<number>>,
  setCooldownTimer: React.Dispatch<React.SetStateAction<NodeJS.Timeout | null>>
) => {
  if (cooldownTimer) clearInterval(cooldownTimer);
  if (buyingCooldown === 0) setBuyingCooldown(300); // Default 5 minutes if starting from 0
  const timer = setInterval(() => {
    setBuyingCooldown((prev) => {
      if (prev <= 1) {
        clearInterval(timer);
        setCooldownTimer(null);
        return 0;
      }
      return prev - 1;
    });
  }, 1000);
  setCooldownTimer(timer);
};

export const stopCooldownTimer = (
  cooldownTimer: NodeJS.Timeout | null,
  setCooldownTimer: React.Dispatch<React.SetStateAction<NodeJS.Timeout | null>>
) => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    setCooldownTimer(null);
  }
};

export const resetCooldownTimer = (
  cooldownTimer: NodeJS.Timeout | null,
  setCooldownTimer: React.Dispatch<React.SetStateAction<NodeJS.Timeout | null>>,
  setBuyingCooldown: React.Dispatch<React.SetStateAction<number>>
) => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    setCooldownTimer(null);
  }
  setBuyingCooldown(300); // Reset to 5 minutes
};

export const updateCooldownTime = (
  newTime: number,
  cooldownTimer: NodeJS.Timeout | null,
  setBuyingCooldown: React.Dispatch<React.SetStateAction<number>>
) => {
  if (!cooldownTimer && newTime >= 0) {
    setBuyingCooldown(newTime);
  }
};