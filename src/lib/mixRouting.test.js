import { describe, expect, it } from "vitest";
import { CHANNEL_LAYOUTS } from "../math/channelLayoutTable.js";
import { autoMixRoute, compileMixRouting, resolveMixFormat } from "./mixRouting.js";

const rolesFor = (id) => CHANNEL_LAYOUTS.find((layout) => layout.id === id).roles;

describe("Mix channel conversion", () => {
  it("routes every supported layout pair by role and omits only an absent LFE", () => {
    for (const source of CHANNEL_LAYOUTS) {
      for (const target of CHANNEL_LAYOUTS) {
        for (const role of source.roles) {
          const routes = autoMixRoute(role, target.roles);
          expect(routes).not.toBeNull();
          expect(
            routes.every(
              ([destination, gain]) => target.roles.includes(destination) && Number.isFinite(gain)
            )
          ).toBe(true);
          if (target.roles.includes(role)) expect(routes).toEqual([[role, 1]]);
          else if (role === "LFE") expect(routes).toEqual([]);
          else expect(routes.length).toBeGreaterThan(0);
        }
      }
    }
    expect(autoMixRoute("Lb", rolesFor("5.1"))).toEqual([["Ls", 1]]);
    expect(autoMixRoute("Ltr", rolesFor("5.1.2"))).toEqual([["Ltf", Math.SQRT1_2]]);
    expect(autoMixRoute("Lc", rolesFor("7.1"))).toEqual([
      ["L", Math.SQRT1_2],
      ["C", Math.SQRT1_2],
    ]);
    expect(autoMixRoute("C", rolesFor("mono"))[0][1]).toBeCloseTo(1);
    expect(autoMixRoute("Rs", rolesFor("mono"))[0][1]).toBeCloseTo(0.5);
  });

  it("keeps actual captured output roles separate from the reference format", () => {
    const id = `lb-${"1".repeat(32)}`;
    const output = {
      id,
      label: "Speakers",
      mixOutputRoles: ["L", "R"],
      referenceRoles: rolesFor("5.1"),
    };
    const mix = { members: [], output: { id, label: "Speakers" } };
    const format = resolveMixFormat(mix, [output], {
      label: "Headphones",
      referenceRoles: ["L", "R"],
    });
    expect(format.name).toBe("5.1");
    expect(compileMixRouting(mix, [output], null)).toMatchObject({
      roles: rolesFor("5.1"),
      outputRoles: ["L", "R"],
      routes: { [id]: [[[0, 1]], [[1, 1]]] },
    });
  });

  it("compiles separate gains for multiple inputs and retains invalid overrides for repair", () => {
    const first = `cap-${"1".repeat(32)}`;
    const second = `cap-${"2".repeat(32)}`;
    const mix = {
      members: [],
      format: "5.1",
      inputs: [
        { id: first, channels: [2] },
        { id: second, channels: [0] },
      ],
      routes: {
        [first]: {
          2: [
            ["Ls", 0.5],
            ["LFE", 0.25],
          ],
        },
      },
    };
    const plan = compileMixRouting(mix, [], null);
    expect(plan.routes[first]).toEqual([
      [
        [4, 0.5],
        [3, 0.25],
      ],
    ]);
    expect(plan.routes[second]).toEqual([[[2, 1]]]);
    expect(compileMixRouting({ ...mix, format: "stereo" }, [], null)).toBeNull();
  });
});
