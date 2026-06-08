import { describe, it, expect } from "vitest";
import { RingBuffer } from "./RingBuffer.js";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const rb = new RingBuffer(4);
    expect(rb.length).toBe(0);
  });

  it("stores and retrieves items in order (oldest=0, newest=length-1)", () => {
    const rb = new RingBuffer(4);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.at(0)).toBe(1);
    expect(rb.at(2)).toBe(3);
  });

  it("evicts oldest when full", () => {
    const rb = new RingBuffer(3);
    rb.push("a");
    rb.push("b");
    rb.push("c");
    rb.push("d");
    expect(rb.length).toBe(3);
    expect(rb.at(0)).toBe("b");
    expect(rb.at(2)).toBe("d");
  });

  it("toArray returns ordered slice newest-last", () => {
    const rb = new RingBuffer(3);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    rb.push(40);
    expect(rb.toArray()).toEqual([20, 30, 40]);
  });

  it("clear resets to empty", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
  });
});
