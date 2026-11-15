# Orbit-1 scanning companion

Original orbitFarm pixel satellite, generated with the built-in `image_gen` tool on 2026-11-14. The ivory body carries a green sprout-in-orbit emblem; blue solar panels and a downward-facing cyan sensor keep it readable at small sizes.

The scanner scene and standalone satellite display **AI-generated artwork**.
The original source PNG and generation prompt are unchanged. Retain a visible
generation mark when presenting the image separately or exporting a screenshot.
Orbit-1 is a fictional project character, not a NASA mission or an observation
source. See [artwork provenance](../../../docs/asset-provenance.md).

- Runtime sprite: [`public/assets/orbit-1/orbit-1-scanner-v1.png`](../../../public/assets/orbit-1/orbit-1-scanner-v1.png), 1536 × 1024 RGBA with transparent background. Keep the alpha channel intact.
- Generation prompt and provenance: [`source.json`](source.json).
- Component: [`OrbitScanner`](../../../src/components/orbitFarm-scanner.tsx).
- Motion: [`orbitFarm-scanner.css`](../../../src/components/orbitFarm-scanner.css).
- Browser preview: run the website, then open `/#/lab` and find **Meet Orbit-1**. **Replay arrival** restarts the entrance; **Show completion** fades the beam out. Preview controls do not alter analysis or farm state.

## Animation

The single sprite is animated as separate layers in CSS. It arrives from the upper right over 900 ms, settles into a 3-second hover, and moves gently across the crop beds over 6 seconds. Three scan lines travel down its translucent beam every 2.4 seconds; an ellipse on the ground follows the pass. Motion uses continuous easing while the sprite preserves pixel edges.

During an actual analysis, the component remains visible only while that request is pending. Results and errors immediately replace it. No progress percentages, staged scientific results, extra API calls, or artificial analysis delays are introduced. The connected-service label does not assert that NASA data has been received. The demo state explicitly labels its synthetic analysis.

With `prefers-reduced-motion: reduce`, the sprite and beam are static and the text status remains available to assistive technology. Successful and unsuccessful requests retain the normal application behavior. The completion animation is available in the visual preview; it does not invent a completed analysis.

The farm scene and small satellite icon share this sprite. The original orbitFarm emblem and character are project artwork.
