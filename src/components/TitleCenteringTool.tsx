import { useState, useEffect } from "react";
import {
  PAPER_SIZES,
  centerTitle,
  formatPosition,
  generateRulerPositions,
  type PaperSize,
  type CenteringResult,
} from "../utils/titleCentering";
import type { Order } from "../utils/gameState";

interface TitleCenteringToolProps {
  currentOrder?: Order | null;
}

export function TitleCenteringTool({ currentOrder }: TitleCenteringToolProps) {
  const [result, setResult] = useState<CenteringResult | null>(null);

  // Map order sizes to paper sizes
  const mapOrderSizeToPaperSize = (orderSize?: string): PaperSize => {
    if (!orderSize) return PAPER_SIZES[0];
    
    // Map order sizes to paper sizes (adjust mapping as needed)
    switch (orderSize) {
      case "A5":
        return PAPER_SIZES.find(p => p.name === "A5") || PAPER_SIZES[0];
      case "A6":
      case "A6 (large)":
        return PAPER_SIZES.find(p => p.name === "A6 (large)") || PAPER_SIZES[1];
      case "A6 (small)":
        return PAPER_SIZES.find(p => p.name === "A6 (small)") || PAPER_SIZES[2];
      case "A7":
        return PAPER_SIZES.find(p => p.name === "A7") || PAPER_SIZES[3];
      default:
        return PAPER_SIZES[0];
    }
  };

  const selectedPaperSize = mapOrderSizeToPaperSize(currentOrder?.size);
  const title = currentOrder?.title || "";

  useEffect(() => {
    if (title.trim() && selectedPaperSize) {
      const centeringResult = centerTitle(title, selectedPaperSize);
      setResult(centeringResult);
    } else {
      setResult(null);
    }
  }, [title, selectedPaperSize]);

  const rulerPositions = generateRulerPositions();
  const maxCapacity = title.length % 2 === 0 
    ? selectedPaperSize.evenLetterCapacity 
    : selectedPaperSize.oddLetterCapacity;

  if (!currentOrder || !currentOrder.title) {
    return (
      <div className="p-4 bg-gray-50 rounded">
        <p className="text-sm text-gray-600">
          No title set for current order. Add a title in the orders table to see centering instructions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Order Info */}
      <div className="bg-white p-3 rounded border">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-600">Paper:</span>
            <span className="ml-1 font-medium">{selectedPaperSize.name}</span>
          </div>
          <div>
            <span className="text-gray-600">Title:</span>
            <span className="ml-1 font-medium">{title}</span>
          </div>
          <div>
            <span className="text-gray-600">Capacity:</span>
            <span className="ml-1 font-medium">
              {title.length % 2 === 0 ? "even" : "odd"} ({maxCapacity} max)
            </span>
          </div>
          <div>
            <span className="text-gray-600">Length:</span>
            <span className="ml-1 font-medium">{title.length} chars</span>
          </div>
        </div>
      </div>

      {/* Placement Instructions */}
      {result && result.lines.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3">
          <div className="space-y-2">
            {result.lines.map((line) => (
              <div key={line.lineNumber} className="bg-white p-2 rounded border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">Line {line.lineNumber}</span>
                  <span className="text-sm font-mono font-bold">{line.text}</span>
                </div>
                
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">Start at:</span>
                  <span className="text-base font-bold text-blue-600">
                    {formatPosition(line.startPosition)}
                  </span>
                  <span className="text-gray-500">
                    (place first "{line.text[0]}" at {formatPosition(line.startPosition)} and last "{line.text[line.text.length - 1]}" at {formatPosition(line.endPosition)})
                  </span>
                </div>

                {/* Large ruler visualization */}
                <div className="mt-3 bg-gray-50 p-3 rounded overflow-x-auto">
                  <div className="font-mono">
                    {/* Ruler marks and numbers */}
                    <div className="flex items-end">
                      {Array.from({ length: maxCapacity + 2 }, (_, i) => {
                        const rulerPos = i + 1;
                        const isHalfPosition = title.length % 2 === 0;
                        
                        // For even-length titles, we show half positions (.5)
                        if (isHalfPosition) {
                          return (
                            <div key={i} className="flex">
                              {/* Main position */}
                              <div className="flex flex-col items-center w-8">
                                <div className="h-3 border-l-2 border-gray-600"></div>
                                <span className="text-xs text-gray-700 font-semibold">{rulerPos}</span>
                              </div>
                              {/* Half position (except for the last one) */}
                              {i < maxCapacity + 1 && (
                                <div className="flex flex-col items-center w-8">
                                  <div className="h-2 border-l border-gray-400"></div>
                                  <span className="text-[10px] text-gray-500">{rulerPos}.5</span>
                                </div>
                              )}
                            </div>
                          );
                        } else {
                          // For odd-length titles, show only whole numbers
                          return (
                            <div key={i} className="flex flex-col items-center w-10">
                              <div className="h-3 border-l-2 border-gray-600"></div>
                              <span className="text-xs text-gray-700 font-semibold">{rulerPos}</span>
                            </div>
                          );
                        }
                      })}
                    </div>
                    
                    {/* Letters below ruler */}
                    <div className="flex mt-1">
                      {Array.from({ length: maxCapacity + 2 }, (_, i) => {
                        const rulerPos = i + 1;
                        const isEvenLength = title.length % 2 === 0;
                        
                        if (isEvenLength) {
                          // For even-length titles, letters go at .5 positions
                          const halfPosition = rulerPos + 0.5;
                          const letterIndexAtHalf = halfPosition - line.startPosition;
                          const letterAtHalf = letterIndexAtHalf >= 0 && letterIndexAtHalf < line.text.length 
                            ? line.text[letterIndexAtHalf]
                            : "";
                          
                          return (
                            <div key={i} className="flex">
                              {/* Empty space under whole number */}
                              <div className="w-8 h-8 flex items-center justify-center">
                                <span className="text-gray-300 text-[10px]">·</span>
                              </div>
                              {/* Letter under .5 position */}
                              {i < maxCapacity + 1 && (
                                <div className={`w-8 h-8 flex items-center justify-center ${
                                  letterAtHalf ? 'bg-blue-100 border border-blue-300 rounded' : ''
                                }`}>
                                  {letterAtHalf && (
                                    <span className="text-lg font-bold text-blue-700">{letterAtHalf}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        } else {
                          // For odd-length titles, letters go at whole positions
                          const letterIndex = rulerPos - line.startPosition;
                          const letter = letterIndex >= 0 && letterIndex < line.text.length 
                            ? line.text[letterIndex] 
                            : "";
                          
                          return (
                            <div key={i} className={`w-10 h-8 flex items-center justify-center ${
                              letter ? 'bg-blue-100 border border-blue-300 rounded' : ''
                            }`}>
                              {letter ? (
                                <span className="text-lg font-bold text-blue-700">{letter}</span>
                              ) : (
                                <span className="text-gray-300 text-[10px]">·</span>
                              )}
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {result.totalLines > 1 && (
            <div className="mt-2 p-2 bg-blue-100 rounded">
              <p className="text-[10px] text-blue-800">
                <strong>Multi-line:</strong> {result.totalLines} lines total
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
