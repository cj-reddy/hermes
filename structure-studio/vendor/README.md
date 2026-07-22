# Vendored Three.js modules

Pinned from Three.js `0.169.0` on 2026-07-22 so the application does not execute runtime JavaScript from a third-party CDN.

| File | Upstream path | Upstream SHA-256 | Local SHA-256 |
| --- | --- | --- | --- |
| `three.module.js` | `three@0.169.0/build/three.module.js` | `0a3368c165eea773490aec7b77c22de70e3eac288503409256fdbf4d12578416` | `678a2d3997ce1a368b3e79d0d4727f29957b62863b1624747dab0e2685ca3443` |
| `controls/OrbitControls.js` | `three@0.169.0/examples/jsm/controls/OrbitControls.js` | `80efaadea4f8a636a65fb0bd08bfef62f3d93a0bb94e2e7500f23176c5c07f4e` | `89ccfb99469a7bc628c67a457be6c2f740d7dbb44b0c239258b4e54effac79c1` |
| `controls/TransformControls.js` | `three@0.169.0/examples/jsm/controls/TransformControls.js` | `16b632c99d5d4f772acbd82f0b14911a5acdbefc4e49cb47da9aa4176620fcd8` | `f6132ec4a45c788c763e3bd4e6232f19b445b1d21c4b127031b8c2a1a1a85799` |

The controls files replace the bare `three` import with the local `../three.module.js` path. `three.module.js` has one whitespace-only correction so repository whitespace validation passes.
