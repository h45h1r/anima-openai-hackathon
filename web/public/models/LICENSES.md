# 3D model attributions and licences

Every file in this directory is a derivative of an openly licensed model.

## body.glb - SOMA-X "Anny" base body (Apache-2.0)

body.glb is converted from `assets/Anny/base_body.obj` in NVIDIA's SOMA-X repository, https://github.com/NVlabs/SOMA-X,
which is licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0; LICENSE file in the
repository). The copy used is the one committed in this repository at elanor-twin/public/models/soma-x-base-body.obj and is
byte-identical to the upstream Git-LFS object (sha256 7bf31cbc0897670de51b7cd6b1a3da55a35fe56ef1d7b2e6aae2f95a11196504, 1,182,571 bytes; verified 2026-09-12). The "Anny" topology originates from NAVER Corp.'s Anny project
(https://github.com/naver/anny, code Apache-2.0, Copyright (c) 2025 NAVER Corp.; its MakeHuman/MPFB2-derived mesh assets
are CC0 1.0). Apache-2.0 notice requirement (section 4): when redistributing, keep this attribution, include a copy of the
Apache License 2.0 (e.g. in the app's open-source notices), state that the file was modified (OBJ quads triangulated,
vertices welded, smooth normals computed, a plain material added, converted to GLB), and reproduce any NOTICE file the
upstream repository ships (none was present at the time of retrieval). Copyright NVIDIA Corporation; no endorsement implied.

## Organ files - Human Reference Atlas via NIH 3D (CC BY 4.0)

