# Topology-Aware Route Planning Stages

## Goal

Replace feature-by-feature traversal with topology-aware route planning. The planner must support
closed shapes, branches, T-junctions, endpoint touches, self-intersections, and shapes intersecting
in the middle of a segment. It should cover every drawn path while duplicating only the geometry
needed to produce a continuous route.

The stages below are dependencies, not alternative solutions. Graph construction determines what
is connected; route planning determines how to traverse that graph.

## Phase A: Build the topology graph

### 1. Exact noding

Detect exact intersections, endpoint touches, self-intersections, and T-junctions. Split every
affected path at those points.

For example, a T-junction becomes:

```text
A ─── J ─── B
      │
      C
```

`A–J`, `J–B`, and `J–C` are separate graph edges. This stage only determines connectivity; it
does not choose a traversal.

### 2. Near-connection inference

Extend graph construction to strokes whose endpoints nearly touch another path. Project and snap
the endpoint onto the path, create a junction, and split the path there.

Split exact intersections first, then consider only free endpoints for snapping. Plan every free
end's destination against the unmoved geometry, ignoring geometry reachable within twice the
tolerance along the drawing (the stroke's own tail). Free ends within tolerance of each other meet
at one shared point — their midpoint, or its projection onto a path all of them reach — and any
other free end projects onto the nearest path. Apply all moves together: each projection becomes a
fixed junction on its host, and a host whose own end also moves bends through that junction. If
moving either or both endpoints of a segment would collapse it or introduce an overlap, keep that
segment in its original position and plan the rest again.

This is an enhancement to exact noding. Exactly connected drawings can work without it, while
freehand sketches and imported geometry will usually need a configurable snapping tolerance.

## Phase B: Plan a traversal inside each connected component

### 3. Chinese Postman planner

Given a connected graph from phase A, find a walk that:

- traverses every drawn edge;
- may start and finish at different nodes;
- duplicates the minimum necessary edges.

The route is not required to return to its start: for many drawings that would only add
retracing. A component without odd-degree vertices still produces a closed circuit.

For an undirected graph, pair all but two odd-degree vertices using minimum-cost paths, duplicate
those paths, and then produce an Euler trail through the augmented graph between the two unpaired
vertices. The planner leaves unpaired the two odd vertices whose omission saves the most retracing.

This is where the planner determines that a dead-end ray must be traversed outward and back. For a
drawing with several rays, the route can start at one outer tip and finish at another; those two
rays are traversed once and the other dead ends are retraced. The first usable implementation
therefore requires both exact noding and this traversal planner.

## Phase C: Integrate with the routing pipeline

### 4. Order disconnected components

Once each connected component can produce valid traversal candidates, use the existing shape
optimizer to order disconnected components and select their orientations. Individual GeoJSON
features should no longer be the optimizer's atomic unit.

### 5. Allocate vias and map-match

Convert the selected graph walk back into ordered sketch coordinates. Preserve junctions and
dead-end tips as mandatory points, simplify the remaining geometry to the global via budget, and
then send the ordered trace to Valhalla.

Traversal must be assembled before via allocation because duplicated branches increase the number
of required samples.

## Recommended implementation order

```text
Exact graph construction
        ↓
Chinese Postman
        ↓
Route emission and map matching
        ↓
Near-endpoint snapping
        ↓
Disconnected-component optimization
```

The first functional vertical slice is exact graph construction, Chinese Postman planning, and route
emission. Near snapping and disconnected-component ordering can then improve that working
foundation independently.
