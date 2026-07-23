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

  it("clear releases stored object references", () => {
    const rb = new RingBuffer(3);
    const retained = { large: new Array(1000).fill("x") };
    rb.push(retained);
    rb.clear();
    expect(rb._buf.every((entry) => entry === undefined)).toBe(true);
  });

  it("at() returns undefined for out-of-bounds index", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    expect(rb.at(1)).toBeUndefined();
    expect(rb.at(-1)).toBeUndefined();
  });

  it("constructor throws for capacity <= 0", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(-1)).toThrow(RangeError);
  });

  it("capacity getter returns the configured capacity", () => {
    const rb = new RingBuffer(5);
    expect(rb.capacity).toBe(5);
  });

  it("implements rowAt as a chronological alias of at", () => {
    const rb = new RingBuffer(3);
    rb.push({ timestampMs: 10 });
    rb.push({ timestampMs: 20 });
    rb.push({ timestampMs: 30 });
    rb.push({ timestampMs: 40 });
    expect(rb.rowAt(0)).toEqual({ timestampMs: 20 });
    expect(rb.rowAt(2)).toEqual({ timestampMs: 40 });
  });

  it("reads row timestamps without materializing the ring", () => {
    const rb = new RingBuffer(2);
    rb.push({ timestampMs: 10 });
    rb.push({ timestampMs: 20 });
    expect(rb.timestampAt(0)).toBe(10);
    expect(rb.timestampAt(1)).toBe(20);
  });

  it("increments version on push and clear", () => {
    const rb = new RingBuffer(2);
    const initial = rb.version;
    rb.push("a");
    expect(rb.version).toBe(initial + 1);
    rb.clear();
    expect(rb.version).toBe(initial + 2);
  });

  it("supports chronological iteration and map during array-view migration", () => {
    const rb = new RingBuffer(2);
    rb.push("a");
    rb.push("b");
    rb.push("c");
    expect([...rb]).toEqual(["b", "c"]);
    expect(rb.map((value, index, ring) => `${index}:${value}:${ring === rb}`)).toEqual([
      "0:b:true",
      "1:c:true",
    ]);
  });
});
