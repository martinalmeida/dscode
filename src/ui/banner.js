const RESET = "\x1b[0m";
const PURPLE = "\x1b[95m"; // morado brillante
const GREEN = "\x1b[92m"; // verde brillante

const BANNER_LINES = [
  " ████   ████  ███   ███  ████  █████    █   █  ███    ",
  "█░░░█ █ ░░░░█ ░░░ █ ░░█ █░░░█ █░░░░░   █░  █░█ ░░█   ",
  "█░░░█░ ███░░█░ ░░░█░ ░█░█░░░█░████░░░  █░░ █░░░ █░░  ",
  "█░░ █░░ ░░█ █░░   █░░ █░█░░ █░█░░░░     █░█ ░░ █ ░ ░ ",
  "████ ░████░░ ███   ███ ░████ ░█████░     █ ░ █████░  ",
  " ░░░░ ░░░░░ ░ ░░░   ░░░ ░░░░░ ░░░░░░      ░ ░ ░░░░░  ",
  "  ░░░░  ░░░░   ░░░   ░░░  ░░░░  ░░░░░      ░   ░░░░░ ",
];

export function printBanner() {
  for (let i = 0; i < BANNER_LINES.length; i++) {
    const color = i % 2 === 0 ? PURPLE : GREEN;
    console.log(`${color}${BANNER_LINES[i]}${RESET}`);
  }
}
