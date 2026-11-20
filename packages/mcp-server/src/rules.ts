export const SERVER_INSTRUCTIONS = `FactoryMCP is a 2D tile factory game. You are the player's engineering partner.
The player owns the factory; you investigate, simulate and propose. Typical loop:
1. get_overview to see tier goal, hub rates, power and ore patches.
2. get_rules_and_recipes once, to learn ports, belts and recipes.
3. inspect_zone / inspect_region to read the layout (ASCII + entity ports).
4. simulate_patch to test edits; fix the reported errors and iterate.
5. propose_refactor with your best patch. The player sees a ghost preview and approves it in-game.
Prefer propose_refactor over execute_actions. Always explain trade-offs in the rationale.`;

export const GAME_RULES = `# FactoryMCP rules

Coordinates: x grows east, y grows south. (0,0) is the top-left cell. Dir is one of N, E, S, W.
Every rate is per minute (/m). The simulation runs at 20 ticks per second.

## Placement
- Entities occupy size x size cells starting at (x, y) as the top-left corner, regardless of dir.
- Placement never replaces anything: remove or clear first. Construction is free and instant.
- Miners must cover at least one ore cell. Ore is infinite.

## Belts and logistics (single lane)
- belt: 1 tile/s = 60/m. fast_belt (tier 2): 3 tiles/s = 180/m.
- A belt moves items toward its dir and pushes into the entity in front of it.
- A belt accepts items from its back and both sides (side-loading), never from its front.
- splitter (tier 2): accepts from its back, alternates output to its left and right neighbours.
- merger (tier 2): accepts from back, left and right; outputs to its front.
- tunnel_in / tunnel_out (tier 2): tunnel_in accepts from its back only and links to the nearest tunnel_out
  with the same dir within 5 cells ahead (up to 4 cells in between). Anything may sit between them.
- The hub (4x4) accepts every item from any belt pointing into any of its edge cells.

## Machine ports
- Machines only exchange items through their ports. inspect results list absolute ports:
  "cell" is the machine cell, "side" the side of that cell, "connect" the outside cell where a
  belt must sit. An input port takes items from a belt at "connect" pointing into the machine.
  An output port pushes into whatever accepts items at "connect" (a belt not facing back into the machine, or another machine input).
- Ports are defined facing E and rotate clockwise with dir (E -> S -> W -> N).
- miner 2x2: output at local (1,0) side E. 30/m on standard ore, 15/m low purity, 60/m high purity. 60 kW.
- stone_furnace 2x2: inputs at local (0,0) W and (0,1) W, output (1,0) E. Needs coal as fuel
  (3 coal/m while working) delivered through either input. Coal and ore may come on separate inputs.
- electric_furnace 2x2 (tier 2): same ports, 1.5x speed, 180 kW, no fuel.
- assembler 1x1: inputs W, N, S; output E (all relative to dir). 80 kW.
- coal_generator 3x3: coal inputs at the middle of every side. Adds 1.2 MW. Burns up to 15 coal/m at full load.
- A machine holds up to about two crafts worth of each input and output; when its output is full it stops (blocked).

## Power
- One global grid, no poles. The hub supplies 1 MW. Generators add capacity when fuelled.
- If demand exceeds supply, every electric machine slows to supply/demand.

## Zones and ports
- The player can mark a zone. Inside propose_refactor / simulate_patch with zone_id, edits must stay inside it.
- Zone ports are the cells inside the zone where items enter or leave across the boundary. They are locked:
  keep them, connect your new layout to them, and keep their throughput (portRegressions warns otherwise).

## Patch ops (applied in order, stop at first error)
- {"op":"place","type":"assembler","x":10,"y":4,"dir":"E","recipe":"iron_gear"}
- {"op":"remove","x":10,"y":4}  (any cell of the entity)
- {"op":"clear","x":8,"y":2,"w":6,"h":5}  (removes entities fully inside, keeps zone ports)
- {"op":"set_recipe","x":10,"y":4,"recipe":"copper_wire"}
- {"op":"rotate","x":10,"y":4,"dir":"S"}
- {"op":"belt_path","points":[[3,4],[9,4],[9,8]],"type":"belt","end_dir":"E"}
  Axis-aligned polyline; each cell faces the next point; the last cell faces end_dir (default: last segment dir).
  The path must not cross itself or anything else; use a tunnel to cross.
`;
