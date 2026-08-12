# Data safety note

`seed-state.json` is retained only because it was part of the supplied V2 project.
V3 never reads it, never writes it to Firestore, and never creates or replaces
`pwp_manpower/state` automatically. There is no local database fallback in V3.
