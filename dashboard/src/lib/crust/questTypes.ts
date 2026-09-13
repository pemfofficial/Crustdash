// Missions as the game saves them (client-safe types). See quests.ts for the save reader.

export type QuestCheckpoint = {
  name: string;
  description: string;
  completed: boolean;
  /** The glossary value the game watches for this step, e.g. "G.Stats.CapsuleLandingPlatformTempSysCount". */
  glossary: string | null;
  /** The value that completes the step. */
  target: number | null;
  /** The watched value when the game last saved. */
  last: number | null;
  targetName: string | null;
};

export type QuestStage = { name: string; active: boolean; checkpoints: QuestCheckpoint[] };

export type Quest = {
  /** Gameplay tag, e.g. "Q.Quest.Million". */
  tag: string;
  name: string;
  description: string;
  status: string | null;
  tracked: boolean;
  stages: QuestStage[];
};

export type QuestReport = {
  /** When the save these quests come from was written (ISO). */
  savedAt: string | null;
  quests: Quest[];
  /** Every quest title in the game text, for naming quests that start between saves. */
  titles: { key: string; title: string }[];
  error?: string;
};
