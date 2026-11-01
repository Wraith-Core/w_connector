# Console UI provenance

This is the existing `w_admin` React console, including its full workspace, F10 quick menu,
command palette, inline help, locales, fonts and assets. It is not a replacement design.

Source: `Wraith-Core/w_admin`, commit `646c0d3be138e39747f7571fc1bfcf3c427cbed8`,
with the owner's pending money-reason UI changes captured by the task baseline. The complete
source file hashes and pending file list are recorded in the task's `baseline.json`.

The UI remains under GPL-3.0; `LICENSE` is retained here and in the runtime UI. Preserve all
asset and font notices. Distribute this corresponding UI source with releases.

Connector-specific changes adapt the NUI host and capabilities to the existing signed website
permission and framework-adapter boundary. No framework admin/master rank is created.
