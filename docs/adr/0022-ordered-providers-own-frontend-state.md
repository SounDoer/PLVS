# ADR 0022: Ordered providers own frontend state

## Status

Accepted

## Context

`AppContent` in `src/App.jsx` owned almost all application state. Each owner hook (`useSettings`,
`useDockMode`, `useDockLayout`, `usePresets`, `useAudioDevices`) may be mounted once, so its values
could reach other components only as props from that one component. Cross-domain operations such as
restoring window attributes on Dock exit lived there because it was the only place holding every
part they needed. The Agent Control bridge received about thirty inputs relayed the same way.

Two simpler-looking alternatives were considered and rejected.

Grouping the hook calls into a few composed hooks, still called from `AppContent`, shortens the file
and changes nothing else: the inputs become hook parameters and ownership stays where it was.

Moving state into module-level stores read with `useSyncExternalStore` would let Agent Control read
and write state without passing through React. It would also require rewriting business functions
that are hooks closed over React state, with no working intermediate state, and it contradicts the
rule that live mutations pass through the running React application's business functions, guards
and persistence paths. Its one advantage is that Agent Control would not depend on the render
cycle. A test on Windows on 2026-10-06 found no such dependency in practice: with the main window
visible, hidden and minimized, queries and mutations succeeded at the same speed and the webview's
animation frames were not throttled.

## Decision

Each frontend state domain has one owner, a React context provider that mounts the existing owner
hooks. The providers nest in dependency order: a provider may read a provider that encloses it and
never one it encloses. `App` in `src/App.jsx` is where that order is written down.

Three rules keep the order free of cycles:

- A stored preference and the effect that applies it to the OS window are different owners. The
  Dock restores the user's pin and focus-view values on exit, so those values belong to Settings,
  which encloses the Dock; the effects that apply them stand down while docked, so they belong to
  the window chrome, which the Dock encloses.
- Effects that act on the same native object stay in one component, in a fixed order. Nested
  components run a child's effects before its parent's, so splitting such effects across providers
  would change the order they fire in.
- A cross-domain operation belongs to the innermost domain it touches, which can read every other
  domain involved. A scene operation keeps its guard inside the business function.

Where an outer owner needs something an inner owner defines, the outer one exposes a ref and the
inner one assigns it during render. The clear shortcut, registered by Settings and implemented by
the source actions, is the one such link.

Agent Control is a component rendered inside the providers. It reads each domain through that
domain's hook, calls the owning domain's business function to mutate, and still settles a mutation
when React has rendered the committed state.

## Consequences

- A new piece of application state needs an owner chosen by what it depends on. Adding it to
  `AppContent` because every value happens to be in scope there recreates the original problem.
- The provider nesting is deep. That depth is the dependency order made explicit, not incidental
  structure to flatten.
- A context re-renders every consumer when its value changes. A value that changes per meter frame
  must not share a context with values that change at human speed; the metering runtime publishes
  notices and the scrub position separately from the per-frame audio record for this reason.
- Agent Control continues to depend on the webview rendering. If a platform or window state is
  found where it does not, that case is addressed on its own; this decision does not prevent moving
  a single domain out of React later.
- Presentational components keep receiving props, so their tests do not need the provider tree.
