# Eagle Suite Svelte nodes

This directory is an isolated build workspace for new Svelte-based ComfyUI
nodes. Existing Vue nodes remain source-compatible and are not imported here.

## Build

```powershell
cd frontend-svelte
npm install
npm run check
npm run build
```

The build writes stable browser assets to `web/svelte-dist/`. The thin ComfyUI
adapter stays in `web/js/h3_review_workspace_svelte.js`; it owns DOMWidget
mount/unmount and passes only explicit callbacks to the compiled component.

End users do not need Node.js or npm. Commit the generated JS and CSS files.

## Integration boundary

The prototype backend lives in `eagle_suite/h3_review_workspace.py` and exports
standalone node mappings. Merge these mappings into the package registry only
after the H3 backend branch is stable. Do not register the Svelte adapter for
`EagleH3CheckpointReviewNode`: Vue and Svelte must not patch the same node type.

The only central integration required is equivalent to:

```python
from .h3_review_workspace import (
    NODE_CLASS_MAPPINGS_H3_REVIEW_SVELTE,
    NODE_DISPLAY_NAME_MAPPINGS_H3_REVIEW_SVELTE,
)

NODE_CLASS_MAPPINGS.update(NODE_CLASS_MAPPINGS_H3_REVIEW_SVELTE)
NODE_DISPLAY_NAME_MAPPINGS.update(NODE_DISPLAY_NAME_MAPPINGS_H3_REVIEW_SVELTE)
```

`workspace_state` is the sole persisted UI state and is schema-versioned. Large
runtime values such as video previews, review history, tensors, and run tokens
remain outside workflow JSON and arrive through the existing H3 review event.
