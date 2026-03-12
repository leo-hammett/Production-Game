export type VerseLineCount = 2 | 4 | 6;

export type VerseCatalog = Record<
  string,
  Partial<Record<VerseLineCount, readonly string[]>>
>;

export const VERSES_BY_OCCASION = {
  Christmas: {
    2: ["Snow falls", "Deck the halls"],
    4: ["Snow falls", "White ground", "Deck the halls", "Joy all round"],
    6: [
      "Snow falls",
      "White ground",
      "Deck the halls",
      "Joy all round",
      "Pine trees",
      "Festivities",
    ],
  },
  Easter: {
    2: ["Crown of thorns", "Jesus reborn"],
    4: ["Crown of thorns", "A day of hope", "Jesus reborn", "Faith sown"],
    6: [
      "Crown of thorns",
      "A day of hope",
      "Jesus reborn",
      "Faith sown",
      "Happy day",
      "Children play",
    ],
  },
  "New Year": {
    2: ["Time for cheer", "Happy New Year!"],
    4: ["At midnight", "Fireworks bright", "Time for cheer", "Happy New Year!"],
    6: [
      "The sky is light",
      "At midnight",
      "Fireworks bright",
      "What a sight!",
      "Time for cheer",
      "Happy New Year!",
    ],
  },
  "Generic Birthday": {
    2: ["Time for cheer", "You’ve gained a year!"],
    4: [
      "Take a seat",
      "Time for cheer",
      "There’s cake to eat",
      "You’ve gained a year!",
    ],
    6: [
      "There’s cake to eat",
      "Take a seat",
      "Time for cheer",
      "You’ve gained a year",
      "Happy birthday",
      "What more to say?",
    ],
  },
  "18th Birthday": {
    2: ["Now an adult", "What a result!"],
    4: [
      "Time for cheer",
      "You’ve gained a year!",
      "Now an adult",
      "What a result!",
    ],
    6: [
      "Be a dear",
      "Grab a beer",
      "It’s time for cheer",
      "You’ve gained a year!",
      "Now an adult",
      "What a result!",
    ],
  },
  Retirement: {
    2: ["Time for fun", "Work is done"],
    4: ["Time for fun", "Work is done", "I suggest:", "Have a rest"],
    6: [
      "Time for fun",
      "Work is done",
      "I suggest:",
      "Have a rest",
      "You’re an OAP",
      "Enjoy early tea",
    ],
  },
  "Mother's Day": {
    2: ["My Mother", "Like no other"],
    4: ["My Mother,", "Like no other", "You’re the best", "Have a rest"],
    6: [
      "My Mother,",
      "Like no other",
      "Time for cheer",
      "You’re the best",
      "Grab a beer",
      "Have a rest",
    ],
  },
  "Father's Day": {
    2: [" Thanks Dad", "You’re not so bad"],
    4: ["Time for cheer", "Grab a beer", "Thanks Dad", "You’re not so bad"],
    6: [
      "Time for cheer",
      "Time for fun",
      "Grab a beer",
      "A cold one",
      "Thanks Dad",
      "You’re not so bad",
    ],
  },
  "Baby Boy": {
    2: ["What a joy", "A baby boy!"],
    4: ["A creation", "Congratulations!", "What a joy", "A baby boy!"],
    6: [
      "A creation",
      "Congratulations!",
      "What a joy",
      "A baby boy!",
      "Lots of fun",
      "Your little son",
    ],
  },
  "Baby Girl": {
    2: ["What a whirl", "A baby girl!"],
    4: ["A creation", "Congratulations!", "What a whirl", "A baby girl!"],
    6: [
      "A creation",
      "Congratulations!",
      "What a whirl",
      "A baby girl!",
      "Lots of fun",
      "Your little one",
    ],
  },
  Twins: {
    2: ["Two creations", "Congratulations"],
    4: ["Two creations", "Congratulations", "What a sight", "Double delight!"],
    6: [
      "Two creations",
      "Congratulations",
      "Two smiles",
      "Two profiles",
      "What a sight",
      "Double delight!",
    ],
  },
  "Silver Wedding": {
    2: ["To 25 years,", "Cheers!"],
    4: ["Time for cheer", "Grab a beer", "To 25 years,", "Cheers!"],
    6: [
      "Time for cheer",
      "Grab a beer",
      "To 25 years,",
      "And laughter",
      "For ever after",
      "Cheers!",
    ],
  },
  "Gold Wedding": {
    2: ["To 50 years,", "Cheers!"],
    4: ["Time for cheer", "Grab a beer", "To 50 years,", "Cheers!"],
    6: [
      "Time for cheer",
      "Grab a beer",
      "To 50 years,",
      "And laughter",
      "For ever after",
      "Cheers!",
    ],
  },
  Wedding: {
    2: ["The day was fun", "Now you’re one"],
    4: [
      "The day was fun",
      "You said “I do”",
      "Now you’re one",
      "As well as two",
    ],
    6: [
      "The day was fun",
      "You said “I do”",
      "Now you’re one",
      "As well as two",
      "Congratulations both",
      "On your oath",
    ],
  },
  "Valentine's Day": {
    2: ["Violets are blue", "I love you"],
    4: ["Roses are red", "Violets are blue", "I love you", "It’s true!"],
    6: [
      "Roses are red",
      "Violets are blue",
      "I love you",
      "It’s true!",
      "Time for cheer",
      "My dear",
    ],
  },
  "Husband's Birthday": {
    2: ["Husband, dear,", "You’ve gained a year!"],
    4: [
      "Husband, dear,",
      "Grab a beer",
      "Time for cheer",
      "You’ve gained a year!",
    ],
    6: [
      "Husband, dear,",
      "Grab a beer",
      "Take a seat",
      "There’s cake to eat",
      "Time for cheer",
      "You’ve gained a year!",
    ],
  },
  "Wife's Birthday": {
    2: ["Happy birthday, Wife", "Love you for life"],
    4: [
      "Take a seat",
      "There’s cake to eat",
      "Happy birthday, Wife",
      "Love you for life",
    ],
    6: [
      "Take a seat",
      "Time for cheer",
      "There’s cake to eat",
      "You’ve gained a year!",
      "Happy birthday, Wife",
      "Love you for life",
    ],
  },
  Engagement: {
    2: ["Congrats on the ring", "It’s a pretty thing"],
    4: [
      "Congrats on the ring",
      "Time to celebrate",
      "It’s a pretty thing",
      "Together you’re great",
    ],
    6: [
      "A sight to see",
      "You on one knee",
      "Congrats on the ring",
      "Time to celebrate",
      "It’s a pretty thing",
      "Together you’re great",
    ],
  },
  Triplets: {
    2: ["Three creations", "Congratulations"],
    4: [
      "Three creations",
      "Congratulations",
      "What a sight",
      "Triple delight!",
    ],
    6: [
      "Three creations",
      "Congratulations",
      "Three smiles",
      "Three profiles",
      "What a sight",
      "Triple delight!",
    ],
  },
  "Baby Quads": {
    2: ["Four creations", "Congratulations"],
    4: ["Four creations", "Congratulations", "What a sight", "A quad delight!"],
    6: [
      "Four creations",
      "Congratulations",
      "Four smiles",
      "Four profiles",
      "What a sight",
      "A quad delight!",
    ],
  },
  "New Home": {
    2: ["Congratulations", "New accommodations"],
    4: ["Debts owed", "New abode", "Congratulations", "New accommodations"],
    6: [
      "Debts owed",
      "Unload",
      "New abode",
      "New postcode",
      "Congratulations",
      "New accommodations",
    ],
  },
  Passover: {
    2: ["The slaves are free", "At God’s decree"],
    4: [
      "The slaves are free",
      "At God’s decree",
      "Take a seat",
      "There’s Seder to eat",
    ],
    6: [
      "The slaves are free",
      "At God’s decree",
      "Take a seat",
      "Remember the wine",
      "There’s Seder to eat",
      "Thank the Divine",
    ],
  },
  "Christmas and New Year": {
    2: ["End of year", "Lots of cheer"],
    4: ["Lots of joy", "Lots of cheer", "Wreaths of holly", "End of year"],
    6: [
      "Lots of joy",
      "Lots of cheer",
      "Wreaths of holly",
      "End of year",
      "Family’s together",
      "In cold weather",
    ],
  },
  Hanukkah: {
    2: ["Menorah bright", "Joyous night"],
    4: ["8 nights", "8 days", "Menorah lights", "Dreidel plays"],
    6: [
      "8 nights",
      "8 days",
      "Menorah lights",
      "Dreidel plays",
      "Enjoy the holiday",
      "And bright display",
    ],
  },
  Graduation: {
    2: ["A degree", "You’re free!"],
    4: ["A degree", "You’re free!", "Have some pride", "It’s justified"],
    6: [
      "Time for cheer",
      "You passed the year",
      "A degree",
      "You’re free!",
      "Have some pride",
      "It’s justified",
    ],
  },
  Diwali: {
    2: ["Festival of lights", "Enjoy the sights"],
    4: [
      "Festival of lights",
      "Enjoy the sights",
      "And fireworks",
      "Burning bright",
    ],
    6: [
      "Festival of lights",
      "Enjoy the sights",
      "Of fireworks",
      "Burning bright",
      "Lighting the streets",
      "Enjoying sweets",
    ],
  },
  Holi: {
    2: ["Holi day", "Colourful play"],
    4: ["Holi day", "Colourful play", "Sing along", "Amidst the throng"],
    6: [
      "Holi day",
      "Colourful play",
      "By the bonfire",
      "Sing along",
      "In coloured attire",
      "Amidst the throng",
    ],
  },
  "St Patricks's Day": {
    2: ["Sight to be seen", "Rivers running green"],
    4: [
      "Wear a shamrock",
      "Drink ad hoc",
      "Sight to be seen",
      "Rivers running green",
    ],
    6: [
      "Wear a shamrock",
      "Have a feast",
      "Drink ad hoc",
      "Think of the priest",
      "Sight to be seen",
      "Rivers running green",
    ],
  },
  Condolences: {
    2: ["Thinking of you", "And your family too"],
    4: [
      "Thinking of you",
      "And your family too",
      "Wishing you the best",
      "In this time of unrest",
    ],
    6: [
      "Thinking of you",
      "And your family too",
      "Memories remain",
      "Despite the pain",
      "Wishing you the best",
      "In this time of unrest",
    ],
  },
  Congratulations: {
    2: ["Congratulations", "and felicitations!"],
    4: ["Congratulations", "and felicitations!", "Well done", "Now have fun"],
    6: [
      "Congratulations",
      "and felicitations!",
      "Well done",
      "Now have fun",
      "Celebrate today",
      "Time for a soiree",
    ],
  },
  "Get Well Soon": {
    2: ["Thinking of you", "Keep pushing through"],
    4: [
      "Thinking of you",
      "Keep pushing through",
      "All the best",
      "Have a rest",
    ],
    6: [
      "Thinking of you",
      "Keep pushing through",
      "All the best",
      "Feel better soon",
      "Have a rest",
      "Love you to the moon",
    ],
  },
  "St David's Day": {
    2: ["Happy St David’s Day", "Enjoy the display"],
    4: [
      "Happy St David’s Day",
      "Enjoy the display",
      "Watch the parade",
      "Try food, homemade",
    ],
    6: [
      "Happy St David’s Day",
      "Enjoy the display",
      "Watch the parade",
      "Wear a daffodil",
      "Harvested with a spade",
      "As streets fill",
    ],
  },
  "Driving Test Pass": {
    2: ["Roads await", "Drive straight"],
    4: ["You passed", "Don’t go fast", "Roads await", "Drive straight"],
    6: [
      "At last",
      "You passed",
      "The world is vast",
      "Roads await",
      "Don’t go fast",
      "Drive straight",
    ],
  },
  "New Job": {
    2: ["New profession", "No depression!"],
    4: ["Time has come", "New profession", "New income", "No depression!"],
    6: [
      "Time has come",
      "New profession",
      "New income",
      "No depression!",
      "Enjoy the work",
      "Don’t shirk",
    ],
  },
  Pregnancy: {
    2: ["With child", "How wild!"],
    4: ["Bad news:", "No booze", "With child", "How wild!"],
    6: [
      "Bad news:",
      "No booze",
      "Good news:",
      "Tiny shoes",
      "With child",
      "How wild!",
    ],
  },
  Marriage: {
    2: ["You had some fun", "Now you’re one"],
    4: [
      "You had some fun",
      "You said “I do”",
      "Now you’re one",
      "As well as two",
    ],
    6: [
      "You had some fun",
      "You said “I do”",
      "Now you’re one",
      "As well as two",
      "Congratulations both",
      "On your oath",
    ],
  },
  "Examination Pass": {
    2: ["What a score", "Next time, more!"],
    4: ["Done great", "No debate", "What a score", "Next time, more!"],
    6: [
      "Done great",
      "No debate",
      "What a score",
      "Next time, more!",
      "Have some pride",
      "It’s justified",
    ],
  },
  "Good Luck": {
    2: ["Good luck", "Don’t suck"],
    4: ["Good luck", "Don’t suck", "Such a star", "You’ll go far"],
    6: [
      "Good luck",
      "Don’t suck",
      "Such a star",
      "You’ll go far",
      "Do it well",
      "Give them hell",
    ],
  },
  "16th Birthday": {
    2: ["16", "Party machine"],
    4: ["Time for cheer", "You’ve gained a year!", "16", "Party machine"],
    6: [
      "Take a seat",
      "Time for cheer",
      "There’s cake to eat",
      "You’ve gained a year!",
      "16",
      "Party machine",
    ],
  },
} as const satisfies VerseCatalog;

