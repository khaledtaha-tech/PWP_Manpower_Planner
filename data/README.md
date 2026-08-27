# Data safety note

`seed-state.json` is retained only because it was part of the supplied V2 project.
The running MySQL application does not read or import it. Live draft data is
stored only in `app_state`; published snapshots are stored in `history`.
