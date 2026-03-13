// Title centering utility for stationery work
// Helps stationers determine exact placement of letters on folded paper

export interface PaperSize {
  name: string;
  oddLetterCapacity: number;
  evenLetterCapacity: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { name: "A5", oddLetterCapacity: 11, evenLetterCapacity: 10 },
  { name: "A6 (large)", oddLetterCapacity: 9, evenLetterCapacity: 8 },
  { name: "A6 (small)", oddLetterCapacity: 15, evenLetterCapacity: 14 },
  { name: "A7", oddLetterCapacity: 9, evenLetterCapacity: 8 },
];

export interface CenteredLine {
  lineNumber: number;
  text: string;
  startPosition: number;
}

export interface CenteringResult {
  lines: CenteredLine[];
  totalLines: number;
}

/**
 * Get the maximum letters that fit on a line for given paper size and text length
 */
export function getMaxLettersPerLine(paperSize: PaperSize, textLength: number): number {
  return textLength % 2 === 0 
    ? paperSize.evenLetterCapacity 
    : paperSize.oddLetterCapacity;
}

/**
 * Calculate the starting position for a line of text to be centered
 * Uses ruler positions: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11
 */
export function calculateStartPosition(textLength: number, maxCapacity: number): number {
  // Calculate how many empty spaces we have
  const emptySpaces = maxCapacity - textLength;
  
  // Center by placing half the empty spaces before the text
  const spacesBeforeText = emptySpaces / 2;
  
  // Starting position is 1 + spaces before text
  const startPosition = 1 + spacesBeforeText;
  
  return startPosition;
}

/**
 * Split title into multiple lines if needed and calculate start positions
 */
export function centerTitle(title: string, paperSize: PaperSize): CenteringResult {
  const cleanTitle = title.trim().toUpperCase();
  
  if (!cleanTitle) {
    return { lines: [], totalLines: 0 };
  }

  const lines: CenteredLine[] = [];
  let remainingText = cleanTitle;
  let lineNumber = 1;

  while (remainingText.length > 0) {
    const maxLetters = getMaxLettersPerLine(paperSize, remainingText.length);
    
    let lineText: string;
    
    if (remainingText.length <= maxLetters) {
      // Entire remaining text fits on this line
      lineText = remainingText;
      remainingText = "";
    } else {
      // Need to split the text
      // Try to break at a word boundary if possible
      let splitIndex = maxLetters;
      
      // Look for a space near the max capacity to break at a word boundary
      const spaceIndex = remainingText.lastIndexOf(" ", maxLetters);
      if (spaceIndex > Math.max(1, maxLetters * 0.7)) {
        splitIndex = spaceIndex;
      }
      
      lineText = remainingText.substring(0, splitIndex).trim();
      remainingText = remainingText.substring(splitIndex).trim();
    }

    const startPosition = calculateStartPosition(lineText.length, maxLetters);

    lines.push({
      lineNumber,
      text: lineText,
      startPosition,
    });

    lineNumber++;
  }

  return {
    lines,
    totalLines: lines.length,
  };
}

/**
 * Format position for display (handles half positions)
 */
export function formatPosition(position: number): string {
  if (position % 1 === 0) {
    return position.toString();
  }
  return position.toString();
}

/**
 * Generate ruler display for reference
 */
export function generateRulerPositions(maxPosition: number = 11): number[] {
  const positions: number[] = [];
  for (let i = 1; i <= maxPosition; i += 0.5) {
    positions.push(i);
  }
  return positions;
}