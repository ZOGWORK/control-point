import { describe, it, expect } from "vitest";
import { detectSuiteIntent, suiteSuggestion, teamNumberIn } from "../suiteSuggestions";

const base = { reply: "Here is what I found.", season: 2025 };

describe("detectSuiteIntent", () => {
  it.each([
    "What's team 6980's OPR this season?",
    "How did we rank at the NJ qualifier?",
    "Who will win the USNJCMP finals?",
    "Show me the rankings at our last event",
    "What's our win rate this season?",
    "What are the match predictions for Q12?",
    "Which teams should we pick for alliance selection?",
    "What was the high score at states?",
    "What's 4215's record at their events?",
  ])("stats: %s", (q) => expect(detectSuiteIntent(q)).toBe("stats"));

  it.each([
    "How do I make a BOM from our Onshape assembly?",
    "Can you export STEP files for the drivetrain?",
    "What parts do we need to buy for the new intake?",
    "Which brackets should we 3D print?",
    "Update the parts list for the lift",
    "Our CAD is a mess, how should we organize it?",
    "We need to order more motors and servos",
  ])("cad: %s", (q) => expect(detectSuiteIntent(q)).toBe("cad"));

  it.each([
    "Remind me to bring snacks on Friday",
    "Rank these tasks by priority",
    "What's our attendance record this month?",
    "Write a notebook entry about Saturday's meeting",
    "How much budget do we have left?",
    "Summarize the last chat",
    "",
  ])("neither: %s", (q) => expect(detectSuiteIntent(q)).toBeNull());

  it("both: one intent, the stronger signal winning; a tie goes to stats", () => {
    // Two CAD signals (Onshape, BOM) against one stats signal (OPR).
    expect(detectSuiteIntent("Compare our OPR with how complete our Onshape BOM is")).toBe("cad");
    // One each.
    expect(detectSuiteIntent("What's team 6980's OPR, and do they share their CAD?")).toBe("stats");
    // Two stats signals (OPR, rankings) against one CAD signal (CAD).
    expect(detectSuiteIntent("Did better CAD help our OPR and our rankings?")).toBe("stats");
  });
});

describe("teamNumberIn", () => {
  it("finds one named team, or none when there are several", () => {
    expect(teamNumberIn("What's team 6980's OPR?")).toBe(6980);
    expect(teamNumberIn("How is #4215 doing?")).toBe(4215);
    expect(teamNumberIn("4215's record")).toBe(4215);
    expect(teamNumberIn("Compare team 6980 and team 4215")).toBeNull();
    expect(teamNumberIn("Who won in 2025?")).toBeNull();
    // A season, not a team; "team 2025" still names one.
    expect(teamNumberIn("What's our 2025 OPR?")).toBeNull();
    expect(teamNumberIn("Show our 2024 record")).toBeNull();
    expect(teamNumberIn("How is team 2025 doing?")).toBe(2025);
  });

  it("a season in an 'our' question links our team, not a team named after the year", () => {
    expect(suiteSuggestion({ ...base, question: "What's our 2025 OPR?", ownTeam: 18360 })).toContain("https://controlscout.org/teams/18360?season=2025");
  });
});

describe("suiteSuggestion", () => {
  it("stats: one line to Control Scout, linking the one team Bruno looked up", () => {
    const line = suiteSuggestion({ ...base, question: "How is 4215 doing?", lookedUpTeams: [4215] });
    expect(line).toBe("\n\n_For detailed team, event and match overviews and predictions, see [Team 4215 on Control Scout](https://controlscout.org/teams/4215?season=2025)._");
  });

  it("stats: links the event Bruno looked up, upper-cased", () => {
    const line = suiteSuggestion({ ...base, question: "Who are the top teams at the NJ championship?", lookedUpEvent: "usnjcmp" });
    expect(line).toContain("[USNJCMP on Control Scout](https://controlscout.org/events/2025/USNJCMP)");
  });

  it("stats: a named team, then our own team for 'our', then Scout's home", () => {
    expect(suiteSuggestion({ ...base, question: "What's team 6980's OPR?" })).toContain("https://controlscout.org/teams/6980?season=2025");
    expect(suiteSuggestion({ ...base, question: "What's our OPR?", ownTeam: 18360 })).toContain("[Team 18360 on Control Scout](https://controlscout.org/teams/18360?season=2025)");
    expect(suiteSuggestion({ ...base, question: "Who will win worlds?", ownTeam: 18360 })).toContain("[Control Scout](https://controlscout.org)");
    // Several teams looked up: no one team to link.
    expect(suiteSuggestion({ ...base, question: "Compare team 1 and team 2 OPR", lookedUpTeams: [1, 2] })).toContain("[Control Scout](https://controlscout.org)");
  });

  it("stats: an event code that isn't a plain code is not put in a link", () => {
    expect(suiteSuggestion({ ...base, question: "Rankings at the qualifier?", lookedUpEvent: "../admin" })).toContain("[Control Scout](https://controlscout.org)");
  });

  it("cad: one line to Control Kit for Onshape", () => {
    expect(suiteSuggestion({ ...base, question: "What do we need to buy for the Onshape drivetrain?" }))
      .toBe("\n\n_For a BOM, buy list and STEP files straight from your Onshape assembly, try [Control Kit for Onshape](https://control-kit.pages.dev)._");
  });

  it("neither: nothing", () => {
    expect(suiteSuggestion({ ...base, question: "Remind me to bring snacks on Friday" })).toBe("");
  });

  it("not again once the reply or the chat already links that app", () => {
    expect(suiteSuggestion({ ...base, question: "What's our OPR?", reply: "See https://controlscout.org/teams/1" })).toBe("");
    expect(suiteSuggestion({ ...base, question: "What's our OPR?", history: ["…see [Control Scout](https://controlscout.org)."] })).toBe("");
    expect(suiteSuggestion({ ...base, question: "Make a BOM in Onshape", history: ["try [Control Kit for Onshape](https://control-kit.pages.dev)"] })).toBe("");
    // The other app's link earlier doesn't stop this one.
    expect(suiteSuggestion({ ...base, question: "Make a BOM in Onshape", history: ["https://controlscout.org"] })).toContain("control-kit.pages.dev");
  });
});
