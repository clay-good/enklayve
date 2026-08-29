/**
 * Free tax filing (SPEC-4 §A5).
 *
 * "Do I have to pay to file?" For most households the answer is no, and they pay
 * anyway — the paid products are the ones with the advertising budget, and the
 * free channels are the ones with a .gov URL and no marketing at all. The
 * eligibility rules are small, published, and fully deterministic, so this is
 * the cheapest real money the site can hand someone.
 *
 * The engine returns three groups, and all three matter: what you qualify for,
 * what you don't and exactly why, and what was checked and found unavailable.
 * A tool that only lists the hits invites the reader to wonder what it missed.
 */
import type { FreeFilingChannel, FreeFilingData } from "../data/schemas";

/** What the household knows about itself. Everything optional but AGI. */
export interface FreeFilingInput {
  adjustedGrossIncome: number;
  /** Oldest household member's age; TCE keys off 60 and older. */
  age?: number;
  military?: boolean;
  disability?: boolean;
  limitedEnglish?: boolean;
}

export interface ChannelEligibility {
  channel: FreeFilingChannel;
  eligible: boolean;
  /** Why it applies, or why it doesn't — always populated, never a bare "no". */
  reason: string;
  /** True when a non-income condition (disability, limited English) carried it. */
  viaCondition: boolean;
}

export interface FreeFilingResult {
  eligible: ChannelEligibility[];
  ineligible: ChannelEligibility[];
  /** Channels checked and found unavailable this season, with the reason. */
  omitted: FreeFilingData["omitted"];
  filingSeason: number;
  taxYear: number;
  /** True when at least one channel is open. In practice this is always true —
   *  Free File Fillable Forms has no income limit — and saying so is the point. */
  anyFree: boolean;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Evaluate one channel against the household. Pure. */
function evaluate(channel: FreeFilingChannel, input: FreeFilingInput): ChannelEligibility {
  const agi = Math.max(0, finite(input.adjustedGrossIncome));
  const age = Math.max(0, finite(input.age ?? 0));

  if (channel.requiresMilitary && !input.military) {
    return {
      channel,
      eligible: false,
      reason: "For the military community. Tick the box above if that's you.",
      viaCondition: false,
    };
  }
  if (channel.minAge !== null && age < channel.minAge) {
    return {
      channel,
      eligible: false,
      reason: `For people ${channel.minAge} and older. There is no income limit, so this opens up at ${channel.minAge}.`,
      viaCondition: false,
    };
  }

  // A qualifying condition carries the household past the income ceiling. This
  // is the branch most likely to be missed by someone reading the raw rules, so
  // it is stated explicitly rather than folded into a generic "eligible".
  const condition = channel.alsoQualifies.find(
    (c) => (c === "disability" && input.disability) || (c === "limited-english" && input.limitedEnglish),
  );
  if (channel.agiLimit !== null && agi > channel.agiLimit) {
    if (condition) {
      return {
        channel,
        eligible: true,
        reason:
          condition === "disability"
            ? `Open to people with disabilities regardless of the ${money(channel.agiLimit)} guideline.`
            : `Open to taxpayers with limited English proficiency regardless of the ${money(channel.agiLimit)} guideline.`,
        viaCondition: true,
      };
    }
    return {
      channel,
      eligible: false,
      reason: `Your income is above the ${money(channel.agiLimit)} guideline by ${money(agi - channel.agiLimit)}.`,
      viaCondition: false,
    };
  }

  const reason =
    channel.agiLimit !== null
      ? `Your income is within the ${money(channel.agiLimit)} guideline.`
      : channel.minAge !== null
        ? `You meet the age-${channel.minAge} criterion, and there is no income limit.`
        : channel.requiresMilitary
          ? "Open to the military community, with no income limit."
          : "Open at every income level.";
  return { channel, eligible: true, reason, viaCondition: false };
}

/** Which free filing channels this household can use, and why not for the rest. */
export function freeFilingOptions(
  input: FreeFilingInput,
  data: FreeFilingData,
): FreeFilingResult {
  const evaluated = data.channels.map((c) => evaluate(c, input));
  const eligible = evaluated.filter((e) => e.eligible);
  return {
    eligible,
    ineligible: evaluated.filter((e) => !e.eligible),
    omitted: data.omitted,
    filingSeason: data.filingSeason,
    taxYear: data.taxYear,
    anyFree: eligible.length > 0,
  };
}
