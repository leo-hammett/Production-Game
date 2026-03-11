import { useState, useEffect, useRef } from "react";
import "./App.css";

// Types
type OrderStatus =
  | "passive"
  | "ordered"
  | "pending_inventory"
  | "WIP"
  | "sent"
  | "approved"
  | "deleted"
  | "other";
type PaperColor = "w" | "g" | "p" | "y" | "b" | "s" | string; //other colours must be addable

interface Order {
  id: string;
  orderTime: number; // timestamp when order was placed
  quantity: number;
  leadTime: number; // -1 means infinite
  paperColor: PaperColor;
  size: string; // A5, A6, A7
  verseSize: number;
  occasion: string;
  price: number;
  available: boolean;
  status: OrderStatus;
  startTime?: number;
  dueTime?: number;
}

interface PaperInventory {
  [color: string]: number;
}

interface Transaction {
  id: string;
  timestamp: Date;
  amount: number; // positive for income, negative for expenses
  type: "cash" | "paper";
  paperColor?: string;
  paperQuantity?: number;
  reason?: string; // Optional reason
  affectsInventory?: boolean; // For non-paper inventory purchases
}

let OCCASIONS = [
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

function App() {
  // Resizable panes state
  const [leftPaneWidth, setLeftPaneWidth] = useState(70); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);

  const [orders, setOrders] = useState<Order[]>([
    {
      id: "1",
      orderTime: Date.now(),
      quantity: 12,
      leadTime: 15,
      paperColor: "w",
      size: "A5",
      verseSize: 4,
      occasion: "Birthday",
      price: 0,
      available: true,
      status: "passive",
    },
  ]); //can someone update this comment to tell me if we need to pre-populate these values, I'd much rather leave some of them blank.

  const [showUndo, setShowUndo] = useState(false);
  const [previousOrders, setPreviousOrders] = useState<Order[]>([]);
  const [occasionSearch, setOccasionSearch] = useState("");
  const [filteredOccasions, setFilteredOccasions] = useState<string[]>([]);
  const [activeOccasionIndex, setActiveOccasionIndex] = useState(-1);
  const occasionInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>(
    {},
  );
  const colorInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const [activeColorIndex, setActiveColorIndex] = useState(-1);
  const [colorSearch, setColorSearch] = useState("");
  const [filteredColors, setFilteredColors] = useState<string[]>([]);

  // Inventory Management State - the game starts with nothing, then we will manually buy
  const [paperInventory, setPaperInventory] = useState<PaperInventory>({
    w: 0,
    g: 0,
    p: 0,
    y: 0,
    b: 0,
    s: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cash, setCash] = useState(0); // Game starts with no cash
  const [safetyStock, setSafetyStock] = useState(12);
  const [buyingCooldown, setBuyingCooldown] = useState(0);
  const [cooldownTimer, setCooldownTimer] = useState<NodeJS.Timeout | null>(
    null,
  );
  const [workstationSpeed, setWorkstationSpeed] = useState(1.0);

  // Fuzzy search for occasions
  const fuzzySearch = (query: string, items: string[]) => {
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

  // Fixed markdown for selling price (we lose money on excess stock)
  const SELL_MARKDOWN = 0.7; // 30% loss when selling excess stock

  // Color definitions with prices in pounds
  const PAPER_COLORS = [
    { code: "w", name: "White", class: "bg-white", price: 10 },
    { code: "g", name: "Green", class: "bg-green-100", price: 20 },
    { code: "p", name: "Pink", class: "bg-pink-100", price: 20 },
    { code: "y", name: "Yellow", class: "bg-yellow-100", price: 20 },
    { code: "b", name: "Blue", class: "bg-blue-100", price: 20 },
    { code: "s", name: "Salmon", class: "bg-orange-100", price: 20 },
  ];

  // Get color name from code
  const getColorName = (code: string) => {
    const color = PAPER_COLORS.find((c) => c.code === code);
    return color?.name || code;
  };

  // Get color code from name
  const getColorCode = (name: string) => {
    const color = PAPER_COLORS.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    return color?.code || name;
  };

  // Get color price from code
  const getColorPrice = (code: string) => {
    const color = PAPER_COLORS.find((c) => c.code === code);
    return color?.price || 10;
  };

  // Color mapping for paper colors
  const getColorClass = (color: PaperColor) => {
    const colorDef = PAPER_COLORS.find(
      (c) => c.code === color || c.name === color,
    );
    return colorDef?.class || "bg-gray-100";
  };

  // Get row color based on availability and status
  const getRowColorClass = (order: Order) => {
    if (order.status === "deleted") {
      return "opacity-30";
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
  const formatOrderTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Status color coding
  const getStatusColor = (status: OrderStatus) => {
    const statusColors: { [key: string]: string } = {
      passive: "text-gray-600 bg-gray-50",
      ordered: "text-blue-600 bg-blue-50",
      pending_inventory: "text-yellow-600 bg-yellow-50",
      WIP: "text-purple-600 bg-purple-50",
      sent: "text-green-600 bg-green-50",
      approved: "text-teal-600 bg-teal-50",
      deleted: "text-red-600 line-through bg-red-50",
      other: "text-gray-600 bg-gray-50",
    };
    return statusColors[status];
  };

  // Add new order
  const addOrder = () => {
    const newOrder: Order = {
      id: Date.now().toString(),
      orderTime: Date.now(),
      quantity: 50,
      leadTime: 7,
      paperColor: "w",
      size: "A5",
      verseSize: 4,
      occasion: "",
      price: 2.0,
      available: true,
      status: "passive",
    };
    setOrders([...orders, newOrder]);
  };

  // Delete most recent passive order
  const deleteRecentOrder = () => {
    // Find the most recent (last in array) order with passive status
    let recentPassiveIndex = -1;
    for (let i = orders.length - 1; i >= 0; i--) {
      if (orders[i].status === "passive") {
        recentPassiveIndex = i;
        break;
      }
    }
    if (recentPassiveIndex !== -1) {
      setOrders(
        orders.map((order, index) =>
          index === recentPassiveIndex
            ? { ...order, status: "deleted" as OrderStatus }
            : order,
        ),
      );
    }
  };

  // Update order
  const updateOrder = (id: string, field: keyof Order, value: any) => {
    setOrders(
      orders.map((order) =>
        order.id === id ? { ...order, [field]: value } : order,
      ),
    );
  };

  // Accept suggestions
  const acceptSuggestions = () => {
    setPreviousOrders(orders);
    // Backend integration would go here
    // For now, just simulate accepting suggestions
    setShowUndo(true);
    setTimeout(() => setShowUndo(false), 5000);
  };

  // Undo last action
  const undoLastAction = () => {
    if (previousOrders.length > 0) {
      setOrders(previousOrders);
      setPreviousOrders([]);
      setShowUndo(false);
    }
  };

  // Handle pane resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = (e.clientX / window.innerWidth) * 100;
      if (newWidth >= 20 && newWidth <= 80) {
        setLeftPaneWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+N: Add new order
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        addOrder();
      }
      // Ctrl+Z: Delete newest passive order
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        if (showUndo) {
          undoLastAction();
        } else {
          deleteRecentOrder();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [orders, showUndo]);

  // Statistics calculations (skeleton for backend)
  const stats = {
    current: {
      prodTime: "48h", // TODO: Calculate from backend
      timeMargin: "12h", // TODO: Calculate from backend
      profit: "£450", // TODO: Calculate from backend
      riskOfFailure: "15%", // TODO: Calculate from backend
      costOfFailure: "£150", // TODO: Calculate from backend
      rewardRisk: "3.0", // TODO: Calculate from backend
    },
    suggested: {
      prodTime: "45h", // TODO: Calculate from backend
      timeMargin: "18h", // TODO: Calculate from backend
      profit: "£520", // TODO: Calculate from backend
      riskOfFailure: "12%", // TODO: Calculate from backend
      costOfFailure: "£130", // TODO: Calculate from backend
      rewardRisk: "4.0", // TODO: Calculate from backend
    },
  };

  // Calculate financial metrics - paper valued at cost (what we paid)
  const calculateNetWorth = () => {
    const paperValue = Object.entries(paperInventory).reduce(
      (total, [color, qty]) => {
        return total + qty * getColorPrice(color);
      },
      0,
    );

    // Add value of other inventory purchases (marked as affecting inventory)
    const otherInventoryValue = transactions
      .filter((t) => t.type === "cash" && t.affectsInventory && t.amount < 0)
      .reduce((total, t) => total + Math.abs(t.amount), 0);

    return cash + paperValue + otherInventoryValue;
  };

  // Calculate actual profit if we had to sell inventory at end-game markdown price
  // Paper inventory is worth less when selling at game end (70% of purchase price)
  // Cash remains at full value
  const calculateProfit = () => {
    const netWorth = calculateNetWorth();
    const inventoryValue = netWorth - cash; // Total value in inventory
    const finalSellValue = inventoryValue * SELL_MARKDOWN; // Inventory at final selling price
    return cash + finalSellValue; // Cash + discounted inventory
  };

  // Add new transaction
  const addTransaction = (
    amount: number,
    reason: string,
    paperColor?: string,
    paperQuantity?: number,
    affectsInventory?: boolean,
  ) => {
    const newTransaction: Transaction = {
      id: Date.now().toString(),
      timestamp: new Date(),
      amount,
      type: paperColor ? "paper" : "cash",
      paperColor,
      paperQuantity,
      reason,
      affectsInventory,
    };

    setTransactions([...transactions, newTransaction]);
    setCash((prev) => prev + amount);

    // Update paper inventory if it's a paper transaction
    if (paperColor && paperQuantity) {
      setPaperInventory((prev) => ({
        ...prev,
        [paperColor]: (prev[paperColor] || 0) + paperQuantity,
      }));
    }
  };

  // Timer management
  const startCooldownTimer = () => {
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

  const stopCooldownTimer = () => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      setCooldownTimer(null);
    }
  };

  const resetCooldownTimer = () => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      setCooldownTimer(null);
    }
    setBuyingCooldown(300); // Reset to 5 minutes
  };

  const updateCooldownTime = (newTime: number) => {
    if (!cooldownTimer && newTime >= 0) {
      setBuyingCooldown(newTime);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen w-full bg-gray-100">
      {/* Cash Metrics Header Bar */}
      <div className="bg-gray-900 text-white p-2 border-b border-gray-700">
        <div className="flex justify-between items-center">
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Cash:</span>
              <span className="text-sm font-bold text-green-400">
                £{cash.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Net Worth:</span>
              <span className="text-sm font-bold text-blue-400">
                £{calculateNetWorth().toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Profit:</span>
              <span
                className={`text-sm font-bold ${calculateProfit() >= 0 ? "text-green-400" : "text-red-400"}`}
              >
                £{calculateProfit().toFixed(2)}
              </span>
            </div>
          </div>
          {buyingCooldown > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-yellow-400">Buying Cooldown:</span>
              <span className="text-sm font-mono">
                {formatTime(buyingCooldown)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Two-pane section */}
      <div className="flex relative">
        {/* Left Pane - Order Management */}
        <div
          className="bg-white border-r border-gray-300"
          style={{ width: `${leftPaneWidth}%` }}
        >
          <div className="p-2">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-base font-bold text-gray-800">
                Order Management
              </h2>
            </div>

            {/* Orders Table */}
            <div className="mb-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => (
                    <tr
                      key={order.id}
                      className={`border-b hover:bg-gray-50 ${getRowColorClass(order)}`}
                    >
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={formatOrderTime(order.orderTime)}
                          onChange={(e) => {
                            const timeStr = e.target.value;
                            const [hours, minutes] = timeStr
                              .split(":")
                              .map(Number);
                            if (!isNaN(hours) && !isNaN(minutes)) {
                              const newDate = new Date(order.orderTime);
                              newDate.setHours(hours, minutes);
                              updateOrder(
                                order.id,
                                "orderTime",
                                newDate.getTime(),
                              );
                            }
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="HH:MM"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.quantity}
                          onChange={(e) =>
                            updateOrder(
                              order.id,
                              "quantity",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.leadTime}
                          onChange={(e) =>
                            updateOrder(
                              order.id,
                              "leadTime",
                              parseInt(e.target.value) || -1,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="∞"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) => (colorInputRefs.current[order.id] = el)}
                          type="text"
                          value={getColorName(order.paperColor)}
                          onChange={(e) => {
                            const value = e.target.value;
                            setColorSearch(value);
                            setFilteredColors(
                              fuzzySearch(
                                value,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                            // Try to match color immediately if exact match
                            const exactMatch = PAPER_COLORS.find(
                              (c) =>
                                c.name.toLowerCase() === value.toLowerCase(),
                            );
                            if (exactMatch) {
                              updateOrder(
                                order.id,
                                "paperColor",
                                exactMatch.code,
                              );
                            }
                          }}
                          onFocus={(e) => {
                            setColorSearch(e.target.value);
                            setFilteredColors(
                              fuzzySearch(
                                e.target.value,
                                PAPER_COLORS.map((c) => c.name),
                              ),
                            );
                            setActiveColorIndex(index);
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setActiveColorIndex(-1);
                              setFilteredColors([]);
                            }, 200);
                          }}
                          className={`w-full px-1 py-1.5 border rounded text-xs h-8 ${getColorClass(order.paperColor)}`}
                          placeholder="Color..."
                        />
                        {activeColorIndex === index &&
                          filteredColors.length > 0 && (
                            <div className="absolute z-50 top-full left-0 w-full bg-white border rounded shadow-lg">
                              {filteredColors.map((colorName) => {
                                const color = PAPER_COLORS.find(
                                  (c) => c.name === colorName,
                                );
                                return (
                                  <button
                                    key={colorName}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      if (color) {
                                        updateOrder(
                                          order.id,
                                          "paperColor",
                                          color.code,
                                        );
                                      }
                                      setFilteredColors([]);
                                      setActiveColorIndex(-1);
                                    }}
                                    className={`block w-full text-left px-2 py-1 hover:bg-blue-50 text-xs ${color?.class} flex justify-between items-center`}
                                  >
                                    <span>{colorName}</span>
                                    <span className="text-gray-500">
                                      £{color?.price}/sheet
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.size}
                          onChange={(e) =>
                            updateOrder(order.id, "size", e.target.value)
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Size"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={order.verseSize}
                          onChange={(e) =>
                            updateOrder(
                              order.id,
                              "verseSize",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                        />
                      </td>
                      <td className="px-2 py-1 relative">
                        <input
                          ref={(el) =>
                            (occasionInputRefs.current[order.id] = el)
                          }
                          type="text"
                          value={order.occasion}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateOrder(order.id, "occasion", value);
                            setOccasionSearch(value);
                            setFilteredOccasions(fuzzySearch(value, OCCASIONS));
                            setActiveOccasionIndex(
                              order.id === activeOccasionIndex ? -1 : -1,
                            );
                          }}
                          onFocus={(e) => {
                            setOccasionSearch(e.target.value);
                            setFilteredOccasions(
                              fuzzySearch(e.target.value, OCCASIONS),
                            );
                            setActiveOccasionIndex(index);
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setActiveOccasionIndex(-1);
                              setFilteredOccasions([]);
                            }, 200);
                          }}
                          className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          placeholder="Occasion..."
                        />
                        {activeOccasionIndex === index &&
                          filteredOccasions.length > 0 && (
                            <div className="absolute z-50 top-full left-0 w-full bg-white border rounded shadow-lg max-h-32 overflow-y-auto">
                              {filteredOccasions.map((occasion) => (
                                <button
                                  key={occasion}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateOrder(order.id, "occasion", occasion);
                                    setFilteredOccasions([]);
                                    setActiveOccasionIndex(-1);
                                  }}
                                  className="block w-full text-left px-2 py-1 hover:bg-blue-50 text-xs"
                                >
                                  {occasion}
                                </button>
                              ))}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center">
                          <span className="mr-0.5 text-gray-500">£</span>
                          <input
                            type="text"
                            value={order.price}
                            onChange={(e) =>
                              updateOrder(
                                order.id,
                                "price",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-full px-1 py-1.5 border rounded text-xs h-8"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={order.available}
                            onChange={(e) =>
                              updateOrder(
                                order.id,
                                "available",
                                e.target.checked,
                              )
                            }
                            className="sr-only peer"
                          />
                          <div className="w-6 h-3 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-2 after:w-2.5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={order.status}
                          onChange={(e) =>
                            updateOrder(
                              order.id,
                              "status",
                              e.target.value as OrderStatus,
                            )
                          }
                          className={`w-full px-1 py-1.5 rounded text-xs font-medium h-8 ${getStatusColor(order.status)}`}
                        >
                          <option value="passive">Passive</option>
                          <option value="ordered">Ordered</option>
                          <option value="pending_inventory">Pending</option>
                          <option value="WIP">WIP</option>
                          <option value="sent">Sent</option>
                          <option value="approved">Approved</option>
                          <option value="deleted">Deleted</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Time
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Qty
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Lead
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Color
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Size
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Verse
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Occasion
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Price
                    </th>
                    <th className="px-2 py-1 text-center text-xs whitespace-nowrap">
                      Avail
                    </th>
                    <th className="px-2 py-1 text-left text-xs whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Action buttons below table */}
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="flex gap-2">
                <button
                  onClick={addOrder}
                  className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium"
                  title="Add Order (Ctrl+N)"
                >
                  + Add Order
                </button>
                <button
                  onClick={deleteRecentOrder}
                  className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 text-xs font-medium"
                  title="Delete newest passive order (Ctrl+Z)"
                >
                  Delete New Order
                </button>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+N: New
                </span>
                <span className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+Z: Delete New
                </span>
              </div>
            </div>

            {/* Suggested Orders Section */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Suggested Orders
              </h3>
              <div className="bg-blue-50 border border-blue-200 rounded p-1">
                <p className="text-xs text-blue-800 mb-1">
                  {/* TODO: Backend integration for suggestions */}
                  Based on current inventory and demand patterns:
                </p>
                <ul className="space-y-0.5 text-xs text-blue-700">
                  <li>• Add 200x Birthday A5 cards (high demand next week)</li>
                  <li>
                    • Consider Valentine's Day inventory (3 weeks lead time)
                  </li>
                  <li>• Low stock on pink paper - reorder recommended</li>
                </ul>
              </div>
            </div>

            {/* Schedule Section */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Production Schedule
              </h3>
              <div className="bg-gray-50 rounded p-1">
                <div className="space-y-0.5 text-xs">
                  {/* TODO: Backend integration for schedule */}
                  <div className="flex justify-between py-1 border-b">
                    <span>Today: Complete Birthday orders (WIP)</span>
                    <span className="text-gray-500">4 hours</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span>Tomorrow: Start Wedding batch</span>
                    <span className="text-gray-500">6 hours</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Thu: Anniversary + Thank You cards</span>
                    <span className="text-gray-500">5 hours</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Statistics Comparison Table */}
            <div className="mb-1">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Performance Metrics
              </h3>
              <div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-1 py-0.5 text-left text-xs"></th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Prod Time
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Margin
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Profit
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Risk %
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        Risk Cost
                      </th>
                      <th className="px-1 py-0.5 text-center text-xs">
                        R/R Ratio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b bg-green-50">
                      <td className="px-1 py-0.5 font-medium text-green-700 text-xs">
                        Suggested
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.prodTime}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.timeMargin}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.suggested.profit}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.riskOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.suggested.costOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.suggested.rewardRisk}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="px-1 py-0.5 font-medium text-gray-700 text-xs">
                        Current
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.prodTime}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.timeMargin}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.current.profit}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.riskOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center text-xs">
                        {stats.current.costOfFailure}
                      </td>
                      <td className="px-1 py-0.5 text-center font-medium text-xs">
                        {stats.current.rewardRisk}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Accept/Undo Button */}
            <div className="flex justify-center pb-2">
              {showUndo ? (
                <button
                  onClick={undoLastAction}
                  className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors text-xs font-medium"
                >
                  ↶ Undo Last Action (Ctrl+Z)
                </button>
              ) : (
                <button
                  onClick={acceptSuggestions}
                  className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-xs font-medium"
                >
                  ✓ Accept Suggestions
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Draggable Divider */}
        <div
          ref={dividerRef}
          className="w-1 bg-gray-400 hover:bg-gray-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />

        {/* Right Pane - Production Schedule */}
        <div
          className="bg-gray-50 flex-1 relative"
          style={{ width: `${100 - leftPaneWidth}%` }}
        >
          <div
            className="absolute top-0 left-0 right-0 p-2"
            style={{ position: "sticky", top: 0 }}
          >
            <div className="max-w-2xl mx-auto">
              <h2 className="text-base font-bold text-gray-800 mb-2">
                Production Schedule
              </h2>
              <div className="space-y-2">
                {/* TODO: List of Undertaking orders will go here once object type is defined */}
                <div className="bg-white rounded p-2 text-xs text-gray-600 shadow">
                  <p>Undertaking orders list will be implemented here...</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full-width sections below the two panes */}
      <div className="bg-white border-t border-gray-300">
        <div className="p-2">
          <h2 className="text-base font-bold text-gray-800 mb-2">
            Inventory Management System
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Paper Tracked Inventory
              </h3>
              <table className="w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="px-1 py-0.5 text-left">Color</th>
                    <th className="px-1 py-0.5 text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(paperInventory).map(([color, quantity]) => (
                    <tr key={color} className="border-b">
                      <td className="px-1 py-0.5">
                        <div className="flex items-center gap-1">
                          <div
                            className={`w-3 h-3 rounded ${getColorClass(color)}`}
                          />
                          <span className="font-medium">
                            {getColorName(color)}
                          </span>
                          <span className="text-gray-500 text-xs">
                            (£{getColorPrice(color)})
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-0.5 text-right font-mono">
                        {quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td className="px-1 py-0.5">Total</td>
                    <td className="px-1 py-0.5 text-right font-mono">
                      {Object.values(paperInventory).reduce(
                        (sum, qty) => sum + qty,
                        0,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Cash Transactions Ledger
              </h3>
              <div className="max-h-32 overflow-y-auto mb-2">
                <table className="w-full text-xs">
                  <thead className="bg-gray-200 sticky top-0">
                    <tr>
                      <th className="px-1 py-0.5 text-left">Amount</th>
                      <th className="px-1 py-0.5 text-left">Type</th>
                      <th className="px-1 py-0.5 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .slice(-10)
                      .reverse()
                      .map((trans) => (
                        <tr key={trans.id} className="border-b">
                          <td
                            className={`px-1 py-0.5 font-mono ${trans.amount >= 0 ? "text-green-600" : "text-red-600"}`}
                          >
                            £{trans.amount.toFixed(2)}
                          </td>
                          <td className="px-1 py-0.5">
                            {trans.type === "paper" && trans.paperColor
                              ? `${trans.paperColor}:${trans.paperQuantity}`
                              : trans.affectsInventory
                                ? "Inventory"
                                : "Cash"}
                          </td>
                          <td className="px-1 py-0.5 text-xs">
                            {trans.reason || ""}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Add Transaction Forms */}
              <div className="space-y-1">
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashAmount"
                  />
                  <input
                    type="text"
                    placeholder="Reason"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="cashReason"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      id="affectsInventory"
                      className="rounded"
                    />
                    <span>Inventory</span>
                  </label>
                  <button
                    onClick={() => {
                      const amount = parseFloat(
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const reason =
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value || "Cash transaction";
                      const affectsInventory = (
                        document.getElementById(
                          "affectsInventory",
                        ) as HTMLInputElement
                      ).checked;
                      if (amount) {
                        addTransaction(
                          amount,
                          reason,
                          undefined,
                          undefined,
                          affectsInventory,
                        );
                        (
                          document.getElementById(
                            "cashAmount",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "cashReason",
                          ) as HTMLInputElement
                        ).value = "";
                        (
                          document.getElementById(
                            "affectsInventory",
                          ) as HTMLInputElement
                        ).checked = false;
                      }
                    }}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs"
                  >
                    Add Cash
                  </button>
                </div>

                <div className="flex gap-1">
                  <input
                    type="number"
                    placeholder="Qty"
                    className="w-16 px-1 py-0.5 border rounded text-xs"
                    id="paperQty"
                    onChange={() => {
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      const colorInput = document.getElementById(
                        "paperColorInput",
                      ) as HTMLInputElement;
                      const colorName = colorInput?.value;
                      const color = PAPER_COLORS.find(
                        (c) =>
                          c.name.toLowerCase() === colorName?.toLowerCase(),
                      );
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.price).toFixed(2);
                      }
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Color"
                    className="w-24 px-1 py-0.5 border rounded text-xs"
                    id="paperColorInput"
                    list="paperColorsList"
                    onChange={(e) => {
                      const colorName = e.target.value;
                      const color = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );
                      const qty =
                        parseInt(
                          (
                            document.getElementById(
                              "paperQty",
                            ) as HTMLInputElement
                          ).value,
                        ) || 0;
                      if (color && qty > 0) {
                        (
                          document.getElementById(
                            "paperCost",
                          ) as HTMLInputElement
                        ).value = (qty * color.price).toFixed(2);
                      }
                    }}
                  />
                  <datalist id="paperColorsList">
                    {PAPER_COLORS.map((color) => (
                      <option key={color.code} value={color.name} />
                    ))}
                  </datalist>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Cost"
                    className="w-20 px-1 py-0.5 border rounded text-xs bg-gray-100"
                    id="paperCost"
                    readOnly
                  />
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    className="flex-1 px-1 py-0.5 border rounded text-xs"
                    id="paperReason"
                  />
                  <button
                    onClick={() => {
                      const qty = parseInt(
                        (
                          document.getElementById(
                            "paperQty",
                          ) as HTMLInputElement
                        ).value,
                      );
                      const colorName = (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value;
                      const colorMatch = PAPER_COLORS.find(
                        (c) => c.name.toLowerCase() === colorName.toLowerCase(),
                      );

                      if (!colorMatch) {
                        alert("Please select a valid color");
                        return;
                      }

                      if (!qty || qty <= 0) {
                        alert("Please enter a valid quantity");
                        return;
                      }

                      const cost = -Math.abs(qty * colorMatch.price);
                      const reason =
                        (
                          document.getElementById(
                            "paperReason",
                          ) as HTMLInputElement
                        ).value || `Bought ${qty} sheets of ${colorMatch.name}`;

                      // Allow buying even with negative cash
                      addTransaction(cost, reason, colorMatch.code, qty);
                      startCooldownTimer();

                      // Clear form
                      (
                        document.getElementById("paperQty") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperColorInput",
                        ) as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById("paperCost") as HTMLInputElement
                      ).value = "";
                      (
                        document.getElementById(
                          "paperReason",
                        ) as HTMLInputElement
                      ).value = "";
                    }}
                    className="px-2 py-0.5 bg-green-600 text-white rounded text-xs"
                  >
                    Buy Paper
                  </button>
                </div>
              </div>

              {/* Overrides Section */}
              <div className="mt-2 pt-2 border-t">
                <h4 className="text-xs font-semibold mb-1">Overrides</h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Cooldown:</span>
                    <button
                      onClick={() => {
                        if (cooldownTimer) {
                          stopCooldownTimer();
                        } else {
                          startCooldownTimer();
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        cooldownTimer
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-green-500 hover:bg-green-600 text-white"
                      }`}
                    >
                      {cooldownTimer ? "Stop" : "Start"}
                    </button>
                    <button
                      onClick={resetCooldownTimer}
                      className="px-2 py-0.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs"
                    >
                      Reset
                    </button>
                    {!cooldownTimer ? (
                      <input
                        type="text"
                        value={formatTime(buyingCooldown)}
                        onChange={(e) => {
                          const parts = e.target.value.split(":");
                          if (parts.length === 2) {
                            const mins = parseInt(parts[0]) || 0;
                            const secs = parseInt(parts[1]) || 0;
                            updateCooldownTime(mins * 60 + secs);
                          }
                        }}
                        className="w-12 px-1 py-0.5 border rounded text-xs font-mono text-center"
                        placeholder="0:00"
                      />
                    ) : (
                      <span className="text-xs font-mono w-12 text-center">
                        {formatTime(buyingCooldown)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Safety Stock:</span>
                    <input
                      type="number"
                      value={safetyStock}
                      onChange={(e) => setSafetyStock(parseInt(e.target.value))}
                      className="w-16 px-1 py-0.5 border rounded text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">
                Workstation Controls
              </h3>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium">Speed Override</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={workstationSpeed}
                      onChange={(e) =>
                        setWorkstationSpeed(parseFloat(e.target.value))
                      }
                      className="flex-1"
                    />
                    <span className="text-xs font-mono w-8">
                      {workstationSpeed.toFixed(1)}x
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 1
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 2
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 3
                  </button>
                  <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">
                    Station 4
                  </button>
                </div>
                <div className="text-xs text-gray-600">
                  <p>Additional workstation overrides will be added here.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