export type VerseOccasion = keyof typeof VERSES_BY_OCCASION;

// These aliases match the app's current occasion list to the verse source names.
export const VERSE_OCCASION_ALIASES: Record<string, VerseOccasion> = {
  "18 Birthday": "18th Birthday",
  "Baby Triplets": "Triplets",
  "Father's Birthday": "Father's Day",
};

function assertVerseCatalog(catalog: VerseCatalog): void {
  Object.entries(catalog).forEach(([occasion, variants]) => {
    Object.entries(variants).forEach(([lineCount, verseLines]) => {
      const expectedLineCount = Number(lineCount);
      if (
        expectedLineCount !== 2 &&
        expectedLineCount !== 4 &&
        expectedLineCount !== 6
      ) {
        throw new Error(
          `Unsupported line count "${lineCount}" for occasion "${occasion}"`,
        );
      }

      if (!verseLines || verseLines.length !== expectedLineCount) {
        throw new Error(
          `Verse for "${occasion}" should have ${expectedLineCount} lines`,
        );
      }
    });
  });
}

function normalizeVerseLineCount(
  lineCount: number,
): VerseLineCount | undefined {
  if (lineCount === 2 || lineCount === 4 || lineCount === 6) {
    return lineCount;
  }

  return undefined;
}

export function normalizeVerseOccasion(
  occasion: string,
): VerseOccasion | undefined {
  const trimmedOccasion = occasion.trim();
  if (!trimmedOccasion) {
    return undefined;
  }

  if (
    Object.prototype.hasOwnProperty.call(VERSES_BY_OCCASION, trimmedOccasion)
  ) {
    return trimmedOccasion as VerseOccasion;
  }

  return VERSE_OCCASION_ALIASES[trimmedOccasion];
}

export function getVerseLines(
  occasion: string,
  lineCount: number,
): readonly string[] | undefined {
  const normalizedOccasion = normalizeVerseOccasion(occasion);
  const normalizedLineCount = normalizeVerseLineCount(lineCount);

  if (!normalizedOccasion || !normalizedLineCount) {
    return undefined;
  }

  return VERSES_BY_OCCASION[normalizedOccasion][normalizedLineCount];
}

export function getVerseText(
  occasion: string,
  lineCount: number,
): string | undefined {
  const verseLines = getVerseLines(occasion, lineCount);
  return verseLines?.join("\n");
}

assertVerseCatalog(VERSES_BY_OCCASION);
