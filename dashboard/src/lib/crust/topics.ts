// The short explainers behind every "i": what a figure is and where this dashboard gets it.
// How the game itself works (market rules, capitalization, contracts…) lives in the Wiki; `wiki` names that article.

export type TopicId =
  | "live"
  | "inGameTime"
  | "credits"
  | "netCashFlow"
  | "runway"
  | "netWorth"
  | "drones"
  | "resources"
  | "market"
  | "sellPrice"
  | "buyPrice"
  | "basePrice"
  | "range30"
  | "marketSupply"
  | "holdings"
  | "stockValue"
  | "income"
  | "spending"
  | "contracts"
  | "trades"
  | "construction"
  | "colonists"
  | "bank"
  | "poi"
  | "cpu"
  | "buildings"
  | "research"
  | "alerts"
  | "pins"
  | "insights"
  | "slag";

export type Topic = {
  title: string;
  /** What the figure is, in a sentence. */
  what: string;
  /** How this dashboard reads or calculates it. */
  here?: string;
  source: string;
  /** Wiki article id with the game mechanics behind it. */
  wiki?: string;
};

export const TOPICS: Record<TopicId, Topic> = {
  live: {
    title: "Live now",
    what: "Numbers read straight from your **running game** about every 2 seconds by the CrustWatcher mod.",
    here: "Credits, Net worth, Resources and the other Colony modules come from your **saves** and change only when the game saves. This module is the ==live== view. Pick ● Live under Save history to also chart this play session.",
    source: "CrustWatcher (this dashboard)",
  },
  inGameTime: {
    title: "In-game date and time",
    what: "The calendar inside your game.",
    here: "Read live from the game. It runs much faster than real time and stops while the game is paused.",
    source: "Game data via CrustWatcher",
  },
  credits: {
    title: "Credits",
    what: "Your company’s cash balance.",
    here: "The balance at each save (end of each in-game day) comes from the game’s statistics. **Live credits** come from the running game.",
    source: "Stats.bin; CrustWatcher",
    wiki: "credits",
  },
  netCashFlow: {
    title: "Net cash flow",
    what: "Money in minus money out, per in-game day, using the income and spending categories the game records.",
    here: "Blue bars: days you earned more than you spent. Red bars: days you spent more. Each day’s amounts line up with that day’s change in credits. Balance changes outside those categories are listed as ==not broken down==.",
    source: "Stats.bin income and spending series (checked against your balance history)",
    wiki: "credits",
  },
  runway: {
    title: "Credit runway",
    what: "How many in-game days your current credits last if the **last 30 days’** average daily change continues.",
    here: "One large purchase can make the average look worse than everyday spending. When that’s the case, the finding says so and names the purchase.",
    source: "Calculated by this dashboard from your saves",
    wiki: "bank-and-reputation",
  },
  netWorth: {
    title: "Net worth (capitalization)",
    what: "The game’s total valuation of your company: ==credits plus everything you own==. The game calls it **capitalization**.",
    here: "Split into the parts the game records. **Drones** are valued at the market’s base price for a drone (checked against your save: 15 drones × 46,000 = 690,000).",
    source: "Stats.bin capitalization series",
    wiki: "capitalization",
  },
  drones: {
    title: "Drones",
    what: "Robots that build, mine and haul for your base. Every drone uses CPU.",
    here: "Counted as “Drones” in net worth at the drone’s base market price.",
    source: "Stats.bin",
    wiki: "drones",
  },
  resources: {
    title: "Resources",
    what: "Everything your base mines, refines and manufactures.",
    here: "Holdings are **live** while the game runs with this save loaded, otherwise from your **last save**. Prices, supply and 30-day history are **live**. Click a column to sort, ☆ to pin, the bell to set an alert.",
    source: "Stats.bin; CrustWatcher",
  },
  market: {
    title: "Online Market",
    what: "Where you buy materials you’re missing or turn surplus resources into credits.",
    here: "Prices refresh about every 2 seconds while the game runs.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  sellPrice: {
    title: "Sell price",
    what: "What the market pays you per unit, right now.",
    here: "Read live from the game: the market’s current price rounded down. Selling adds supply, so a big sale gets a lower average price than this.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  buyPrice: {
    title: "Buy price",
    what: "What you pay per unit, right now.",
    here: "Read live from the game: the market’s current price times a markup that differs by resource.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  basePrice: {
    title: "Base price and “vs base”",
    what: "Base price is the market’s normal price for a resource. **vs base** shows how far today’s price is from normal.",
    here: "Prices can only move inside a band around base, set per resource.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  range30: {
    title: "Position in the 30-day range",
    what: "Where today’s sell price sits between its **lowest** and **highest** price of the last 30 in-game days.",
    here: "Left end = at the 30-day low, right end = at the 30-day high. Uses the market’s own 30-day price history.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  marketSupply: {
    title: "Market supply",
    what: "How much of a resource the market holds right now, compared with its normal amount.",
    here: "100% = the market’s normal volume for that resource.",
    source: "Game data via CrustWatcher",
    wiki: "online-market",
  },
  holdings: {
    title: "You hold",
    what: "How many units of a resource you have.",
    here: "==Live== while the game runs: read from the game’s own statistics about every 30 seconds. Checked against your save: live credits matched 108 of 108 readings, and resources nothing had touched matched exactly at load. When the game isn’t running, the numbers come from your **last save**.",
    source: "Game statistics via CrustWatcher; Stats.bin",
  },
  stockValue: {
    title: "Stock worth",
    what: "Your holdings × the current sell price.",
    here: "A guide, not a promise: selling adds supply and lowers the price, so selling everything at once fetches less than this.",
    source: "Calculated from your holdings and live prices",
    wiki: "online-market",
  },
  income: {
    title: "Income",
    what: "Credits coming in, by source: contract rewards, market sales, points of interest, construction refunds and the bank.",
    here: "Totals for the chosen range. Each day’s amounts match that day’s change in credits.",
    source: "Stats.bin income series",
    wiki: "credits",
  },
  spending: {
    title: "Spending",
    what: "Credits going out, by category: market purchases, construction, colonists, penalties, loan payments, probes, area rent and outposts.",
    here: "Totals for the chosen range, as the game’s statistics record them.",
    source: "Stats.bin spending series",
    wiki: "credits",
  },
  contracts: {
    title: "Contracts",
    what: "Deliveries of resources to organizations for credits, and sometimes research points or reputation.",
    here: "Rewards and penalties as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "contracts-and-tenders",
  },
  trades: {
    title: "Market trades",
    what: "Buying and selling on the Online Market, including auto-trading.",
    here: "Sales and purchases as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "online-market",
  },
  construction: {
    title: "Construction",
    what: "Credits spent building, and refunded when you take things down.",
    here: "Spending and refunds as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "construction-costs",
  },
  colonists: {
    title: "Colonists",
    what: "Hired workers who run modules.",
    here: "Colonist expenses as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "colonists",
  },
  bank: {
    title: "Bank and loans",
    what: "Loans with monthly payments, from the Bank section of the Commercial Center.",
    here: "Loan income and payments as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "bank-and-reputation",
  },
  poi: {
    title: "Points of interest",
    what: "Sites found by your rover, repeaters and probes.",
    here: "Rewards, penalties and probe purchases as the game records them in its statistics.",
    source: "Stats.bin",
    wiki: "points-of-interest",
  },
  cpu: {
    title: "CPU",
    what: "Computing power: ==every module and drone uses some==.",
    here: "Reserved versus limit, from your last save.",
    source: "Stats.bin",
    wiki: "cpu",
  },
  buildings: {
    title: "Buildings",
    what: "Modules you’ve built, counted by type.",
    here: "From the game’s statistics at each save. Module names link to their Wiki articles where one exists.",
    source: "Stats.bin",
  },
  research: {
    title: "Research",
    what: "Fundamental, Engineering and Social points unlock technologies.",
    source: "Game text",
    wiki: "research-system",
  },
  alerts: {
    title: "Alerts",
    what: "Your own triggers on live prices, market position, holdings and credits.",
    here: "Checked on every live update **while this dashboard is open** in a browser tab. A soft chime plays and a pop-up shows the result; click it to jump to that resource. Saved in this browser.",
    source: "This dashboard",
  },
  pins: {
    title: "Pins",
    what: "Pinned resources stay at the top of the Resources table, highlighted in the color you pick, and appear as cards in Live now.",
    source: "This dashboard",
  },
  insights: {
    title: "Findings",
    what: "Advice from your own numbers, each with **the figures behind it**, what it means, and what to do.",
    here: "Findings from your saves for the chosen range, plus live market opportunities while the game runs. A finding only appears when your data triggers it; each names its source, and game terms link to the Wiki.",
    source: "This dashboard",
  },
  slag: {
    title: "Slag",
    what: "A by-product left when regolith is refined.",
    source: "Stats.bin",
    wiki: "slag",
  },
};
