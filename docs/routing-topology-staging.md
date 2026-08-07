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

This is an enhancement to exact noding. Exactly connected drawings can work without it, while
freehand sketches and imported geometry will usually need a configurable snapping tolerance.

## Phase B: Plan a traversal inside each connected component

### 3. Closed Chinese Postman planner

Given a connected graph from phase A, find a walk that:

- traverses every drawn edge;
- starts and ends at the same node;
- duplicates the minimum necessary edges.

This is where the planner determines that a dead-end ray must be traversed outward and back. The
first usable implementation therefore requires both exact noding and this closed traversal
planner.

For an undirected graph, pair all odd-degree vertices using minimum-cost paths, duplicate those
paths, and then produce an Euler circuit through the augmented graph.

### 4. Open Chinese Postman optimization

Generalize the planner so the route may start and finish at different nodes. The planner chooses
two nodes to remain odd and pairs the remaining odd-degree vertices at minimum cost.

For a drawing with several rays, an open route can start at one outer tip and finish at another.
Those two rays may only need to be traversed once; other dead ends are still retraced.

This stage improves the closed planner. It does not replace graph construction or the underlying
Chinese Postman solution.

## Phase C: Integrate with the routing pipeline

### 5. Order disconnected components

Once each connected component can produce valid traversal candidates, use the existing shape
optimizer to order disconnected components and select their orientations. Individual GeoJSON
features should no longer be the optimizer's atomic unit.

### 6. Allocate vias and map-match

Convert the selected graph walk back into ordered sketch coordinates. Preserve junctions and
dead-end tips as mandatory points, simplify the remaining geometry to the global via budget, and
then send the ordered trace to Valhalla.

Traversal must be assembled before via allocation because duplicated branches increase the number
of required samples.

## Recommended implementation order

```text
Exact graph construction
        ↓
Closed Chinese Postman
        ↓
Route emission and map matching
        ↓
Near-endpoint snapping
        ↓
Open start/end optimization
        ↓
Disconnected-component optimization
```

The first functional vertical slice is exact graph construction, closed Chinese Postman planning,
and route emission. Near snapping, open-route optimization, and disconnected-component ordering
can then improve that working foundation independently.
