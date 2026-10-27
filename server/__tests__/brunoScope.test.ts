/**
 * Bruno answered "write an essay on chocolate milk" in full, and nothing
 * reached the owner's Flags tab. Plain schoolwork is now refused before any
 * model call and flagged; anything about the robot or the team still goes
 * to Bruno.
 */
import { describe, it, expect } from "vitest";
import { isOffTopicSchoolwork } from "../brunoScope";

describe("isOffTopicSchoolwork", () => {
  it.each([
    "write an essay on chocolate milk",
    "Write me a 500 word essay about the Civil War",
    "can you do my math homework",
    "solve 3x + 5 = 20",
    "solve for x: 2x - 4 = 10",
    "what is the derivative of x^2 sin x",
    "draft a poem about autumn for english class",
    "Write a poem about autumn for my literature class",
    "Bruno, write my essay about the French Revolution for school",
  ])("refuses %j", (text) => {
    expect(isOffTopicSchoolwork(text)).toBe(true);
  });

  it.each([
    "help me write an essay for our robotics portfolio",
    "write the Inspire award essay for our engineering notebook",
    "what gear ratio do I need for a 40 inch per second drivetrain",
    "solve for x in my odometry math: the encoder reads 2000 ticks",
    "my intake jams, how do I fix it",
    "write an outreach recap for the library demo",
    "what's on the calendar this week",
    "fix this NullPointerException in my TeleOp",
  ])("lets %j through", (text) => {
    expect(isOffTopicSchoolwork(text)).toBe(false);
  });

  it("addressing Bruno by name doesn't change the answer", () => {
    expect(isOffTopicSchoolwork("Bruno, write an essay on chocolate milk")).toBe(true);
    expect(isOffTopicSchoolwork("hey bruno can you do my math homework")).toBe(true);
  });

  it("a follow-up in a chat about the robot goes to Bruno", () => {
    const earlier = ["how do I convert odometry encoder ticks to inches?"];
    expect(isOffTopicSchoolwork("now solve for x: 2x - 4 = 10", earlier)).toBe(false);
    expect(isOffTopicSchoolwork("now solve for x: 2x - 4 = 10", ["what's for lunch"])).toBe(true);
  });
});