All organ files (everything except body.glb) come from the
**Human Reference Atlas (HRA) 3D Reference Object Library** as published on **NIH 3D** (https://3d.nih.gov),
NIH 3D collection "Human Reference Atlas 3D Reference Object Library" (https://3d.nih.gov/collections/hra),
sub-collection "Visible Human Female". Each entry page states the licence **CC-BY** with a link to
https://creativecommons.org/licenses/by/4.0/ (Creative Commons Attribution 4.0 International).

Attribution (please reproduce in the app's credits): "3D reference organs by the Human Reference Atlas (HRA),
https://humanatlas.io/3d-reference-library, published on NIH 3D (https://3d.nih.gov), licensed CC BY 4.0.
Derived from the NLM Visible Human Project (Spitzer & Whitlock 2002) and, for the brain, the Allen Human Brain
Reference Atlas (Ding et al. 2016). Meshes were decimated, merged and re-normalled for this app."

Changes made to every organ file (required to be stated under CC BY): converted/merged with gltf-transform, animations and
skins stripped (none were present), duplicate data removed, triangle counts reduced with meshoptimizer where noted,
smooth vertex normals recomputed where noted, attribution embedded in the glTF `asset.copyright` field. Geometry
units (metres, Y-up) and the shared body-centred coordinate frame were left unchanged.

Retrieved from NIH 3D on 2026-09-12 via the entry pages listed below (files served by https://3d.nih.gov/api/files/<id>).

## heart.glb - Heart, Female

- Source: https://3d.nih.gov/entries/3DPX-020966
- Source file(s): VH_F_Heart.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 60,005 triangles, 1.23 MB, bbox 0.1425 x 0.11 x 0.1015 m
- Notes: Whole heart with chambers, septum, valves and papillary muscles as 14 named sub-meshes (VH_F_*). Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Decimated 85,914 -> ~60,000 triangles; smooth normals recomputed.

## lungs.glb - Lung, Female

- Source: https://3d.nih.gov/entries/3DPX-020974
- Source file(s): 3d-vh-f-lung.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 60,021 triangles, 1.55 MB, bbox 0.2509 x 0.223 x 0.1526 m
- Notes: Both lungs with lobes / bronchopulmonary segments and intrapulmonary bronchi (trachea and main bronchi are not included in this HRA object). Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). 56 sub-meshes were joined by material (3 materials, 15 meshes remain), decimated 297,097 -> ~60,000 triangles; smooth normals recomputed.

## kidneys.glb - Kidney, Female, Left + Kidney, Female, Right

- Source: https://3d.nih.gov/entries/3DPX-020967 ; https://3d.nih.gov/entries/3DPX-020968
- Source file(s): VH_F_Kidney_L.glb, VH_F_Kidney_R.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 59,970 triangles, 1.12 MB, bbox 0.2219 x 0.1249 x 0.0776 m
- Notes: Pair of kidneys merged from the two HRA entries (left 3DPX-020967, right 3DPX-020968) into one scene; each keeps its capsule, cortex/medulla and renal pyramids as named sub-meshes (VH_F_*_L / _R). Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Decimated 147,071 -> ~60,000 triangles; smooth normals recomputed.

## liver.glb - Liver, Female

- Source: https://3d.nih.gov/entries/3DPX-020973
- Source file(s): VH_F_Liver.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 59,969 triangles, 1.14 MB, bbox 0.2471 x 0.17 x 0.1663 m
- Notes: Liver segments, lobes, ligaments and impressions as 26 named sub-meshes. Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Decimated 93,303 -> ~60,000 triangles; smooth normals recomputed. Base colour is very dark (0.07,0.02,0.01) - consider overriding the material.

## brain.glb - Brain, Female

- Source: https://3d.nih.gov/entries/3DPX-020959
- Source file(s): 3d-vh-f-allen-brain.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 59,824 triangles, 1.09 MB, bbox 0.1357 x 0.1456 x 0.1665 m
- Notes: Whole brain derived by HRA from the Allen Human Brain Reference Atlas (Ding et al. 2016), mirrored and scaled to the Visible Human Female; the entry states the model was re-licensed CC BY 4.0 in v1.3. 283 anatomical sub-meshes were joined by material (2 materials, 3 meshes remain, sub-structure names are lost) and decimated 656,268 -> ~60,000 triangles; smooth normals recomputed.

## gut.glb - Large Intestine, Female + Small Intestine, Female

- Source: https://3d.nih.gov/entries/3DPX-020971 ; https://3d.nih.gov/entries/3DPX-020987
- Source file(s): SBU_F_Intestine_Large.glb, VH_F_Small_Intestine.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 49,982 triangles, 0.94 MB, bbox 0.2433 x 0.3094 x 0.1934 m
- Notes: Colon (caecum, appendix, ascending/transverse/descending/sigmoid colon, rectum) plus small intestine (duodenum, jejunum, ileum) merged into one scene, 19 named sub-meshes. HRA notes the female colon was modelled to follow the Visible Human Female path (not direct imaging data). No stomach is included (no suitably licensed clean stomach model found). Decimated 64,173 -> ~50,000 triangles; smooth normals recomputed.

## joint.glb - Knee, Female, Left

- Source: https://3d.nih.gov/entries/3DPX-020969
- Source file(s): VH_F_Knee_L.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 17,844 triangles, 0.35 MB, bbox 0.1016 x 0.7718 x 0.1105 m
- Notes: Left knee joint: distal femur, patella, tibia, fibula, condyles, cartilage and meniscus as 20 named sub-meshes; the bbox is 0.77 m tall because the full femur/tibia shafts are included. Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Not decimated (17,844 triangles); original normals kept.

## pancreas.glb - Pancreas, Female

- Source: https://3d.nih.gov/entries/3DPX-020983
- Source file(s): 3d-vh-f-pancreas.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 12,894 triangles, 0.72 MB, bbox 0.172 x 0.0565 x 0.0844 m
- Notes: Pancreas head, neck, body, tail and uncinate process as 5 named sub-meshes. Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Not decimated (12,894 triangles); original normals kept.

## bladder.glb - Urinary Bladder, Female

- Source: https://3d.nih.gov/entries/3DPX-020995
- Source file(s): VH_F_Urinary_Bladder.glb
- Author: HRA (Human Reference Atlas 3D Reference Object Library; NIH 3D user "HRA")
- Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Result: 29,994 triangles, 0.56 MB, bbox 0.052 x 0.0442 x 0.0617 m
- Notes: Urinary bladder dome, base, neck, trigone and ureteral orifices as 6 named sub-meshes. Derived by HRA from the NLM Visible Human Project female dataset (Spitzer & Whitlock 2002). Decimated 41,290 -> ~30,000 triangles; smooth normals recomputed.

## Sources checked but not used

- NIH 3D 3DPX-020986 "Skin, Female" (HRA, CC BY 4.0): a full female body surface in the same metre/Y-up frame as the organs (266,696 triangles, alpha-blended material). Fully processed and verified (60k triangles, 1.08 MB) but not shipped because the project already had the SOMA-X body; rebuild it with `node scripts/build-models.mjs <src> public/models body-hra` if a body that shares the organ coordinate frame is wanted.
- three.js example models (Xbot.glb, Soldier.glb, Michelle.glb): the example pages credit them to mixamo.com (Adobe Mixamo terms), so they are not covered by the repository MIT licence and were rejected.
- poly.pizza "Heart" (https://poly.pizza/m/8RA5hHU5gHK), "Brain" (https://poly.pizza/m/5mPRPZkI3qt), "Kidneys" (https://poly.pizza/m/fF04IGr3X6q) by Poly by Google, CC-BY 3.0, and "Man" by Quaternius (https://poly.pizza/m/HMnuH5geEG, CC0): valid licences and direct downloads (https://static.poly.pizza/<uuid>.glb) but very low-poly/stylised; kept as documented fallbacks only, not shipped.
- Wikimedia Commons "File:3D model of a human heart.stl" (CC BY 4.0, 22,562 triangles): valid, not shipped because the HRA heart is anatomically consistent with the other organs.
- NIH 3D 3DPX-000388 "Knee Model" (CC0) and 3DPX-002636 "17 yo Female, Normal Heart" (CC0): valid public-domain CT-derived meshes (191k / 631k triangles, mm units) but noisier than the HRA versions.
- NIH 3D entries by user "Johnson J" (kidney 3DPX-023373, stomach 3DPX-021124): licence shown as CC0 / CC BY, but the descriptions claim a third-party copyright and link to a commercial site, so provenance was judged unclear and they were not used.
- BodyParts3D (CC BY-SA 2.1 JP): only bulk archives (62-136 MB) are offered, no per-organ download; skipped. Open Anatomy / SPL atlases: distributed as 3D Slicer scenes, skipped. Khronos CesiumMan (CC BY 4.0): a textured, logo-branded low-poly figure, not suitable.
